import { create } from "zustand";
import { persist } from "zustand/middleware";

// Interface for persisting component states
interface ComponentStates {
  // Explorer state
  explorer: {
    path: string;
    submittedPath: string;
  };

  // Notes state
  notes: {
    notes: string;
    selectedItemId: string | null;
    hasUnsavedChanges: boolean;
    showDropdown: boolean;
  };

  // Metadata state
  metadata: {
    searchInput: string;
    searchQuery: string;
  };

  // DirTree state (for Explorer)
  dirTree: {
    searchInput: string;
    searchTerm: string;
    sortBy: "name" | "timestamp" | "size" | "chrono";
    sortDirection: "asc" | "desc";
    filterBy: "all" | "folder" | "dataset" | "zarr";
    showFilters: boolean;
    lastPath: string; // Track the last loaded path
    showLiveOnly: boolean; // Show only live measurements
    hiddenLiveMeasurementIds: string[]; // Locally dismissed while still live
    // Folder nodes the user opened, so a refresh restores them. The tree now
    // loads collapsed, so the expanded set is the small one and an unseen
    // folder is correctly treated as collapsed.
    expandedNodeIds: string[];
  };
}

// Sidebar sections, rendered one-at-a-time as an accordion. `null` means the
// sidebar body is collapsed and only the icon rail is showing.
//
// "live" is the Explorer in live-measurement mode rather than a pane of its
// own: it is the same component and the same DirTree instance, so there is one
// tree, one poller and one source of truth for the mode.
export type SidebarSection = "explorer" | "metadata" | "notes" | "live";

// Sections backed by the Explorer component.
export const explorerSections: SidebarSection[] = ["explorer", "live"];

interface SidebarState {
  // Panel collapse states
  sidebarCollapsed: boolean;
  // Source of truth for the accordion; the three *Collapsed booleans below are
  // derived from it and kept in sync so existing callers keep working.
  activeSection: SidebarSection | null;
  explorerCollapsed: boolean;
  metadataCollapsed: boolean;
  notesCollapsed: boolean;
  brandingCollapsed: boolean;
  // Explorer takes over the whole window (wide "desktop" view) instead of
  // living in the sidebar column.
  explorerExpanded: boolean;

  // Component states
  componentStates: ComponentStates;

  // Actions for panel states
  setSidebarCollapsed: (collapsed: boolean) => void;
  setActiveSection: (section: SidebarSection | null) => void;
  toggleSection: (section: SidebarSection) => void;
  setExplorerCollapsed: (collapsed: boolean) => void;
  setMetadataCollapsed: (collapsed: boolean) => void;
  setNotesCollapsed: (collapsed: boolean) => void;
  setBrandingCollapsed: (collapsed: boolean) => void;
  setExplorerExpanded: (expanded: boolean) => void;

  // Actions for component states
  updateExplorerState: (state: Partial<ComponentStates["explorer"]>) => void;
  updateNotesState: (state: Partial<ComponentStates["notes"]>) => void;
  updateMetadataState: (state: Partial<ComponentStates["metadata"]>) => void;
  updateDirTreeState: (state: Partial<ComponentStates["dirTree"]>) => void;

  // Reset states
  resetComponentStates: () => void;
}

const initialComponentStates: ComponentStates = {
  explorer: {
    path: "",
    submittedPath: "",
  },
  notes: {
    notes: "",
    selectedItemId: null,
    hasUnsavedChanges: false,
    showDropdown: false,
  },
  metadata: {
    searchInput: "",
    searchQuery: "",
  },
  dirTree: {
    searchInput: "",
    searchTerm: "",
    sortBy: "name",
    sortDirection: "asc",
    filterBy: "all",
    showFilters: false,
    lastPath: "",
    showLiveOnly: false,
    hiddenLiveMeasurementIds: [],
    expandedNodeIds: [],
  },
};

// Derive the per-section booleans from the active section. The full-window
// Explorer is dropped alongside them: leaving it set while another section (or
// none) is active would strand the overlay -- it is hidden but still covering
// the rail, so there would be no way back to it.
const sectionFlags = (section: SidebarSection | null) => ({
  explorerCollapsed: !isExplorerSection(section),
  metadataCollapsed: section !== "metadata",
  notesCollapsed: section !== "notes",
  ...(isExplorerSection(section) ? {} : { explorerExpanded: false }),
});

const isExplorerSection = (section: SidebarSection | null) =>
  section !== null && explorerSections.includes(section);

// Switching between the Explorer and Live tabs is what drives DirTree's data
// source, so the flag moves with the active section instead of being toggled
// separately -- two controls for one mode would let the tab and the tree
// disagree. Sections that don't show the Explorer leave the flag alone.
const liveModePatch = (
  state: SidebarState,
  section: SidebarSection | null,
): Partial<SidebarState> => {
  if (!isExplorerSection(section)) return {};
  const showLiveOnly = section === "live";
  if (state.componentStates.dirTree.showLiveOnly === showLiveOnly) return {};
  return {
    componentStates: {
      ...state.componentStates,
      dirTree: { ...state.componentStates.dirTree, showLiveOnly },
    },
  };
};

// Shared implementation for the legacy set<Section>Collapsed actions.
const setSection =
  (section: SidebarSection, collapsed: boolean) =>
  (state: SidebarState): Partial<SidebarState> => {
    if (!collapsed) {
      return {
        activeSection: section,
        sidebarCollapsed: false,
        ...sectionFlags(section),
        ...liveModePatch(state, section),
      };
    }
    if (state.activeSection !== section) return {};
    return { activeSection: null, ...sectionFlags(null) };
  };

export const useSidebarStore = create<SidebarState>()(
  persist(
    (set) => ({
      // Initial panel states
      sidebarCollapsed: false,
      activeSection: "explorer", // Explorer should be open by default
      ...sectionFlags("explorer"),
      brandingCollapsed: false,
      explorerExpanded: false,

      // Initial component states
      componentStates: initialComponentStates,

      // Panel state actions
      // Collapsing the sidebar also leaves the full-window Explorer -- otherwise
      // the shortcut would hide the overlay and leave an empty window.
      setSidebarCollapsed: (collapsed) =>
        set(
          collapsed
            ? { sidebarCollapsed: true, explorerExpanded: false }
            : { sidebarCollapsed: false },
        ),

      setActiveSection: (section) =>
        set((state) => ({
          activeSection: section,
          ...sectionFlags(section),
          ...liveModePatch(state, section),
          // Opening a section implies the sidebar body is showing.
          ...(section ? { sidebarCollapsed: false } : {}),
        })),

      toggleSection: (section) =>
        set((state) => {
          // Clicking the open section's rail icon collapses the body; clicking
          // any other icon swaps to it (and re-opens a collapsed body).
          const next = state.activeSection === section && !state.sidebarCollapsed ? null : section;
          return {
            activeSection: next,
            ...sectionFlags(next),
            ...liveModePatch(state, next),
            ...(next ? { sidebarCollapsed: false } : {}),
          };
        }),

      // Back-compat shims: a section is "collapsed" when it is not the active
      // one, so setting one open is the same as making it active.
      setExplorerCollapsed: (collapsed) => set(setSection("explorer", collapsed)),
      setMetadataCollapsed: (collapsed) => set(setSection("metadata", collapsed)),
      setNotesCollapsed: (collapsed) => set(setSection("notes", collapsed)),
      setBrandingCollapsed: (collapsed) => set({ brandingCollapsed: collapsed }),

      // Expanding always implies the Explorer is the visible section.
      // Expanding keeps whichever Explorer-backed tab is open (Explorer or
      // Live) and falls back to Explorer from anywhere else.
      setExplorerExpanded: (expanded) =>
        set((state) => {
          if (!expanded) return { explorerExpanded: false };
          const section = isExplorerSection(state.activeSection)
            ? (state.activeSection as SidebarSection)
            : "explorer";
          return {
            activeSection: section,
            sidebarCollapsed: false,
            ...sectionFlags(section),
            explorerExpanded: true,
          };
        }),

      // Component state actions
      updateExplorerState: (newState) =>
        set((state) => ({
          componentStates: {
            ...state.componentStates,
            explorer: { ...state.componentStates.explorer, ...newState },
          },
        })),

      updateNotesState: (newState) =>
        set((state) => ({
          componentStates: {
            ...state.componentStates,
            notes: { ...state.componentStates.notes, ...newState },
          },
        })),

      updateMetadataState: (newState) =>
        set((state) => ({
          componentStates: {
            ...state.componentStates,
            metadata: { ...state.componentStates.metadata, ...newState },
          },
        })),

      updateDirTreeState: (newState) =>
        set((state) => ({
          componentStates: {
            ...state.componentStates,
            dirTree: { ...state.componentStates.dirTree, ...newState },
          },
        })),

      resetComponentStates: () => set({ componentStates: initialComponentStates }),
    }),
    {
      name: "sidebar-store",
      version: 10, // DirTree loads collapsed, so persisted expansion inverted
    },
  ),
);

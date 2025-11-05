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
    filterBy: "all" | "folder" | "zarr";
    showFilters: boolean;
    isExpanded: boolean;
    lastPath: string; // Track the last loaded path
    showLiveOnly: boolean; // Show only live measurements
  };
}

interface SidebarState {
  // Panel collapse states
  sidebarCollapsed: boolean;
  explorerCollapsed: boolean;
  metadataCollapsed: boolean;
  notesCollapsed: boolean;

  // Component states
  componentStates: ComponentStates;

  // Actions for panel states
  setSidebarCollapsed: (collapsed: boolean) => void;
  setExplorerCollapsed: (collapsed: boolean) => void;
  setMetadataCollapsed: (collapsed: boolean) => void;
  setNotesCollapsed: (collapsed: boolean) => void;

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
    isExpanded: true,
    lastPath: "",
    showLiveOnly: false,
  },
};

export const useSidebarStore = create<SidebarState>()(
  persist(
    (set) => ({
      // Initial panel states
      sidebarCollapsed: false,
      explorerCollapsed: false, // Explorer should be open by default
      metadataCollapsed: true,
      notesCollapsed: true,

      // Initial component states
      componentStates: initialComponentStates,

      // Panel state actions
      setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
      setExplorerCollapsed: (collapsed) =>
        set({ explorerCollapsed: collapsed }),
      setMetadataCollapsed: (collapsed) =>
        set({ metadataCollapsed: collapsed }),
      setNotesCollapsed: (collapsed) => set({ notesCollapsed: collapsed }),

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

      resetComponentStates: () =>
        set({ componentStates: initialComponentStates }),
    }),
    {
      name: "sidebar-store",
      version: 3, // Incremented to reset corrupted state
    }
  )
);

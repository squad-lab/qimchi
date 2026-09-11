import {
  FolderTree,
  NotebookPen,
  BadgeInfo,
  PanelLeftClose,
  PanelLeftOpen,
  Radio,
  Lightbulb,
  History,
  Sun,
  Moon,
  LucideIcon,
} from "lucide-react";

// Local imports
import Tooltip from "./Tooltip";
import { useSidebarStore, SidebarSection } from "../stores/sidebarStore";
import { useShortcut } from "../hooks/useGlobalShortcuts";
import { useThemeStore } from "../stores/themeStore";
import { useToast } from "../hooks/useToast";

interface SidebarRailProps {
  onOpenHelp?: () => void; // For opening the Help modal
}

// Rail tabs. Icon-only by design -- the labels live in the tooltips and the
// Help modal, so the rail stays as narrow as the old collapse button.
const railSections: {
  id: SidebarSection;
  label: string;
  Icon: LucideIcon;
  size: number;
  shortcut: string;
}[] = [
  { id: "explorer", label: "Explorer", Icon: FolderTree, size: 18, shortcut: "Alt+1" },
  { id: "metadata", label: "Metadata", Icon: BadgeInfo, size: 19, shortcut: "Alt+2" },
  { id: "notes", label: "Notes", Icon: NotebookPen, size: 18, shortcut: "Alt+3" },
  { id: "live", label: "Live Measurements", Icon: Radio, size: 18, shortcut: "Alt+4" },
];

const railButtonBaseClass =
  "relative flex h-9 w-9 items-center justify-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#8cc63e] focus-visible:ring-inset";

// Plain rail buttons opt into the dark hover remap; the active tab does not,
// because it carries its own themed hover (see --qimchi-panel-title-*).
const railPlainButtonClass =
  "qimchi-dark-hover-plain text-gray-500 hover:bg-gray-200 hover:text-gray-700";

const SidebarRail = ({ onOpenHelp }: SidebarRailProps) => {
  const { sidebarCollapsed, activeSection, setSidebarCollapsed, setActiveSection } =
    useSidebarStore();
  const { theme, toggleTheme } = useThemeStore();
  const { openLogModal } = useToast();
  const isDark = theme === "dark";

  // Alt+1..4 open a pane directly, in rail order.
  useShortcut("show-explorer", () => setActiveSection("explorer"));
  useShortcut("show-metadata", () => setActiveSection("metadata"));
  useShortcut("show-notes", () => setActiveSection("notes"));
  useShortcut("show-live", () => setActiveSection("live"));

  return (
    // Always visible, even when the sidebar body is collapsed.
    <div className="flex h-screen w-9 shrink-0 flex-col border-r border-gray-300 bg-gray-100">
      {railSections.map(({ id, label, Icon, size, shortcut }) => {
        const isActive = activeSection === id && !sidebarCollapsed;
        return (
          // The rail is icon-only, so the tooltip carries the section name.
          <Tooltip key={id} content={`${label} (${shortcut})`} position="right">
            <button
              onClick={() => setActiveSection(id)}
              className={`${railButtonBaseClass} ${
                isActive
                  ? "bg-[var(--qimchi-panel-title-bg)] text-[var(--qimchi-panel-title-fg)] hover:bg-[var(--qimchi-panel-title-bg-hover)]"
                  : railPlainButtonClass
              }`}
              aria-label={label}
              aria-pressed={isActive}
            >
              {isActive && <span className="absolute left-0 top-0 h-full w-0.5 bg-[#7ab134]" />}
              <Icon size={size} className={id === "live" && isActive ? "animate-pulse" : ""} />
            </button>
          </Tooltip>
        );
      })}

      <div className="flex-1" />

      {/* Help -- sits directly above the collapse toggle at the foot of the rail */}
      <Tooltip content="Help & Tips (Shift+H)" position="right">
        <button
          onClick={() => onOpenHelp?.()}
          className={`${railButtonBaseClass} qimchi-dark-hover-plain group text-amber-600 hover:bg-amber-100 hover:text-amber-700`}
          aria-label="Help and tips"
        >
          <Lightbulb size={17} className="transition-colors group-hover:fill-amber-200" />
        </button>
      </Tooltip>

      {/* Theme + notifications log, between Help and the collapse toggle */}
      <Tooltip content={isDark ? "Switch to light theme" : "Switch to dark theme"} position="right">
        <button
          onClick={toggleTheme}
          className={`${railButtonBaseClass} ${railPlainButtonClass}`}
          aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
        >
          {isDark ? <Sun size={17} /> : <Moon size={17} />}
        </button>
      </Tooltip>

      <Tooltip content="Notifications log" position="right">
        <button
          onClick={openLogModal}
          className={`${railButtonBaseClass} ${railPlainButtonClass}`}
          aria-label="View notifications log"
        >
          <History size={17} />
        </button>
      </Tooltip>

      {/* Sidebar collapse toggle -- bottom of the rail */}
      <Tooltip
        content={`${sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"} (Shift+E)`}
        position="right"
      >
        <button
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          className={`${railButtonBaseClass} ${railPlainButtonClass}`}
          aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {sidebarCollapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
        </button>
      </Tooltip>
    </div>
  );
};

export default SidebarRail;

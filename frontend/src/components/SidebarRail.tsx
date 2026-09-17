import {
  FolderTree,
  NotebookPen,
  BadgeInfo,
  PanelLeftClose,
  PanelLeftOpen,
  Radio,
  Lightbulb,
  ZoomIn,
  ZoomOut,
  History,
  Sun,
  Moon,
  Settings,
  Download,
  PackageCheck,
  LucideIcon,
} from "lucide-react";

// Local imports
import Tooltip from "./Tooltip";
import { useSidebarStore, SidebarSection } from "../stores/sidebarStore";
import { useShortcut } from "../hooks/useGlobalShortcuts";
import { useThemeStore } from "../stores/themeStore";
import { useSettingsStore } from "../stores/settingsStore";
import { ZOOM_STEPS } from "../settings/userSettings";
import { useToast } from "../hooks/useToast";
import { useUpdateStore } from "../stores/updateStore";

interface SidebarRailProps {
  onOpenHelp?: () => void; // For opening the Help modal
  onOpenSettings?: (section?: string) => void;
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
  "relative flex h-9 w-full shrink-0 items-center justify-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#8cc63e] focus-visible:ring-inset";

// Plain rail buttons opt into the dark hover remap; the active tab does not,
// because it carries its own themed hover (see --qimchi-panel-title-*).
const railPlainButtonClass =
  "qimchi-dark-hover-plain text-gray-500 hover:bg-gray-200 hover:text-gray-700";

// The ladder Chromium uses for Ctrl+/Ctrl-, so the steps feel like the
// browser's own zoom rather than an arbitrary percentage.

const nextZoom = (current: number, direction: 1 | -1): number => {
  // Snap to the nearest rung first, so a persisted off-ladder value still
  // steps predictably.
  const index = ZOOM_STEPS.reduce(
    (best, step, i) => (Math.abs(step - current) < Math.abs(ZOOM_STEPS[best] - current) ? i : best),
    0,
  );
  return ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, Math.max(0, index + direction))];
};

const SidebarRail = ({ onOpenHelp, onOpenSettings }: SidebarRailProps) => {
  const { sidebarCollapsed, activeSection, setSidebarCollapsed, setActiveSection } =
    useSidebarStore();
  const zoomLevel = useSettingsStore((state) => state.settings.general.zoom);
  const setZoomLevel = (zoom: number) =>
    useSettingsStore.getState().update(["general", "zoom"], zoom);
  const { theme, toggleTheme } = useThemeStore();
  const { openLogModal } = useToast();
  const isDark = theme === "dark";
  const update = useUpdateStore((state) => state.state);
  const showUpdateReady = useUpdateStore((state) => state.showReady);
  const downloadPercent = Math.round(update.progress * 100);

  // Alt+1..4 open a pane directly, in rail order.
  useShortcut("show-explorer", () => setActiveSection("explorer"));
  useShortcut("show-metadata", () => setActiveSection("metadata"));
  useShortcut("show-notes", () => setActiveSection("notes"));
  useShortcut("show-live", () => setActiveSection("live"));

  return (
    // Always visible, even when the sidebar body is collapsed.
    <div className="flex h-full w-9 shrink-0 flex-col overflow-x-hidden overflow-y-auto border-r border-gray-300 bg-gray-100">
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

      {/* App zoom -- the desktop build has no browser chrome to zoom from */}
      <Tooltip content="Zoom in" position="right">
        <button
          onClick={() => setZoomLevel(nextZoom(zoomLevel, 1))}
          disabled={zoomLevel >= ZOOM_STEPS[ZOOM_STEPS.length - 1]}
          className={`${railButtonBaseClass} ${railPlainButtonClass} disabled:opacity-40 disabled:cursor-not-allowed`}
          aria-label="Zoom in"
        >
          <ZoomIn size={16} />
        </button>
      </Tooltip>

      <Tooltip content="Reset zoom to 100%" position="right">
        <button
          onClick={() => setZoomLevel(1)}
          className={`${railButtonBaseClass} ${railPlainButtonClass} text-[10px] font-medium tabular-nums`}
          aria-label={`Zoom ${Math.round(zoomLevel * 100)} percent, reset to 100 percent`}
        >
          {Math.round(zoomLevel * 100)}
        </button>
      </Tooltip>

      <Tooltip content="Zoom out" position="right">
        <button
          onClick={() => setZoomLevel(nextZoom(zoomLevel, -1))}
          disabled={zoomLevel <= ZOOM_STEPS[0]}
          className={`${railButtonBaseClass} ${railPlainButtonClass} disabled:opacity-40 disabled:cursor-not-allowed`}
          aria-label="Zoom out"
        >
          <ZoomOut size={16} />
        </button>
      </Tooltip>

      <Tooltip content={isDark ? "Switch to light theme" : "Switch to dark theme"} position="right">
        <button
          onClick={toggleTheme}
          className={`${railButtonBaseClass} ${railPlainButtonClass}`}
          aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
        >
          {isDark ? <Sun size={17} /> : <Moon size={17} />}
        </button>
      </Tooltip>

      <Tooltip content="Help & Tips (Shift+H)" position="right">
        <button
          onClick={() => onOpenHelp?.()}
          className={`${railButtonBaseClass} qimchi-dark-hover-plain group text-amber-600 hover:bg-amber-100 hover:text-amber-700`}
          aria-label="Help and tips"
        >
          <Lightbulb size={17} className="transition-colors group-hover:fill-amber-200" />
        </button>
      </Tooltip>

      <Tooltip content="Settings (Shift+S)" position="right">
        <button
          onClick={() => onOpenSettings?.()}
          className={`${railButtonBaseClass} qimchi-dark-hover-plain group text-blue-600 hover:bg-blue-100 hover:text-blue-700`}
          aria-label="Settings"
        >
          <Settings size={17} className="transition-transform duration-300 group-hover:rotate-45" />
        </button>
      </Tooltip>

      {update.status === "downloading" && (
        <Tooltip content={`Downloading Qimchi ${update.tag}: ${downloadPercent}%`} position="right">
          <button
            onClick={() => onOpenSettings?.("updates")}
            className={`${railButtonBaseClass} qimchi-dark-hover-plain text-blue-600 hover:bg-blue-100`}
            aria-label={`Downloading update, ${downloadPercent}%`}
          >
            <Download size={17} className="animate-pulse" />
            <span
              aria-hidden="true"
              className="absolute bottom-0.5 left-1.5 right-1.5 h-0.5 rounded bg-gray-300"
            >
              <span
                className="block h-full rounded bg-blue-600"
                style={{ width: `${downloadPercent}%` }}
              />
            </span>
          </button>
        </Tooltip>
      )}
      {update.status === "downloaded" && (
        <Tooltip content={`Qimchi ${update.tag} is ready to install`} position="right">
          <button
            onClick={showUpdateReady}
            className={`${railButtonBaseClass} qimchi-dark-hover-plain text-green-600 hover:bg-green-50`}
            aria-label="Install downloaded update"
          >
            <PackageCheck size={17} />
          </button>
        </Tooltip>
      )}

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

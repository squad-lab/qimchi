import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Code,
  ChevronRight,
  Download,
  Upload,
  ChartLine,
  ChartScatter,
  FolderOpen,
  FolderTree,
  Grid3x3,
  Image,
  MoveHorizontal,
  MoveVertical,
  Palette,
  Radio,
  RefreshCw,
  RotateCcw,
  Search,
  Settings as SettingsIcon,
  SlidersHorizontal,
  Spline,
  X,
} from "lucide-react";

import SectionedModal, { type ModalSection } from "./SectionedModal";
import { AxisSection, ColormapSection, LineStyleSection } from "./Plots/AppearanceSections";
import { useSettingsStore } from "../stores/settingsStore";
import { useToast } from "../hooks/useToast";
import { saveTextFile } from "../utils/saveTextFile";
import Tooltip from "./Tooltip";
import UpdatesPanel from "./UpdatesPanel";
import LogBundlePanel from "./LogBundlePanel";
import { useUpdateStore } from "../stores/updateStore";
import {
  FACTORY_SETTINGS,
  LIVE_REFRESH_MAX_MS,
  LIVE_REFRESH_MIN_MS,
  LIVE_REFRESH_STEP_MS,
  LINE_CUT_MARKER_STEPS,
  CLOSED_PLOTS_LIMIT,
  PLOT_WIDTHS,
  ZOOM_STEPS,
  type ExplorerSort,
  type UserSettings,
} from "../settings/userSettings";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** The section to show when the modal opens. */
  initialSection?: string;
}

const isDesktop = () => typeof window !== "undefined" && Boolean(window.pywebview?.api);

const buildSections = (updates: boolean): ModalSection[] => [
  { id: "general", label: "General", icon: <SlidersHorizontal size={16} /> },
  { id: "explorer", label: "Explorer", icon: <FolderTree size={16} /> },
  { id: "live", label: "Live", icon: <Radio size={16} /> },
  { id: "plots", label: "Plots", icon: <ChartScatter size={16} /> },
  {
    id: "heatmap",
    label: "HeatMap",
    icon: <Grid3x3 size={16} />,
    children: [
      { id: "heatmap.colormap", label: "Colormap", icon: <Palette size={14} /> },
      { id: "heatmap.x", label: "X axis", icon: <MoveHorizontal size={14} /> },
      { id: "heatmap.y", label: "Y axis", icon: <MoveVertical size={14} /> },
    ],
  },
  {
    id: "line",
    label: "LinePlot",
    icon: <ChartLine size={16} />,
    children: [
      { id: "line.style", label: "Line & markers", icon: <Spline size={14} /> },
      { id: "line.x", label: "X axis", icon: <MoveHorizontal size={14} /> },
      { id: "line.y", label: "Y axis", icon: <MoveVertical size={14} /> },
    ],
  },
  { id: "export", label: "Export", icon: <Image size={16} /> },
  ...(updates ? [{ id: "updates", label: "Updates", icon: <RefreshCw size={16} /> }] : []),
  { id: "developer", label: "Developer", icon: <Code size={16} /> },
];

const SORT_LABELS: Record<ExplorerSort, string> = {
  timestamp: "Date",
  name: "Name",
  size: "Size",
  chrono: "Chronological",
};

interface SettingsSearchEntry {
  id: string;
  sectionId: string;
  sectionLabel: string;
  label: string;
  keywords?: string;
}

const SETTINGS_SEARCH_ENTRIES: SettingsSearchEntry[] = [
  { id: "theme", sectionId: "general", sectionLabel: "General", label: "Theme" },
  { id: "zoom", sectionId: "general", sectionLabel: "General", label: "Zoom" },
  { id: "plot-width", sectionId: "general", sectionLabel: "General", label: "Plot width" },
  { id: "sort", sectionId: "explorer", sectionLabel: "Explorer", label: "Sort by" },
  {
    id: "auto-add",
    sectionId: "live",
    sectionLabel: "Live",
    label: "Add new measurements to the basket",
    keywords: "automatic live",
  },
  {
    id: "refresh",
    sectionId: "live",
    sectionLabel: "Live",
    label: "Fastest live refresh",
    keywords: "rate interval milliseconds",
  },
  {
    id: "plotting-behaviour",
    sectionId: "plots",
    sectionLabel: "Plots",
    label: "Plotting behaviour",
    keywords: "heatmap lineplot basket",
  },
  {
    id: "recreate",
    sectionId: "plots",
    sectionLabel: "Plots",
    label: "Recreate custom plots",
  },
  {
    id: "linecut-direction",
    sectionId: "plots",
    sectionLabel: "Plots",
    label: "Default LineCut direction",
    keywords: "horizontal vertical oblique",
  },
  {
    id: "linecut-marker-step",
    sectionId: "plots",
    sectionLabel: "Plots",
    label: "Marker step with Shift",
    keywords: "markers arrow keys nudge",
  },
  { id: "square", sectionId: "plots", sectionLabel: "Plots", label: "Square plots" },
  {
    id: "closed-plots",
    sectionId: "plots",
    sectionLabel: "Plots",
    label: "Closed plots to keep",
    keywords: "recently closed undo reopen history ctrl+z",
  },
  {
    id: "heatmap-colorscale",
    sectionId: "heatmap.colormap",
    sectionLabel: "HeatMap · Colormap",
    label: "Colorscale",
    keywords: "palette reverse color range",
  },
  ...(["heatmap.x", "heatmap.y", "line.x", "line.y"] as const).flatMap((sectionId) => {
    const [plot, axis] = sectionId.split(".");
    const sectionLabel = `${plot === "heatmap" ? "HeatMap" : "LinePlot"} · ${axis.toUpperCase()} axis`;
    return [
      {
        id: `${sectionId}-axis-type`,
        sectionId,
        sectionLabel,
        label: "Axis Type",
        keywords: `${axis} linear log date category`,
      },
      {
        id: `${sectionId}-major`,
        sectionId,
        sectionLabel,
        label: "Major Grid & Ticks",
        keywords: `${axis} grid color dash width number tick angle length`,
      },
      {
        id: `${sectionId}-minor`,
        sectionId,
        sectionLabel,
        label: "Minor Grid & Ticks",
        keywords: `${axis} grid color dash width number tick length`,
      },
    ];
  }),
  {
    id: "line-mode",
    sectionId: "line.style",
    sectionLabel: "LinePlot · Line & markers",
    label: "Mode",
    keywords: "lines markers",
  },
  {
    id: "line-settings",
    sectionId: "line.style",
    sectionLabel: "LinePlot · Line & markers",
    label: "Line Settings",
    keywords: "color width opacity dash shape smoothing",
  },
  {
    id: "marker-settings",
    sectionId: "line.style",
    sectionLabel: "LinePlot · Line & markers",
    label: "Marker Settings",
    keywords: "symbol color size opacity",
  },
  { id: "formats", sectionId: "export", sectionLabel: "Export", label: "Formats" },
  { id: "variants", sectionId: "export", sectionLabel: "Export", label: "Variants" },
  { id: "resolution", sectionId: "export", sectionLabel: "Export", label: "Resolution" },
  {
    id: "save-to",
    sectionId: "export",
    sectionLabel: "Export",
    label: "Save to",
    keywords: "folder downloads",
  },
  {
    id: "update-startup",
    sectionId: "updates",
    sectionLabel: "Updates",
    label: "Check for updates at startup",
  },
  {
    id: "preview-releases",
    sectionId: "updates",
    sectionLabel: "Updates",
    label: "Include preview releases",
    keywords: "release candidate rc",
  },
  {
    id: "timings",
    sectionId: "developer",
    sectionLabel: "Developer",
    label: "Export timings",
    keywords: "timings.json performance render",
  },
  {
    id: "logs",
    sectionId: "developer",
    sectionLabel: "Developer",
    label: "Logs for a bug report",
    keywords: "diagnostics crash zip support",
  },
];

/**
 * Commit on blur or Enter so partial input cannot lower the limit and discard history.
 */
const ClosedPlotsLimitField = ({
  value,
  onCommit,
}: {
  value: number;
  onCommit: (limit: number) => void;
}) => {
  const [draft, setDraft] = useState(String(value));
  const [shown, setShown] = useState(value);
  if (value !== shown) {
    setShown(value);
    setDraft(String(value));
  }
  const number = Number(draft);
  const valid =
    draft.trim() !== "" &&
    Number.isInteger(number) &&
    number >= CLOSED_PLOTS_LIMIT.min &&
    number <= CLOSED_PLOTS_LIMIT.max;
  const commit = () => {
    if (valid && number !== value) onCommit(number);
    else if (!valid) setDraft(String(value));
  };
  const footer = !valid ? (
    <p className="mt-2 text-xs text-red-600">
      Enter a whole number from {CLOSED_PLOTS_LIMIT.min} to {CLOSED_PLOTS_LIMIT.max}.
    </p>
  ) : number > CLOSED_PLOTS_LIMIT.recommended ? (
    <p
      role="note"
      className="mt-2 flex items-start gap-1.5 rounded border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs text-amber-800"
    >
      <AlertTriangle size={14} className="mt-px shrink-0" aria-hidden />
      Keeping more than {CLOSED_PLOTS_LIMIT.recommended} makes the list long and uses more memory.
    </p>
  ) : null;
  return (
    <Field
      label="Closed plots to keep"
      description="How many closed plots you can reopen. The oldest are dropped first."
      inline
      footer={footer}
    >
      <input
        type="number"
        aria-label="Closed plots to keep"
        min={CLOSED_PLOTS_LIMIT.min}
        max={CLOSED_PLOTS_LIMIT.max}
        step={1}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit();
        }}
        className="w-24 rounded border border-gray-300 p-1.5 text-sm"
      />
    </Field>
  );
};

const Field = ({
  label,
  description,
  inline = false,
  footer,
  children,
}: {
  label: string;
  description?: string;
  inline?: boolean;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) => (
  <div
    data-setting-label={label}
    className="border-b border-gray-100 py-3 last:border-b-0 [&:has(+h4)]:border-b-0"
  >
    <div className={inline ? "flex flex-wrap items-center justify-between gap-x-6 gap-y-2" : ""}>
      <div className={inline ? "min-w-0 flex-1 basis-56" : "min-w-0"}>
        <div className="text-sm font-medium text-gray-700">{label}</div>
        {description && <div className="mt-0.5 text-xs text-gray-500">{description}</div>}
      </div>
      <div className={inline ? "shrink-0" : "mt-2 w-full min-w-0 [&>select]:w-full"}>
        {children}
      </div>
    </div>
    {footer}
  </div>
);

// Align marks with the center of the range thumb across its usable track.
const THUMB_PX = 16;
const markLeft = (fraction: number) =>
  `calc(${fraction * 100}% + ${(0.5 - fraction) * THUMB_PX}px)`;

const RefreshSlider = ({ value, onChange }: { value: number; onChange: (ms: number) => void }) => {
  const fallback = FACTORY_SETTINGS.live.minRefreshMs;
  const span = LIVE_REFRESH_MAX_MS - LIVE_REFRESH_MIN_MS;
  const defaultAt = (fallback - LIVE_REFRESH_MIN_MS) / span;
  return (
    <div className="w-full">
      <div className="mb-1 flex h-6 items-center justify-between text-sm">
        <span className="font-mono font-semibold text-gray-800">{value} ms</span>
        {value !== fallback && (
          <button
            type="button"
            onClick={() => onChange(fallback)}
            className="qimchi-dark-hover-plain flex items-center gap-1 rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-700 hover:bg-gray-100"
          >
            <RotateCcw size={12} />
            Reset to {fallback} ms
          </button>
        )}
      </div>
      <div className="relative pt-2.5">
        {/* The default */}
        <div
          className="pointer-events-none absolute top-0 h-0 w-0 -translate-x-1/2 border-x-[6px] border-t-[9px] border-x-transparent border-t-amber-500"
          style={{ left: markLeft(defaultAt) }}
          aria-hidden
        />
        <input
          type="range"
          aria-label="Fastest live refresh"
          min={LIVE_REFRESH_MIN_MS}
          max={LIVE_REFRESH_MAX_MS}
          step={LIVE_REFRESH_STEP_MS}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-full cursor-pointer accent-blue-600"
        />
      </div>
      <div className="relative mt-1 h-4 text-xs text-gray-500">
        <span className="absolute left-0">{LIVE_REFRESH_MIN_MS} ms</span>
        <button
          type="button"
          onClick={() => onChange(fallback)}
          className="absolute -translate-x-1/2 font-semibold text-amber-600 hover:underline"
          style={{ left: markLeft(defaultAt) }}
          title="Set it back to the default"
        >
          {fallback} ms
        </button>
        <span className="absolute right-0">{LIVE_REFRESH_MAX_MS / 1000} s</span>
      </div>
    </div>
  );
};

const Toggle = ({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) => (
  <label className="relative inline-flex items-center cursor-pointer">
    <input
      type="checkbox"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      className="sr-only peer"
      aria-label={label}
    />
    <span className="qimchi-toggle w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></span>
  </label>
);

const Segmented = <T extends string | number>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  label: string;
}) => (
  <div
    role="radiogroup"
    aria-label={label}
    className="flex w-full rounded-md border border-gray-300"
  >
    {options.map((option, index) => (
      <button
        key={String(option.value)}
        type="button"
        role="radio"
        aria-checked={value === option.value}
        onClick={() => onChange(option.value)}
        className={`min-w-0 flex-1 px-3 py-1 text-sm ${index > 0 ? "border-l border-gray-300" : ""} ${
          value === option.value
            ? "bg-blue-600 text-white"
            : "text-gray-700 hover:bg-gray-100 qimchi-dark-hover-plain"
        }`}
      >
        {option.label}
      </button>
    ))}
  </div>
);

const Checkboxes = <T extends string>({
  values,
  options,
  onChange,
  label,
}: {
  values: T[];
  options: { value: T; label: string }[];
  onChange: (values: T[]) => void;
  label: string;
}) => (
  <div role="group" aria-label={label} className="flex flex-wrap items-center gap-4">
    {options.map((option) => {
      const checked = values.includes(option.value);
      // At least one must stay selected; the last one cannot be cleared.
      const locked = checked && values.length === 1;
      return (
        <label key={option.value} className="flex items-center gap-1.5 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={checked}
            disabled={locked}
            onChange={(e) =>
              onChange(
                e.target.checked
                  ? options
                      .map((o) => o.value)
                      .filter((v) => v === option.value || values.includes(v))
                  : values.filter((v) => v !== option.value),
              )
            }
          />
          {option.label}
        </label>
      );
    })}
  </div>
);

const SectionHeader = ({ title, onReset }: { title: string; onReset: () => void }) => (
  <div className="mb-4 flex items-center justify-between col-span-full">
    <h3 className="text-lg font-semibold text-gray-800">{title}</h3>
    <button
      type="button"
      onClick={onReset}
      className="group flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700 shadow-sm transition-colors hover:bg-amber-100 qimchi-dark-hover-plain"
    >
      <RotateCcw
        size={13}
        className="transition-transform duration-300 group-hover:-rotate-180"
        aria-hidden="true"
      />
      Restore defaults
    </button>
  </div>
);

const SettingsModal = ({ isOpen, onClose, initialSection }: SettingsModalProps) => {
  const desktop = isDesktop();
  const updatesSupported = useUpdateStore((state) => state.supported);
  const sections = useMemo(() => buildSections(updatesSupported), [updatesSupported]);
  const [activeSection, setActiveSection] = useState("general");
  const [query, setQuery] = useState("");
  const [highlightIndex, setHighlightIndex] = useState(0);

  useEffect(() => {
    if (isOpen && initialSection) setActiveSection(initialSection);
  }, [isOpen, initialSection]);
  const settings = useSettingsStore((state) => state.settings);
  const available = useSettingsStore((state) => state.available);
  const unavailableReason = useSettingsStore((state) => state.unavailableReason);
  const update = useSettingsStore((state) => state.update);
  const [confirmingResetAll, setConfirmingResetAll] = useState(false);
  const resetAll = useSettingsStore((state) => state.resetAll);
  const replaceAll = useSettingsStore((state) => state.replaceAll);
  const { showToast } = useToast();
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const pendingSearchTargetRef = useRef<string | null>(null);

  const searchableSectionIds = useMemo(
    () =>
      new Set(
        sections.flatMap((section) => [section.id, ...(section.children ?? []).map((c) => c.id)]),
      ),
    [sections],
  );
  const searchResults = useMemo(() => {
    const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return [];
    return SETTINGS_SEARCH_ENTRIES.filter((entry) => {
      if (!searchableSectionIds.has(entry.sectionId)) return false;
      if (entry.id === "save-to" && !desktop) return false;
      const text =
        `${entry.label} ${entry.sectionLabel} ${entry.keywords ?? ""}`.toLocaleLowerCase();
      return terms.every((term) => text.includes(term));
    });
  }, [desktop, query, searchableSectionIds]);

  useEffect(() => setHighlightIndex(0), [query]);

  useEffect(() => {
    const target = pendingSearchTargetRef.current;
    if (!target || !contentRef.current || query) return;
    pendingSearchTargetRef.current = null;
    const nodes = contentRef.current.querySelectorAll("[data-setting-label], h3, h4, label");
    for (const node of nodes) {
      const label =
        node.getAttribute("data-setting-label") ?? node.textContent?.replace(/\s+/g, " ").trim();
      if (label !== target) continue;
      node.scrollIntoView({ block: "center", behavior: "smooth" });
      node.classList.add("qimchi-help-hit");
      window.setTimeout(() => node.classList.remove("qimchi-help-hit"), 1600);
      break;
    }
  }, [activeSection, query]);

  // Only the values that differ from the defaults, as stored.
  const exportSettings = async () => {
    const { stored } = useSettingsStore.getState();
    const file = {
      qimchi: "settings",
      // Bump formatVersion only when the file layout changes.
      formatVersion: 1,
      qimchiVersion: __QIMCHI_VERSION__,
      exportedAt: new Date().toISOString(),
      settings: stored,
    };
    const filename = `qimchi-settings-${new Date().toISOString().split("T")[0]}.json`;
    try {
      const savedTo = await saveTextFile(filename, JSON.stringify(file, null, 2));
      if (savedTo) showToast(`Settings saved to ${savedTo}`, "success", 4000, "Settings");
    } catch (error) {
      showToast(`Settings could not be exported: ${error}`, "error", 6000, "Settings");
    }
  };

  const importSettings = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text());
      if (parsed?.qimchi !== "settings" || typeof parsed.settings !== "object") {
        showToast("That file is not a Qimchi settings export", "error", 6000, "Settings");
        return;
      }
      await replaceAll(parsed.settings);
      if (useSettingsStore.getState().available) {
        showToast(`Settings imported from ${file.name}`, "success", 4000, "Settings");
      }
    } catch {
      showToast("That file could not be read as JSON", "error", 6000, "Settings");
    }
  };

  const selectSection = (id: string) => {
    setConfirmingResetAll(false);
    const section = sections.find((s) => s.id === id);
    setActiveSection(section?.children?.[0]?.id ?? id);
  };

  const openSearchResult = (result: SettingsSearchEntry) => {
    setConfirmingResetAll(false);
    pendingSearchTargetRef.current = result.label;
    setActiveSection(result.sectionId);
    setQuery("");
    searchInputRef.current?.blur();
  };

  const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (searchResults.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlightIndex((index) => (index + 1) % searchResults.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightIndex((index) => (index - 1 + searchResults.length) % searchResults.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      openSearchResult(searchResults[highlightIndex]);
    }
  };

  const handleEscape = () => (query ? setQuery("") : onClose());

  const resetSection = (path: (keyof UserSettings)[] | string[]) => {
    const factory = path.reduce<unknown>(
      (node, key) => (node as Record<string, unknown>)[key],
      FACTORY_SETTINGS,
    );
    update(path as string[], factory);
  };

  const chooseExportFolder = async () => {
    const folder = await window.pywebview?.api.open_folder_dialog();
    if (folder) update(["export", "folder"], folder);
  };

  const appearance = (type: "heatmap" | "line") => ({
    settings: settings.appearance[type],
    updateSetting: (path: string[], value: unknown) => update(["appearance", type, ...path], value),
  });

  const renderContent = () => {
    switch (activeSection) {
      case "general":
        return (
          <>
            <SectionHeader title="General" onReset={() => resetSection(["general"])} />
            <Field label="Theme" description="System follows your operating system.">
              <Segmented
                label="Theme"
                value={settings.general.theme}
                options={[
                  { value: "system", label: "System" },
                  { value: "light", label: "Light" },
                  { value: "dark", label: "Dark" },
                ]}
                onChange={(theme) => update(["general", "theme"], theme)}
              />
            </Field>
            <Field label="Zoom" description="The size of the whole interface.">
              <select
                aria-label="Zoom"
                value={settings.general.zoom}
                onChange={(e) => update(["general", "zoom"], Number(e.target.value))}
                className="rounded border border-gray-300 p-1.5 text-sm"
              >
                {ZOOM_STEPS.map((step) => (
                  <option key={step} value={step}>
                    {Math.round(step * 100)}%
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Plot width" description="How much of the Viewer's width each plot takes.">
              <Segmented
                label="Plot width"
                value={settings.general.plotWidth}
                options={PLOT_WIDTHS.map((width) => ({ value: width, label: `${width}%` }))}
                onChange={(width) => update(["general", "plotWidth"], width)}
              />
            </Field>
            {/* Confirmed in place rather than with window.confirm, whose native
                dialog is titled with the server address and ignores the theme. */}
            <div
              className={`mt-6 rounded-md border p-3 ${
                confirmingResetAll ? "border-red-200 bg-red-50" : "border-gray-200"
              }`}
            >
              {confirmingResetAll ? (
                <div className="flex items-center justify-between gap-4">
                  <div className="text-sm text-red-800">
                    Restore every setting to its default? This also resets the HeatMap and LinePlot
                    appearance, and cannot be undone.
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      onClick={() => setConfirmingResetAll(false)}
                      className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 qimchi-dark-hover-plain"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setConfirmingResetAll(false);
                        void resetAll();
                      }}
                      className="rounded bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
                    >
                      Restore all
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-4">
                  <div className="text-sm text-gray-600">
                    Restore every setting, including plot appearance, to its default.
                  </div>
                  <button
                    type="button"
                    onClick={() => setConfirmingResetAll(true)}
                    className="shrink-0 rounded border border-red-200 bg-red-50 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-100 qimchi-dark-hover-plain"
                  >
                    Restore all defaults
                  </button>
                </div>
              )}
            </div>
          </>
        );
      case "plots":
        return (
          <>
            <SectionHeader title="Plots" onReset={() => resetSection(["plots"])} />
            <Field
              label="Plotting behaviour"
              description="Which plots to create when a measurement is added to the basket. Plots are only made when the measurement's variables allow them."
            >
              <select
                aria-label="Plotting behaviour"
                value={settings.plots.plottingBehaviour}
                onChange={(e) => update(["plots", "plottingBehaviour"], e.target.value)}
                className="rounded border border-gray-300 p-1.5 text-sm"
              >
                <option value="heatmapOrLine">HeatMap, or LinePlot if no HeatMap</option>
                <option value="both">Both HeatMap and LinePlot</option>
                <option value="none">None</option>
              </select>
            </Field>
            <Field
              label="Recreate custom plots"
              description="Adding a measurement recreates the plots already in the Viewer. Turn this off to recreate only its default plots, not Composer plots or LineCuts."
              inline
            >
              <Toggle
                label="Recreate custom plots for new measurements"
                checked={settings.plots.recreateCustomPlots}
                onChange={(on) => update(["plots", "recreateCustomPlots"], on)}
              />
            </Field>
            <Field
              label="Default LineCut direction"
              description="Initial direction. While active, press X, Y, or O to switch. Measured axes do not support Oblique."
            >
              <select
                aria-label="LineCut direction"
                value={settings.plots.lineCutDirection}
                onChange={(e) => update(["plots", "lineCutDirection"], e.target.value)}
                className="rounded border border-gray-300 p-1.5 text-sm"
              >
                <option value="horizontal">Horizontal (X)</option>
                <option value="vertical">Vertical (Y)</option>
                <option value="oblique">Oblique (O)</option>
              </select>
            </Field>
            <Field label="Square plots" description="Keep every plot at a 1:1 aspect ratio." inline>
              <Toggle
                label="Square plots"
                checked={settings.plots.squarify}
                onChange={(on) => update(["plots", "squarify"], on)}
              />
            </Field>
            <Field
              label="Marker step with Shift"
              description="How far Shift with an arrow key moves the selected marker."
            >
              <select
                aria-label="Marker step with Shift"
                value={settings.plots.lineCutMarkerStep}
                onChange={(e) => update(["plots", "lineCutMarkerStep"], Number(e.target.value))}
                className="rounded border border-gray-300 p-1.5 text-sm"
              >
                {LINE_CUT_MARKER_STEPS.map((step) => (
                  <option key={step} value={step}>
                    {step} steps
                  </option>
                ))}
              </select>
            </Field>
            <ClosedPlotsLimitField
              value={settings.plots.closedPlotsLimit}
              onCommit={(limit) => update(["plots", "closedPlotsLimit"], limit)}
            />
          </>
        );
      case "explorer":
        return (
          <>
            <SectionHeader title="Explorer" onReset={() => resetSection(["explorer"])} />
            <Field label="Sort by" description="The order measurements are listed in.">
              <select
                aria-label="Sort by"
                value={settings.explorer.sortBy}
                onChange={(e) => update(["explorer", "sortBy"], e.target.value)}
                className="rounded border border-gray-300 p-1.5 text-sm"
              >
                {(Object.keys(SORT_LABELS) as ExplorerSort[]).map((sort) => (
                  <option key={sort} value={sort}>
                    {SORT_LABELS[sort]}
                  </option>
                ))}
              </select>
            </Field>
          </>
        );
      case "live":
        return (
          <>
            <SectionHeader title="Live measurements" onReset={() => resetSection(["live"])} />
            <Field
              label="Add new measurements to the basket"
              description="Put a measurement in the basket as soon as it starts running."
              inline
            >
              <Toggle
                label="Add new live measurements to the basket"
                checked={settings.live.autoAddToBasket}
                onChange={(on) => update(["live", "autoAddToBasket"], on)}
              />
            </Field>
            <Field
              label="Fastest live refresh"
              description="The shortest time a live plot waits between updates. Qimchi waits longer by itself when a refresh takes longer than this."
            >
              <RefreshSlider
                value={settings.live.minRefreshMs}
                onChange={(ms) => update(["live", "minRefreshMs"], ms)}
              />
            </Field>
            <div className="mt-1 flex items-start gap-2 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span>
                Each refresh queries your measurement code for its latest data. Refreshing faster
                than the default can make live plotting in Qimchi unstable, and can slow down or
                disturb a measurement that is running. If that happens, set this back to 300 ms.
              </span>
            </div>
          </>
        );
      case "export":
        return (
          <>
            <SectionHeader title="Image export" onReset={() => resetSection(["export"])} />
            <Field label="Formats" inline>
              <Checkboxes
                label="Export formats"
                values={settings.export.formats}
                options={[
                  { value: "png", label: "PNG" },
                  { value: "svg", label: "SVG" },
                ]}
                onChange={(formats) => update(["export", "formats"], formats)}
              />
            </Field>
            <Field label="Variants" description="Images for light and dark backgrounds." inline>
              <Checkboxes
                label="Export variants"
                values={settings.export.variants}
                options={[
                  { value: "light", label: "Light" },
                  { value: "dark", label: "Dark" },
                ]}
                onChange={(variants) => update(["export", "variants"], variants)}
              />
            </Field>
            <Field label="Resolution" description="Scale relative to the plot's size on screen.">
              <select
                aria-label="Export resolution"
                value={settings.export.scale ?? ""}
                onChange={(e) =>
                  update(["export", "scale"], e.target.value ? Number(e.target.value) : null)
                }
                className="rounded border border-gray-300 p-1.5 text-sm"
              >
                <option value="">Default</option>
                {[1, 2, 3, 4].map((scale) => (
                  <option key={scale} value={scale}>
                    {scale}×
                  </option>
                ))}
              </select>
            </Field>
            {desktop && (
              <Field
                label="Save to"
                description={settings.export.folder ?? "Your Downloads folder"}
              >
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void chooseExportFolder()}
                    className="flex items-center gap-1.5 rounded border border-gray-300 px-2 py-1 text-sm hover:bg-gray-100 qimchi-dark-hover-plain"
                  >
                    <FolderOpen size={14} /> Choose…
                  </button>
                  {settings.export.folder && (
                    <button
                      type="button"
                      onClick={() => update(["export", "folder"], null)}
                      className="rounded px-2 py-1 text-sm text-gray-600 hover:bg-gray-100 qimchi-dark-hover-plain"
                    >
                      Use Downloads
                    </button>
                  )}
                </div>
              </Field>
            )}
          </>
        );
      case "developer":
        return (
          <>
            <SectionHeader title="Developer" onReset={() => resetSection(["developer"])} />
            <Field
              label="Export timings"
              description="Add per-image render times to timings.json in each export archive."
              inline
            >
              <Toggle
                label="Add timings.json to exports"
                checked={settings.developer.exportTimings}
                onChange={(on) => update(["developer", "exportTimings"], on)}
              />
            </Field>
            <Field
              label="Logs for a bug report"
              description="Qimchi records what it does, including how much memory it uses, in log files."
            >
              <LogBundlePanel />
            </Field>
          </>
        );
      case "updates":
        return (
          <>
            <SectionHeader title="Updates" onReset={() => resetSection(["desktop"])} />
            <UpdatesPanel />
            <Field
              label="Check for updates at startup"
              description="Look for a new version each time Qimchi starts. You can always check here."
            >
              <Toggle
                label="Check for updates at startup"
                checked={settings.desktop.checkForUpdates}
                onChange={(on) => update(["desktop", "checkForUpdates"], on)}
              />
            </Field>
            <Field
              label="Include preview releases"
              description="Also offer release candidates, which are less tested."
            >
              <Toggle
                label="Include preview releases"
                checked={settings.desktop.previewReleases}
                onChange={(on) => update(["desktop", "previewReleases"], on)}
              />
            </Field>
          </>
        );
      default: {
        const [type, part] = activeSection.split(".") as ["heatmap" | "line", string];
        const plotLabel = type === "heatmap" ? "HeatMap" : "LinePlot";
        const props = appearance(type);
        return (
          <>
            <SectionHeader
              title={`${plotLabel} defaults`}
              onReset={() => resetSection(["appearance", type])}
            />
            <p className="mb-4 text-xs text-gray-500">
              Applies to every {plotLabel} straight away, except where a plot has its own setting.
            </p>
            {part === "colormap" && <ColormapSection {...props} showColorRange={false} />}
            {part === "style" && <LineStyleSection {...props} />}
            {(part === "x" || part === "y") && (
              <AxisSection
                axis={part}
                plotType={type === "heatmap" ? "heatmap" : "line"}
                {...props}
              />
            )}
          </>
        );
      }
    }
  };

  return (
    <SectionedModal
      isOpen={isOpen}
      onClose={onClose}
      onEscape={handleEscape}
      title="Settings"
      icon={<SettingsIcon size={18} className="text-blue-600" />}
      shortcut="Shift+S"
      accent="blue"
      sections={sections}
      activeSection={activeSection}
      onSelectSection={selectSection}
      navLabel="Settings sections"
      contentRef={contentRef}
      headerActions={
        <>
          <Tooltip content="Import settings" position="bottom">
            <button
              type="button"
              onClick={() => importInputRef.current?.click()}
              className="p-1.5 rounded text-blue-700 hover:bg-blue-200 qimchi-dark-hover-plain transition-colors"
              aria-label="Import settings"
            >
              <Download size={16} />
            </button>
          </Tooltip>
          <Tooltip content="Export settings" position="bottom">
            <button
              type="button"
              onClick={() => void exportSettings()}
              className="p-1.5 rounded text-blue-700 hover:bg-blue-200 qimchi-dark-hover-plain transition-colors"
              aria-label="Export settings"
            >
              <Upload size={16} />
            </button>
          </Tooltip>
          <input
            ref={importInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            aria-label="Settings file to import"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void importSettings(file);
            }}
          />
        </>
      }
      toolbar={
        <div className="space-y-2">
          <div className="relative">
            <Search
              size={14}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400"
            />
            <input
              ref={searchInputRef}
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder="Search settings..."
              aria-label="Search settings"
              className="w-full rounded-md border border-gray-300 bg-white py-1.5 pl-8 pr-8 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <X size={14} />
              </button>
            )}
          </div>
          {!available && (
            <div role="alert" className="flex items-center gap-2 text-sm text-amber-800">
              <AlertTriangle size={15} className="shrink-0" />
              <span>
                Settings can&apos;t be saved right now ({unavailableReason}). Changes apply to this
                window only.
              </span>
            </div>
          )}
        </div>
      }
    >
      {query.trim() ? (
        searchResults.length === 0 ? (
          <div className="pt-8 text-center text-sm text-gray-500">
            No settings found for &ldquo;{query}&rdquo;
          </div>
        ) : (
          <div className="space-y-1" role="group" aria-label="Settings search results">
            <p className="mb-2 text-xs text-gray-500">
              {searchResults.length} result{searchResults.length === 1 ? "" : "s"} · Press Enter to
              open; use the arrow keys to move
            </p>
            {searchResults.map((result, index) => (
              <button
                key={result.id}
                type="button"
                onClick={() => openSearchResult(result)}
                onMouseEnter={() => setHighlightIndex(index)}
                className={`w-full rounded-md border px-3 py-2 text-left transition-colors ${
                  index === highlightIndex
                    ? "border-blue-300 bg-blue-50"
                    : "border-transparent hover:bg-gray-50"
                }`}
              >
                <div className="mb-0.5 flex items-center gap-1 text-[0.6875rem] font-medium text-gray-500">
                  <span>{result.sectionLabel}</span>
                  <ChevronRight size={11} />
                  <span>Setting</span>
                </div>
                <div className="text-sm font-semibold text-gray-800">{result.label}</div>
              </button>
            ))}
          </div>
        )
      ) : (
        <div className="w-full">{renderContent()}</div>
      )}
    </SectionedModal>
  );
};

export default SettingsModal;

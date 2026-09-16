import { useRef, useState } from "react";
import {
  AlertTriangle,
  Download,
  Upload,
  ChartLine,
  ChartScatter,
  FolderOpen,
  FolderTree,
  Grid3x3,
  Image,
  Monitor,
  MoveHorizontal,
  MoveVertical,
  Palette,
  Radio,
  RotateCcw,
  Settings as SettingsIcon,
  SlidersHorizontal,
  Spline,
} from "lucide-react";

import SectionedModal, { type ModalSection } from "./SectionedModal";
import { AxisSection, ColormapSection, LineStyleSection } from "./Plots/AppearanceSections";
import { useSettingsStore } from "../stores/settingsStore";
import { useToast } from "../hooks/useToast";
import { saveTextFile } from "../utils/saveTextFile";
import Tooltip from "./Tooltip";
import {
  FACTORY_SETTINGS,
  PLOT_WIDTHS,
  ZOOM_STEPS,
  type ExplorerSort,
  type UserSettings,
} from "../settings/userSettings";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const isDesktop = () => typeof window !== "undefined" && Boolean(window.pywebview?.api);

const buildSections = (desktop: boolean): ModalSection[] => [
  { id: "general", label: "General", icon: <SlidersHorizontal size={16} /> },
  { id: "plots", label: "Plots", icon: <ChartScatter size={16} /> },
  { id: "explorer", label: "Explorer", icon: <FolderTree size={16} /> },
  { id: "live", label: "Live", icon: <Radio size={16} /> },
  { id: "export", label: "Export", icon: <Image size={16} /> },
  ...(desktop ? [{ id: "desktop", label: "Desktop app", icon: <Monitor size={16} /> }] : []),
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
];

const SORT_LABELS: Record<ExplorerSort, string> = {
  timestamp: "Date",
  name: "Name",
  size: "Size",
  chrono: "Chronological",
};

const Field = ({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) => (
  <div className="flex items-start justify-between gap-6 py-3 border-b border-gray-100 last:border-b-0">
    <div className="min-w-0">
      <div className="text-sm font-medium text-gray-700">{label}</div>
      {description && <div className="mt-0.5 text-xs text-gray-500">{description}</div>}
    </div>
    <div className="shrink-0">{children}</div>
  </div>
);

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
    <span className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></span>
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
    className="inline-flex rounded-md border border-gray-300"
  >
    {options.map((option, index) => (
      <button
        key={String(option.value)}
        type="button"
        role="radio"
        aria-checked={value === option.value}
        onClick={() => onChange(option.value)}
        className={`px-3 py-1 text-sm ${index > 0 ? "border-l border-gray-300" : ""} ${
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
  <div role="group" aria-label={label} className="flex items-center gap-4">
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
  <div className="mb-4 flex items-center justify-between">
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

const SettingsModal = ({ isOpen, onClose }: SettingsModalProps) => {
  const desktop = isDesktop();
  const sections = buildSections(desktop);
  const [activeSection, setActiveSection] = useState("general");
  const settings = useSettingsStore((state) => state.settings);
  const available = useSettingsStore((state) => state.available);
  const unavailableReason = useSettingsStore((state) => state.unavailableReason);
  const update = useSettingsStore((state) => state.update);
  const [confirmingResetAll, setConfirmingResetAll] = useState(false);
  const resetAll = useSettingsStore((state) => state.resetAll);
  const replaceAll = useSettingsStore((state) => state.replaceAll);
  const { showToast } = useToast();
  const importInputRef = useRef<HTMLInputElement | null>(null);

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
            <Field label="Square plots" description="Keep every plot at a 1:1 aspect ratio.">
              <Toggle
                label="Square plots"
                checked={settings.plots.squarify}
                onChange={(on) => update(["plots", "squarify"], on)}
              />
            </Field>
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
            >
              <Toggle
                label="Add new live measurements to the basket"
                checked={settings.live.autoAddToBasket}
                onChange={(on) => update(["live", "autoAddToBasket"], on)}
              />
            </Field>
          </>
        );
      case "export":
        return (
          <>
            <SectionHeader title="Image export" onReset={() => resetSection(["export"])} />
            <Field label="Formats">
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
            <Field label="Variants" description="Images for light and dark backgrounds.">
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
      case "desktop":
        return (
          <>
            <SectionHeader title="Desktop app" onReset={() => resetSection(["desktop"])} />
            <Field
              label="Check for updates"
              description="Look for a new version each time Qimchi starts."
            >
              <Toggle
                label="Check for updates"
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
      title="Settings"
      icon={<SettingsIcon size={18} className="text-blue-600" />}
      shortcut="Shift+S"
      accent="blue"
      sections={sections}
      activeSection={activeSection}
      onSelectSection={selectSection}
      navLabel="Settings sections"
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
        available ? undefined : (
          <div role="alert" className="flex items-center gap-2 text-sm text-amber-800">
            <AlertTriangle size={15} className="shrink-0" />
            <span>
              Settings can&apos;t be saved right now ({unavailableReason}). Changes apply to this
              window only.
            </span>
          </div>
        )
      }
    >
      <div className="max-w-2xl">{renderContent()}</div>
    </SectionedModal>
  );
};

export default SettingsModal;

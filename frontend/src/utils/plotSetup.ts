import type {
  AppliedFilter,
  LineCut,
  PlotConfiguration,
  PlotPersistentState,
  SliderConfig,
} from "../components/interfaces";
import type { PlotAppearanceSettings } from "../components/types";
import {
  FACTORY_APPEARANCE_SETTINGS,
  appearanceOverrides,
  mergeAppearanceDefaults,
} from "../components/Plots/appearanceDefaults";
import { isComposerCompatibleWithDataset, type DatasetLike } from "./datasetFieldSelectors";
import { isMemoryPath } from "./datasetPaths";

type PlotType = PlotConfiguration["plotType"];

// Increment when the saved file format changes.
export const PLOT_SETUP_FORMAT_VERSION = 1;

/** Plot configuration without a measurement path. */
export interface SavedPlot {
  plotType: PlotType;
  indeps: string[];
  deps: string[];
  cut?: LineCut;
  filters?: AppliedFilter[];
  sliders?: Record<string, SliderConfig>;
  /** Appearance values that differ from Qimchi defaults. */
  appearance?: Record<string, unknown>;
  axesSwapped?: boolean;
  width?: number;
  origin?: "auto" | "custom";
}

export interface PlotSetupFile {
  qimchi: "plot-setup";
  formatVersion: number;
  qimchiVersion: string;
  exportedAt: string;
  name?: string;
  plots: SavedPlot[];
}

/** Plot configuration and state prepared for the Viewer. */
export interface PlannedPlot {
  config: Omit<PlotConfiguration, "id">;
  state: Omit<PlotPersistentState, "id">;
  width?: number;
}

type DefaultsFor = (plotType: PlotType) => PlotAppearanceSettings;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isStringList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

const configFilters = (config: PlotConfiguration): AppliedFilter[] =>
  (config.filters_order ?? []).map((name) => ({
    name,
    options: config.filters_opts?.[name] ?? {},
  }));

const savedPlot = (
  config: PlotConfiguration,
  state: PlotPersistentState | undefined,
  width: number | undefined,
  defaultsFor: DefaultsFor,
): SavedPlot => {
  const filters = state?.applied_filters ?? configFilters(config);
  const sliders = state?.slider_settings ?? config.slider ?? {};
  const look = state?.appearance_overrides
    ? mergeAppearanceDefaults(defaultsFor(config.plotType), state.appearance_overrides)
    : state?.appearance_settings
      ? mergeAppearanceDefaults(FACTORY_APPEARANCE_SETTINGS, state.appearance_settings)
      : defaultsFor(config.plotType);
  const appearance = appearanceOverrides(look, FACTORY_APPEARANCE_SETTINGS);

  return {
    plotType: config.plotType,
    indeps: [...config.indeps],
    deps: [...config.deps],
    ...(config.cut ? { cut: config.cut } : {}),
    ...(filters.length ? { filters } : {}),
    ...(Object.keys(sliders).length ? { sliders } : {}),
    ...(Object.keys(appearance).length ? { appearance } : {}),
    ...(state?.axes_swapped ? { axesSwapped: true } : {}),
    ...(width !== undefined ? { width } : {}),
    ...(config.origin ? { origin: config.origin } : {}),
  };
};

/**
 * Save the Viewer's plot configurations without measurement paths.
 * Collapse identical configurations into one saved plot.
 */
export function buildPlotSetup(
  configs: PlotConfiguration[],
  stateFor: (plotId: string) => PlotPersistentState | undefined,
  widthFor: (plotId: string) => number | undefined,
  defaultsFor: DefaultsFor,
  name?: string,
): PlotSetupFile {
  const seen = new Set<string>();
  const plots: SavedPlot[] = [];
  for (const config of configs) {
    const plot = savedPlot(config, stateFor(config.id), widthFor(config.id), defaultsFor);
    const key = JSON.stringify(plot);
    if (seen.has(key)) continue;
    seen.add(key);
    plots.push(plot);
  }

  return {
    qimchi: "plot-setup",
    formatVersion: PLOT_SETUP_FORMAT_VERSION,
    qimchiVersion: __QIMCHI_VERSION__,
    exportedAt: new Date().toISOString(),
    ...(name ? { name } : {}),
    plots,
  };
}

/** Return a plot setup filename with invalid characters removed. */
export function plotSetupFileName(name: string): string {
  const base = name
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\.json$/i, "")
    .replace(/[. ]+$/, "")
    .trim();
  return `${base || "qimchi-plots"}.json`;
}

const readPlot = (value: unknown): SavedPlot | null => {
  if (!isObject(value)) return null;
  const { plotType, indeps, deps } = value;
  if (plotType !== "LinePlot" && plotType !== "HeatMap") return null;
  if (!isStringList(indeps) || indeps.length !== (plotType === "HeatMap" ? 2 : 1)) return null;
  if (!isStringList(deps) || deps.length === 0) return null;

  const plot: SavedPlot = { plotType, indeps, deps };
  const { cut, filters, sliders, appearance, axesSwapped, width, origin } = value;
  if (isObject(cut) && isObject(cut.start) && isObject(cut.end))
    plot.cut = cut as unknown as LineCut;
  if (Array.isArray(filters)) {
    const valid = filters.filter(
      (filter): filter is AppliedFilter => isObject(filter) && typeof filter.name === "string",
    );
    if (valid.length) plot.filters = valid;
  }
  if (isObject(sliders)) {
    const valid = Object.entries(sliders).filter(
      ([, slider]) => isObject(slider) && typeof slider.value === "number",
    );
    if (valid.length) plot.sliders = Object.fromEntries(valid) as Record<string, SliderConfig>;
  }
  if (isObject(appearance)) plot.appearance = appearance;
  if (axesSwapped === true) plot.axesSwapped = true;
  if (typeof width === "number" && width > 0 && width <= 100) plot.width = width;
  if (origin === "auto" || origin === "custom") plot.origin = origin;
  return plot;
};

export type ReadPlotSetupResult =
  | { ok: true; plots: SavedPlot[]; unreadable: number; name?: string }
  | { ok: false; error: string };

/** Parse a plot setup file and skip invalid plot entries. */
export function readPlotSetup(text: string): ReadPlotSetupResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: "That file could not be read as JSON." };
  }
  return readPlotSetupValue(parsed);
}

/** Validate parsed plot setup data, including library entries. */
export function readPlotSetupValue(parsed: unknown): ReadPlotSetupResult {
  if (!isObject(parsed) || parsed.qimchi !== "plot-setup" || !Array.isArray(parsed.plots)) {
    return { ok: false, error: "That is not a saved Qimchi plot setup." };
  }
  if (
    typeof parsed.formatVersion === "number" &&
    parsed.formatVersion > PLOT_SETUP_FORMAT_VERSION
  ) {
    return {
      ok: false,
      error: "That plot setup was saved by a newer version of Qimchi. Update Qimchi to load it.",
    };
  }

  const plots = parsed.plots.map(readPlot).filter((plot): plot is SavedPlot => plot !== null);
  if (plots.length === 0) {
    return { ok: false, error: "That plot setup has no plots in it that Qimchi can draw." };
  }
  const name = typeof parsed.name === "string" && parsed.name.trim() ? parsed.name : undefined;
  return { ok: true, plots, unreadable: parsed.plots.length - plots.length, name };
}

export const describePlot = (plot: SavedPlot): string =>
  `${plot.deps.join(", ")} against ${plot.indeps.join(" and ")}`;

/**
 * Prepare each saved plot for each measurement, skipping incompatible plots.
 */
export function planPlotSetup(
  plots: SavedPlot[],
  datasets: DatasetLike[],
  defaultsFor: DefaultsFor,
): { planned: PlannedPlot[]; skipped: string[] } {
  const planned: PlannedPlot[] = [];
  const skipped: string[] = [];

  for (const dataset of datasets) {
    const source = isMemoryPath(dataset.path) ? "memory" : "disk";
    for (const plot of plots) {
      const fits = isComposerCompatibleWithDataset(
        { indeps: plot.indeps, deps: plot.deps, plotType: plot.plotType },
        dataset.attributes,
      );
      if (fits !== true) {
        skipped.push(`${describePlot(plot)} for ${dataset.name}`);
        continue;
      }

      const filters = plot.filters ?? [];
      const state: Omit<PlotPersistentState, "id"> = {};
      if (filters.length) state.applied_filters = filters;
      if (plot.sliders) state.slider_settings = plot.sliders;
      if (plot.axesSwapped) state.axes_swapped = true;
      const overrides = appearanceOverrides(
        mergeAppearanceDefaults(FACTORY_APPEARANCE_SETTINGS, plot.appearance ?? {}),
        defaultsFor(plot.plotType),
      );
      if (Object.keys(overrides).length) state.appearance_overrides = overrides;

      planned.push({
        config: {
          fpath: dataset.path,
          indeps: [...plot.indeps],
          deps: [...plot.deps],
          plotType: plot.plotType,
          ...(plot.cut ? { cut: plot.cut } : {}),
          filters_order: filters.map((filter) => filter.name),
          filters_opts: Object.fromEntries(
            filters.map((filter) => [filter.name, filter.options ?? {}]),
          ),
          slider: plot.sliders ?? {},
          source,
          preferredSource: source,
          origin: plot.origin ?? "custom",
        },
        state,
        ...(plot.width !== undefined ? { width: plot.width } : {}),
      });
    }
  }

  return { planned, skipped };
}

export interface ComposerAxes {
  plotType: PlotType;
  x: string[];
  y: string[];
  z: string[];
}

/**
 * Return Composer axes when the plots form a complete set of field pairings
 * with a single plot type.
 */
export function composerAxesFor(plots: SavedPlot[]): ComposerAxes | null {
  if (plots.length === 0) return null;
  const plotType = plots[0].plotType;
  if (plots.some((plot) => plot.plotType !== plotType || plot.deps.length !== 1)) return null;

  // Composer stores heat map independents as [y, x].
  const heatmap = plotType === "HeatMap";
  const xOf = (plot: SavedPlot) => (heatmap ? plot.indeps[1] : plot.indeps[0]);
  const yOf = (plot: SavedPlot) => (heatmap ? plot.indeps[0] : plot.deps[0]);
  const zOf = (plot: SavedPlot) => (heatmap ? plot.deps[0] : "");
  const unique = (names: string[]) => [...new Set(names)];

  const x = unique(plots.map(xOf));
  const y = unique(plots.map(yOf));
  const z = unique(plots.map(zOf));
  const pairings = new Set(plots.map((plot) => JSON.stringify([xOf(plot), yOf(plot), zOf(plot)])));
  if (pairings.size !== x.length * y.length * z.length) return null;

  return { plotType, x, y, z: heatmap ? z : [] };
}

import { BasketItem } from "../components/Basket";
import type { PlotConfiguration, AppliedFilter } from "../components/interfaces";
import { isDatasetPath, isMemoryPath } from "./datasetPaths";
import { getFieldIndependents } from "./datasetFieldSelectors";
import type { PlottingBehaviour } from "../settings/userSettings";

interface AutoPlotResult {
  success: boolean;
  message: string;
  plotConfigs: Omit<PlotConfiguration, "id">[]; // Return configs to be added by the caller
}

/**
 * Generates plot configurations for automatic plot creation when a measurement is added to the basket.
 * - HeatMap: the first dependent that actually varies over 2+ independents, against those two
 * - LinePlot: the first dependent, against the first independent it varies over
 *
 * Datasets routinely mix 1D and 2D variables over the same coordinates (two
 * lock-in readings along a voltage sweep next to an S21 map over voltage and
 * frequency). Picking dependents[0] and independents[:2] for the heatmap then
 * forces a 1D variable onto a 2D grid. So the 2D-ness of a variable decides:
 * the heatmap uses the first dependent that has two independents of its own,
 * and when the dataset has none, no heatmap is generated at all.
 *
 * Datasets that do not report per-variable independents (flat tables, payloads
 * cached before that field existed) keep the original first-N behaviour.
 * Returns plot configurations that can be added to the viewer using addPlot().
 *
 * With "heatmapOrLine" (the default) the LinePlot is made only when no HeatMap
 * can be; "both" makes each one that can be made; "none" makes neither.
 *
 * @param item - The basket item to generate plots for
 * @param sourceHeatmapFilters - Optional filters from an existing heatmap to apply
 * @param sourceLineplotFilters - Optional filters from an existing lineplot to apply
 * @param behaviour - Which plots to make, from the Plotting behaviour setting
 */
export function generateAutoPlotConfigs(
  item: BasketItem,
  sourceHeatmapFilters?: AppliedFilter[],
  sourceLineplotFilters?: AppliedFilter[],
  behaviour: PlottingBehaviour = "heatmapOrLine",
): AutoPlotResult {
  try {
    // Only process supported dataset files (disk) or memory:// paths (live) with attributes
    const isDatasetFile = isDatasetPath(item.path);

    if (!isDatasetFile || !item.attributes) {
      return {
        success: false,
        message: "Item is not a valid measurement dataset",
        plotConfigs: [],
      };
    }

    const { independents = [], dependents = [] } = item.attributes;

    if (independents.length === 0 || dependents.length === 0) {
      return {
        success: false,
        message: "Measurement has no independents or dependents",
        plotConfigs: [],
      };
    }

    // Use the path as-is for fpath
    const fpath = item.path;
    const plotConfigs: Omit<PlotConfiguration, "id">[] = [];

    // Determine source based on path type
    const source = isMemoryPath(fpath) ? "memory" : "disk";
    const preferredSource = source;

    // Pick the heatmap's dependent by its own dimensionality, falling back to
    // the plain lists when the dataset reports no per-variable independents.
    const heatmapDep = dependents.find(
      (dep) => (getFieldIndependents(dep, item.attributes) ?? []).length >= 2,
    );
    const heatmapIndeps = heatmapDep
      ? (getFieldIndependents(heatmapDep, item.attributes) ?? []).slice(0, 2)
      : independents.slice(0, 2);
    const knowsVariableIndeps = dependents.some(
      (dep) => getFieldIndependents(dep, item.attributes) !== null,
    );
    // Without dim info, the first two independents remain the best guess.
    const heatmapZ = heatmapDep ?? (knowsVariableIndeps ? undefined : dependents[0]);

    // Attempt to create HeatMap config if we have a dependent over 2 indeps
    if (behaviour !== "none" && heatmapZ && heatmapIndeps.length >= 2) {
      const filters_order: string[] = [];
      const filters_opts: Record<string, unknown> = {};

      if (sourceHeatmapFilters && sourceHeatmapFilters.length > 0) {
        sourceHeatmapFilters.forEach((filter) => {
          filters_order.push(filter.name);
          filters_opts[filter.name] = filter.options ?? {};
        });
      }

      plotConfigs.push({
        origin: "auto" as const,
        fpath,
        indeps: heatmapIndeps,
        deps: [heatmapZ],
        plotType: "HeatMap" as const,
        filters_order,
        filters_opts,
        slider: {},
        source,
        preferredSource,
      });
    }

    // The line plot takes the first dependent against the first independent it
    // actually varies over, which is not necessarily independents[0].
    const lineDep = dependents[0];
    const lineIndep = (getFieldIndependents(lineDep, item.attributes) ?? independents)[0];

    const madeHeatmap = plotConfigs.length > 0;
    const wantLinePlot = behaviour === "both" || (behaviour === "heatmapOrLine" && !madeHeatmap);

    // Attempt to create LinePlot config if we have at least 1 indep and 1 dep
    if (wantLinePlot && lineIndep && lineDep) {
      const filters_order: string[] = [];
      const filters_opts: Record<string, unknown> = {};

      if (sourceLineplotFilters && sourceLineplotFilters.length > 0) {
        sourceLineplotFilters.forEach((filter) => {
          filters_order.push(filter.name);
          filters_opts[filter.name] = filter.options ?? {};
        });
      }

      plotConfigs.push({
        origin: "auto" as const,
        fpath,
        indeps: [lineIndep],
        deps: [lineDep],
        plotType: "LinePlot" as const,
        filters_order,
        filters_opts,
        slider: {},
        source,
        preferredSource,
      });
    }

    // Determine result
    if (plotConfigs.length > 0) {
      return {
        success: true,
        message: `Generated ${plotConfigs.length} default plot(s)`,
        plotConfigs,
      };
    } else {
      return {
        success: false,
        message: "No plots could be generated",
        plotConfigs: [],
      };
    }
  } catch (error) {
    console.error("Error in generateAutoPlotConfigs:", error);
    return {
      success: false,
      message: `Auto-plot failed: ${error instanceof Error ? error.message : String(error)}`,
      plotConfigs: [],
    };
  }
}

/**
 * Source plot to replicate onto another measurement: its configuration plus
 * the filters currently applied to it (those live in plotStore, not the config).
 */
export interface ReplicationSource {
  config: PlotConfiguration;
  filters?: AppliedFilter[];
}

export interface ReplicationResult {
  plotConfigs: Omit<PlotConfiguration, "id">[];
  /** Human-readable reasons plots were skipped, for the toast. */
  skipped: string[];
}

/**
 * Recreate the user's custom plots against a newly added measurement.
 *
 * When a measurement is added while another is loaded, the default-plot pass
 * only produces the standard heatmap/lineplot. Any carefully built custom view
 * would have to be rebuilt by hand for every new measurement, so we mirror
 * each custom plot: same plot type, same dependents/independents, same filters.
 *
 * A plot is only replicated when EVERY variable it uses exists in the target measurement
 */
export function replicateCustomPlots(
  item: BasketItem,
  sources: ReplicationSource[],
): ReplicationResult {
  const result: ReplicationResult = { plotConfigs: [], skipped: [] };

  if (!isDatasetPath(item.path) || !item.attributes) return result;

  const { independents = [], dependents = [] } = item.attributes;
  const haveIndep = new Set(independents);
  const haveDep = new Set(dependents);

  const fpath = item.path;
  const source = isMemoryPath(fpath) ? "memory" : "disk";

  for (const { config, filters } of sources) {
    const missing = [
      ...config.indeps.filter((name) => !haveIndep.has(name)),
      ...config.deps.filter((name) => !haveDep.has(name)),
    ];

    if (missing.length > 0) {
      result.skipped.push(
        `${config.plotType} (${[...new Set(missing)].join(", ")} not in this measurement)`,
      );
      continue;
    }

    // Carry the applied filters across. plotStore keys state by plot id and the
    // replica gets a fresh id, so the filters have to travel in the config.
    let filters_order = config.filters_order;
    let filters_opts = config.filters_opts;
    if (filters?.length) {
      filters_order = filters.map((f) => f.name);
      filters_opts = filters.reduce<Record<string, unknown>>((acc, f) => {
        acc[f.name] = f.options;
        return acc;
      }, {});
    }

    result.plotConfigs.push({
      fpath,
      indeps: [...config.indeps],
      deps: [...config.deps],
      plotType: config.plotType,
      filters_order,
      filters_opts,
      slider: config.slider,
      appearance_settings: config.appearance_settings,
      source,
      preferredSource: source,
      origin: "custom",
    });
  }

  return result;
}

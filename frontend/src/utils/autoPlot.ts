import { BasketItem } from "../components/Basket";
import type { PlotConfiguration, AppliedFilter } from "../components/interfaces";
import { isDatasetPath, isMemoryPath } from "./datasetPaths";

interface AutoPlotResult {
  success: boolean;
  message: string;
  plotConfigs: Omit<PlotConfiguration, "id">[]; // Return configs to be added by the caller
}

/**
 * Generates plot configurations for automatic plot creation when a measurement is added to the basket.
 * - HeatMap: if there are at least 2 independents and 1 dependent
 * - LinePlot: if there is at least 1 independent and 1 dependent
 *
 * Takes the first N independents/dependents in the order they appear in the dataset.
 * Returns plot configurations that can be added to the viewer using addPlot().
 *
 * @param item - The basket item to generate plots for
 * @param sourceHeatmapFilters - Optional filters from an existing heatmap to apply
 * @param sourceLineplotFilters - Optional filters from an existing lineplot to apply
 */
export function generateAutoPlotConfigs(
  item: BasketItem,
  sourceHeatmapFilters?: AppliedFilter[],
  sourceLineplotFilters?: AppliedFilter[]
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

    // Attempt to create HeatMap config if we have at least 2 indeps and 1 dep
    if (independents.length >= 2 && dependents.length >= 1) {
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
        indeps: independents.slice(0, 2), // Take first 2 independents
        deps: [dependents[0]], // Take first dependent
        plotType: "HeatMap" as const,
        filters_order,
        filters_opts,
        slider: {},
        source,
        preferredSource,
      });
    }

    // Attempt to create LinePlot config if we have at least 1 indep and 1 dep
    if (independents.length >= 1 && dependents.length >= 1) {
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
        indeps: [independents[0]], // Take first independent
        deps: [dependents[0]], // Take first dependent
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
  sources: ReplicationSource[]
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
        `${config.plotType} (${[...new Set(missing)].join(", ")} not in this measurement)`
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

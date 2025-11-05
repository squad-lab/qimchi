import { BasketItem } from "../components/Basket";
import type { PlotConfiguration } from "../components/interfaces";

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
 */
export function generateAutoPlotConfigs(
  item: BasketItem
): AutoPlotResult {
  try {
    // Only process .zarr files (disk) or memory:// paths (live) with attributes
    const isZarrFile = item.path.endsWith(".zarr");
    const isMemoryPath = item.path.startsWith("memory://");
    
    if ((!isZarrFile && !isMemoryPath) || !item.attributes) {
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
    const source = fpath.startsWith("memory://") ? "memory" : "disk";
    const preferredSource = source;

    // Attempt to create HeatMap config if we have at least 2 indeps and 1 dep
    if (independents.length >= 2 && dependents.length >= 1) {
      plotConfigs.push({
        fpath,
        indeps: independents.slice(0, 2), // Take first 2 independents
        deps: [dependents[0]], // Take first dependent
        plotType: "HeatMap" as const,
        filters_order: [],
        filters_opts: {},
        slider: {},
        source,
        preferredSource,
      });
    }

    // Attempt to create LinePlot config if we have at least 1 indep and 1 dep
    if (independents.length >= 1 && dependents.length >= 1) {
      plotConfigs.push({
        fpath,
        indeps: [independents[0]], // Take first independent
        deps: [dependents[0]], // Take first dependent
        plotType: "LinePlot" as const,
        filters_order: [],
        filters_opts: {},
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

import { useState, useCallback } from "react";

// Local imports
import type {
  AppliedFilter,
  PlotConfiguration,
} from "../components/interfaces";
import { isMemoryPath, isDatasetPath } from "../utils/datasetPaths";

export interface UsePlotCollectionReturn {
  plotConfigs: PlotConfiguration[];
  /** Add one plot at the FRONT (newest first, matching the Basket). */
  addPlot: (config: Omit<PlotConfiguration, "id">) => void;
  /**
   * Add several plots at the front as one group, preserving their order
   * within the group. Calling addPlot in a loop would reverse them, since
   * each call prepends -- use this for the auto-generated default plots.
   */
  addPlots: (configs: Omit<PlotConfiguration, "id">[]) => void;
  removePlot: (id: string) => void;
  /** Pin/unpin a plot so Next/Prev leaves it on its own measurement. */
  setPlotPinned: (id: string, pinned: boolean) => void;
  clearPlots: () => void;
  /**
   * Repoint unpinned plots at a new dataset (Next/Prev). Pinned plots stay put
   * and gain a following counterpart so the new dataset is not left without
   * that view -- see the implementation.
   */
  updatePlotDataSource: (
    newFpath: string,
    options?: {
      preferMemory?: boolean;
      getFilters?: (plotId: string) => AppliedFilter[] | undefined;
    }
  ) => void;
}

export const usePlotCollection = (): UsePlotCollectionReturn => {
  const [plotConfigs, setPlotConfigs] = useState<PlotConfiguration[]>([]);

  const inferSourceFromPath = useCallback((path: string): "memory" | "disk" => {
    return isMemoryPath(path) ? "memory" : "disk";
  }, []);

  const toMemoryPath = useCallback((path: string): string | null => {
    if (isMemoryPath(path)) {
      return path;
    }

    const normalized = path.replace(/\\/g, "/");
    const segments = normalized.split("/").filter(Boolean);
    if (segments.length === 0) {
      return null;
    }

    const lastSegment = segments[segments.length - 1];
    if (!isDatasetPath(lastSegment)) {
      return null;
    }

    const measurementId = lastSegment.replace(/\.(zarr|nc|h5|hdf5|csv|txt|dat)$/i, "");
    if (!measurementId) {
      return null;
    }

    return `memory://${measurementId}`;
  }, []);

  // Build a full PlotConfiguration from a partial one (path/source
  // normalisation + id). Shared by addPlot and addPlots.
  const buildPlot = useCallback(
    (config: Omit<PlotConfiguration, "id">, seq: number): PlotConfiguration => {
      const prefersMemory =
        config.preferredSource === "memory" ||
        config.source === "memory" ||
        isMemoryPath(config.fpath);

      const normalizedFpath = prefersMemory
        ? toMemoryPath(config.fpath) ?? config.fpath
        : config.fpath;

      const resolvedSource =
        config.source ?? inferSourceFromPath(normalizedFpath);

      return {
        ...config,
        fpath: normalizedFpath,
        source: resolvedSource,
        preferredSource:
          config.preferredSource ?? (prefersMemory ? "memory" : resolvedSource),
        // seq keeps ids unique within a single batch (Date.now() alone is not
        // granular enough when several plots are created in the same tick).
        id: `plot_${Date.now()}_${seq}_${Math.random().toString(36).slice(2, 11)}`,
      };
    },
    [inferSourceFromPath, toMemoryPath]
  );

  const addPlots = useCallback(
    (configs: Omit<PlotConfiguration, "id">[]) => {
      if (configs.length === 0) return;
      const built = configs.map((config, index) => buildPlot(config, index));
      // Newest group first, original order preserved inside the group.
      setPlotConfigs((prev) => [...built, ...prev]);
    },
    [buildPlot]
  );

  const addPlot = useCallback(
    (config: Omit<PlotConfiguration, "id">) => {
      // Newest first, matching the Basket's newest-on-the-left ordering.
      setPlotConfigs((prev) => [buildPlot(config, 0), ...prev]);
    },
    [buildPlot]
  );

  const removePlot = useCallback((id: string) => {
    setPlotConfigs((prev) => prev.filter((plot) => plot.id !== id));
  }, []);

  const setPlotPinned = useCallback((id: string, pinned: boolean) => {
    setPlotConfigs((prev) =>
      prev.map((plot) => (plot.id === id ? { ...plot, pinned } : plot))
    );
  }, []);

  const clearPlots = useCallback(() => {
    setPlotConfigs([]);
  }, []);

  /** Identity of a plot for comparison purposes: type + variables. */
  const plotShape = useCallback(
    (plot: Pick<PlotConfiguration, "plotType" | "indeps" | "deps">): string =>
      [
        plot.plotType,
        [...plot.indeps].sort().join(","),
        [...plot.deps].sort().join(","),
      ].join("|"),
    []
  );

  const updatePlotDataSource = useCallback(
    (
      newFpath: string,
      options?: {
        preferMemory?: boolean;
        getFilters?: (plotId: string) => AppliedFilter[] | undefined;
      }
    ) => {
      const preferMemoryExplicit = Boolean(options?.preferMemory);

      const resolvePath = (plot: PlotConfiguration): string => {
        const preferMemoryImplicit =
          plot.preferredSource === "memory" ||
          plot.source === "memory" ||
          isMemoryPath(plot.fpath);
        const shouldPreferMemory = preferMemoryExplicit || preferMemoryImplicit;
        const memoryCandidate = toMemoryPath(newFpath);
        return shouldPreferMemory && memoryCandidate ? memoryCandidate : newFpath;
      };

      setPlotConfigs((prev) => {
        const repointed = prev.map((plot) => {
          // Pinned plots stay on their own measurement while cycling -- that is
          // the whole point of the pin, so skip them before any path rewriting.
          if (plot.pinned) return plot;

          const preferredPath = resolvePath(plot);
          return {
            ...plot,
            fpath: preferredPath,
            source: inferSourceFromPath(preferredPath),
            preferredSource:
              plot.preferredSource ??
              (isMemoryPath(preferredPath)
                ? "memory"
                : inferSourceFromPath(preferredPath)),
          };
        });

        // A pin is for COMPARING: hold this view on measurement A while the
        // rest follow to B. So every pinned plot needs a live counterpart that
        // does follow -- otherwise pinning the only heatmap means the new
        // dataset simply has no heatmap.
        //
        // Only create one when no unpinned plot of the same shape already
        // exists, or each Next/Prev press would clone the pinned plot again.
        const liveShapes = new Set(
          repointed.filter((plot) => !plot.pinned).map(plotShape)
        );

        const replacements = repointed
          .filter((plot) => plot.pinned && !liveShapes.has(plotShape(plot)))
          .map((plot, index) => {
            const preferredPath = resolvePath({ ...plot, pinned: false });
            // plotStore keys state by plot id and the clone gets a new one, so
            // any applied filters have to travel in the config.
            const filters = options?.getFilters?.(plot.id);
            const carried = filters?.length
              ? {
                  filters_order: filters.map((f) => f.name),
                  filters_opts: filters.reduce<Record<string, unknown>>(
                    (acc, f) => {
                      acc[f.name] = f.options;
                      return acc;
                    },
                    {}
                  ),
                }
              : {
                  filters_order: plot.filters_order,
                  filters_opts: plot.filters_opts,
                };

            return buildPlot(
              {
                ...plot,
                ...carried,
                pinned: false, // the follower must keep following
                fpath: preferredPath,
                source: inferSourceFromPath(preferredPath),
                preferredSource: isMemoryPath(preferredPath)
                  ? "memory"
                  : inferSourceFromPath(preferredPath),
              },
              index
            );
          });

        // Newest first, consistent with addPlot/addPlots.
        return [...replacements, ...repointed];
      });
    },
    [buildPlot, inferSourceFromPath, plotShape, toMemoryPath]
  );

  return {
    plotConfigs,
    addPlot,
    addPlots,
    removePlot,
    setPlotPinned,
    clearPlots,
    updatePlotDataSource,
  };
};

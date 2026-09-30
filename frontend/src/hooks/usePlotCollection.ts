import { useState, useCallback, useEffect } from "react";

// Local imports
import type { AppliedFilter, PlotConfiguration } from "../components/interfaces";
import { usePlotStore } from "../stores/plotStore";
import { isMemoryPath, isDatasetPath } from "../utils/datasetPaths";

const pinnedFirst = (plots: PlotConfiguration[]): PlotConfiguration[] => [
  ...plots.filter((plot) => plot.pinned),
  ...plots.filter((plot) => !plot.pinned),
];

export interface UsePlotCollectionReturn {
  plotConfigs: PlotConfiguration[];
  /** Add one plot after any pinned plots. */
  addPlot: (config: Omit<PlotConfiguration, "id">) => void;
  /**
   * Add several plots after any pinned plots, preserving their order within
   * the group. Use this for auto-generated default plots.
   */
  addPlots: (configs: Omit<PlotConfiguration, "id">[]) => void;
  removePlot: (id: string) => void;
  /** Move a plot to `toIndex` in the list without it. */
  movePlot: (id: string, toIndex: number) => void;
  /** Pin/unpin a plot so Next/Prev leaves it on its own measurement. */
  setPlotPinned: (id: string, pinned: boolean) => void;
  clearPlots: () => void;
  /** Repoint unpinned plots and clone followers for pinned plots. */
  updatePlotDataSource: (
    newFpath: string,
    options?: {
      preferMemory?: boolean;
      getFilters?: (plotId: string) => AppliedFilter[] | undefined;
      /** Return the preset link to copy to a follower. */
      getPresetId?: (plotId: string) => number | undefined;
    },
  ) => void;
}

export const usePlotCollection = (): UsePlotCollectionReturn => {
  const [plotConfigs, setPlotConfigs] = useState<PlotConfiguration[]>([]);

  // Plot IDs are session-scoped, so discard state left by earlier sessions.
  useEffect(() => {
    usePlotStore.getState().keepOnly([]);
  }, []);

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
        ? (toMemoryPath(config.fpath) ?? config.fpath)
        : config.fpath;

      const resolvedSource = config.source ?? inferSourceFromPath(normalizedFpath);

      return {
        ...config,
        fpath: normalizedFpath,
        source: resolvedSource,
        preferredSource: config.preferredSource ?? (prefersMemory ? "memory" : resolvedSource),
        // seq keeps ids unique within a single batch (Date.now() alone is not
        // granular enough when several plots are created in the same tick).
        id: `plot_${Date.now()}_${seq}_${Math.random().toString(36).slice(2, 11)}`,
      };
    },
    [inferSourceFromPath, toMemoryPath],
  );

  const addPlots = useCallback(
    (configs: Omit<PlotConfiguration, "id">[]) => {
      if (configs.length === 0) return;
      const built = configs.map((config, index) => buildPlot(config, index));
      // Pinned plots stay first; the new group leads the remaining plots.
      setPlotConfigs((prev) => pinnedFirst([...built, ...prev]));
    },
    [buildPlot],
  );

  const addPlot = useCallback(
    (config: Omit<PlotConfiguration, "id">) => {
      // Pinned plots stay first; the new plot leads the remaining plots.
      setPlotConfigs((prev) => pinnedFirst([buildPlot(config, 0), ...prev]));
    },
    [buildPlot],
  );

  const removePlot = useCallback((id: string) => {
    setPlotConfigs((prev) => prev.filter((plot) => plot.id !== id));
    // Plot ids are never reused, so keeping the state would grow for as long
    // as the browser profile lives -- it is saved to localStorage.
    usePlotStore.getState().removePlotState(id);
  }, []);

  const movePlot = useCallback((id: string, toIndex: number) => {
    setPlotConfigs((prev) => {
      const plot = prev.find((candidate) => candidate.id === id);
      if (!plot) return prev;
      const rest = prev.filter((candidate) => candidate.id !== id);
      const index = Math.max(0, Math.min(rest.length, toIndex));
      if (prev[index] === plot) return prev;
      return pinnedFirst([...rest.slice(0, index), plot, ...rest.slice(index)]);
    });
  }, []);

  const setPlotPinned = useCallback((id: string, pinned: boolean) => {
    setPlotConfigs((prev) =>
      pinnedFirst(prev.map((plot) => (plot.id === id ? { ...plot, pinned } : plot))),
    );
  }, []);

  const clearPlots = useCallback(() => {
    setPlotConfigs([]);
    usePlotStore.getState().clearAllStates();
  }, []);

  /** Identity of a plot for comparison purposes: type + variables. */
  const plotShape = useCallback(
    (plot: Pick<PlotConfiguration, "plotType" | "indeps" | "deps">): string =>
      [plot.plotType, [...plot.indeps].sort().join(","), [...plot.deps].sort().join(",")].join("|"),
    [],
  );

  const updatePlotDataSource = useCallback(
    (
      newFpath: string,
      options?: {
        preferMemory?: boolean;
        getFilters?: (plotId: string) => AppliedFilter[] | undefined;
        getPresetId?: (plotId: string) => number | undefined;
      },
    ) => {
      const preferMemoryExplicit = Boolean(options?.preferMemory);

      const resolvePath = (plot: PlotConfiguration): string => {
        const preferMemoryImplicit =
          plot.preferredSource === "memory" || plot.source === "memory" || isMemoryPath(plot.fpath);
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
              (isMemoryPath(preferredPath) ? "memory" : inferSourceFromPath(preferredPath)),
          };
        });

        // Give each pinned plot one unpinned follower of the same shape.
        const liveShapes = new Set(repointed.filter((plot) => !plot.pinned).map(plotShape));

        const replacements = repointed
          .filter((plot) => plot.pinned && !liveShapes.has(plotShape(plot)))
          .map((plot, index) => {
            const preferredPath = resolvePath({ ...plot, pinned: false });
            // plotStore keys state by plot id and the clone gets a new one, so
            // any applied filters have to travel in the config.
            const filters = options?.getFilters?.(plot.id);
            const presetId = options?.getPresetId?.(plot.id);
            const carried = filters?.length
              ? {
                  filters_order: filters.map((f) => f.name),
                  filters_opts: filters.reduce<Record<string, unknown>>((acc, f) => {
                    acc[f.name] = f.options;
                    return acc;
                  }, {}),
                  ...(presetId === undefined ? {} : { filter_preset_id: presetId }),
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
              index,
            );
          });

        // Newest first, consistent with addPlot/addPlots.
        return pinnedFirst([...replacements, ...repointed]);
      });
    },
    [buildPlot, inferSourceFromPath, plotShape, toMemoryPath],
  );

  return {
    plotConfigs,
    addPlot,
    addPlots,
    removePlot,
    movePlot,
    setPlotPinned,
    clearPlots,
    updatePlotDataSource,
  };
};

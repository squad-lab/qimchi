import { useState, useCallback } from "react";

// Local imports
import type { PlotConfiguration } from "../components/interfaces";
import { isMemoryPath, isDatasetPath } from "../utils/datasetPaths";

export interface UsePlotCollectionReturn {
  plotConfigs: PlotConfiguration[];
  addPlot: (config: Omit<PlotConfiguration, "id">) => void;
  removePlot: (id: string) => void;
  clearPlots: () => void;
  updatePlotDataSource: (
    newFpath: string,
    options?: { preferMemory?: boolean }
  ) => void; // Update all plots with new data source
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

  const addPlot = useCallback(
    (config: Omit<PlotConfiguration, "id">) => {
      // console.log(
      //   `[usePlotCollection] addPlot called with config:`,
      //   JSON.stringify(config, null, 2)
      // );

      const prefersMemory =
        config.preferredSource === "memory" ||
        config.source === "memory" ||
        isMemoryPath(config.fpath);

      // console.log(
      //   `[usePlotCollection] prefersMemory=${prefersMemory}, fpath=${config.fpath}`
      // );

      const normalizedFpath = prefersMemory
        ? toMemoryPath(config.fpath) ?? config.fpath
        : config.fpath;

      // console.log(
      //   `[usePlotCollection] normalizedFpath=${normalizedFpath} (original=${config.fpath})`
      // );

      const resolvedSource =
        config.source ?? inferSourceFromPath(normalizedFpath);

      // console.log(
      //   `[usePlotCollection] resolvedSource=${resolvedSource}, config.source=${config.source}`
      // );

      const newPlot: PlotConfiguration = {
        ...config,
        fpath: normalizedFpath,
        source: resolvedSource,
        preferredSource:
          config.preferredSource ?? (prefersMemory ? "memory" : resolvedSource),
        id: `plot_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      };

      // console.log(
      //   `[usePlotCollection] Created newPlot:`,
      //   JSON.stringify(newPlot, null, 2)
      // );

      setPlotConfigs((prev) => [...prev, newPlot]);
    },
    [inferSourceFromPath, toMemoryPath]
  );

  const removePlot = useCallback((id: string) => {
    setPlotConfigs((prev) => prev.filter((plot) => plot.id !== id));
  }, []);

  const clearPlots = useCallback(() => {
    setPlotConfigs([]);
  }, []);

  const updatePlotDataSource = useCallback(
    (newFpath: string, options?: { preferMemory?: boolean }) => {
      const preferMemoryExplicit = Boolean(options?.preferMemory);
      setPlotConfigs((prev) =>
        prev.map((plot) => {
          const preferMemoryImplicit =
            plot.preferredSource === "memory" ||
            plot.source === "memory" ||
            isMemoryPath(plot.fpath);

          const shouldPreferMemory = preferMemoryExplicit || preferMemoryImplicit;
          const memoryCandidate = toMemoryPath(newFpath);

          const preferredPath =
            shouldPreferMemory && memoryCandidate ? memoryCandidate : newFpath;

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
        })
      );
    },
    [inferSourceFromPath, toMemoryPath]
  );

  return {
    plotConfigs,
    addPlot,
    removePlot,
    clearPlots,
    updatePlotDataSource,
  };
};

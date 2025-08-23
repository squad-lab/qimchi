import { useState, useCallback } from "react";

// Local imports
import type { PlotConfiguration } from "../components/interfaces";

export interface UsePlotCollectionReturn {
  plotConfigs: PlotConfiguration[];
  addPlot: (config: Omit<PlotConfiguration, "id">) => void;
  removePlot: (id: string) => void;
  clearPlots: () => void;
  updatePlotDataSource: (newFpath: string) => void; // Update all plots with new data source
}

export const usePlotCollection = (): UsePlotCollectionReturn => {
  const [plotConfigs, setPlotConfigs] = useState<PlotConfiguration[]>([]);

  const addPlot = useCallback((config: Omit<PlotConfiguration, "id">) => {
    const newPlot: PlotConfiguration = {
      ...config,
      id: `plot_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    };

    setPlotConfigs((prev) => [...prev, newPlot]);
  }, []);

  const removePlot = useCallback((id: string) => {
    setPlotConfigs((prev) => prev.filter((plot) => plot.id !== id));
  }, []);

  const clearPlots = useCallback(() => {
    setPlotConfigs([]);
  }, []);

  const updatePlotDataSource = useCallback((newFpath: string) => {
    setPlotConfigs((prev) =>
      prev.map((plot) => ({
        ...plot,
        fpath: newFpath,
      }))
    );
  }, []);

  return {
    plotConfigs,
    addPlot,
    removePlot,
    clearPlots,
    updatePlotDataSource,
  };
};

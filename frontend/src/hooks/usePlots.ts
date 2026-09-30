import { useState, useCallback } from "react";
import { PlotAPI, PlotRequest, PlotData } from "../services/plotAPI";
import { useToast } from "./useToast";

export interface UsePlotsReturn {
  plots: PlotData[];
  isLoading: boolean;
  error: string | null;
  createPlots: (request: PlotRequest) => Promise<void>;
  clearPlots: () => void;
  removePlot: (plotId: string, clientId?: string) => void;
}

export const usePlots = (): UsePlotsReturn => {
  const [plots, setPlots] = useState<PlotData[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { showToast } = useToast();

  const createPlots = useCallback(
    async (request: PlotRequest) => {
      setIsLoading(true);
      setError(null);

      try {
        const response = await PlotAPI.createPlots(request);

        if (response.success) {
          // Ensure each plot has a unique ID by adding a timestamp if needed
          const plotsWithUniqueIds = response.plots.map((plot, index) => ({
            ...plot,
            id: plot.id ? plot.id : `plot_${Date.now()}_${index}`,
            // Add a client-side unique identifier as backup
            clientId: `${Date.now()}_${Math.random().toString(36).substr(2, 9)}_${index}`,
          }));

          setPlots((prev) => [...prev, ...plotsWithUniqueIds]);
          if (response.plots.length === 0) {
            showToast("No plots were created.", "info");
          } else {
            showToast(`Successfully created ${response.plots.length} plot(s)`, "success");
          }
        } else {
          setError(response.message);
          showToast(`Failed to create plots: ${response.message}`, "error");
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "Unknown error occurred";
        setError(errorMessage);
        showToast(`Error creating plots: ${errorMessage}`, "error");
      } finally {
        setIsLoading(false);
      }
    },
    [showToast],
  );

  const clearPlots = useCallback(() => {
    setPlots([]);
    setError(null);
  }, []);

  const removePlot = useCallback((plotId: string, clientId?: string) => {
    setPlots((prev) => {
      // If we have a clientId, use that for more precise removal
      const filtered = clientId
        ? prev.filter((plot) => plot.clientId !== clientId)
        : prev.filter((plot, index) => {
            // If no clientId, remove only the first occurrence with matching ID
            const firstMatchIndex = prev.findIndex((p) => p.id === plotId);
            return !(plot.id === plotId && index === firstMatchIndex);
          });

      return filtered;
    });
  }, []);

  return {
    plots,
    isLoading,
    error,
    createPlots,
    clearPlots,
    removePlot,
  };
};

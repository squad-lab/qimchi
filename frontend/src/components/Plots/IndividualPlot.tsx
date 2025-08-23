import React, { useState, useEffect, useCallback, useRef } from "react";
import { Data, Layout, Config } from "plotly.js";
import PlotWrapper from "./PlotWrapper";
import { PlotAPI, PlotRequest } from "../../services/plotAPI";
import type {
  SliderConfig,
  PlotConfiguration,
} from "../../components/interfaces";
import { useToast } from "../../hooks/useToast";

type PlotlyJSON = {
  data: Data[];
  layout: Partial<Layout>;
  config?: Partial<Config>;
};

interface IndividualPlotProps {
  config: PlotConfiguration;
  onRemove: (id: string) => void;
}

const IndividualPlot: React.FC<IndividualPlotProps> = ({
  config,
  onRemove,
}) => {
  const [plotJson, setPlotJson] = useState<PlotlyJSON | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentConfig, setCurrentConfig] = useState<PlotConfiguration>(config);
  const [availableSliders, setAvailableSliders] = useState<
    Record<string, SliderConfig>
  >({});
  // Track if this is a slider-triggered refresh to avoid unmounting PlotWrapper
  const [isSliderRefresh, setIsSliderRefresh] = useState(false);
  const currentConfigRef = useRef(currentConfig);
  const hasInitialized = useRef(false);
  const { showToast } = useToast();

  // Keep ref in sync with state
  useEffect(() => {
    currentConfigRef.current = currentConfig;
  }, [currentConfig]);

  const createPlot = useCallback(
    async (configToUse?: PlotConfiguration) => {
      setIsLoading(true);
      setError(null);

      try {
        const plotConfig = configToUse || currentConfigRef.current;
        console.log(
          `[IndividualPlot] Creating plot with dataset: ${plotConfig.fpath}`
        );
        const request: PlotRequest = {
          fpaths: [plotConfig.fpath], // Convert single path to array for backend compatibility
          indeps: plotConfig.indeps,
          deps: plotConfig.deps,
          plotType: plotConfig.plotType,
          filters_order: plotConfig.filters_order || [],
          filters_opts: plotConfig.filters_opts || {},
          slider: plotConfig.slider || {},
        };

        const response = await PlotAPI.createPlots(request);

        if (response.success && response.plots.length > 0) {
          // Take the first plot from the response
          const plot = response.plots[0];
          setPlotJson(plot.plotJson);

          // Capture auto-generated slider configuration from backend
          if (plot.slider_config) {
            setAvailableSliders(plot.slider_config);
          } else {
            setAvailableSliders({});
          }
        } else {
          const errorMsg = response.message || "No plots created";
          setError(errorMsg);
          showToast(`Failed to create plot: ${errorMsg}`, "error");
        }
      } catch (err) {
        let errorMessage = "Unknown error occurred";

        if (err instanceof Error) {
          errorMessage = err.message;

          // Provide more specific error messages for common issues
          if (
            errorMessage.includes("not found") ||
            errorMessage.includes("KeyError")
          ) {
            const config = currentConfigRef.current;
            errorMessage = `Variable not found in dataset. The plot uses variables [${config.indeps.join(
              ", "
            )}] → [${config.deps.join(
              ", "
            )}] which may not exist in this dataset.`;
          } else if (
            errorMessage.includes("dimension") ||
            errorMessage.includes("shape")
          ) {
            errorMessage = `Data shape mismatch. The selected variables may have incompatible dimensions in this dataset.`;
          } else if (
            errorMessage.includes("path") ||
            errorMessage.includes("file")
          ) {
            errorMessage = `Dataset file not accessible: ${currentConfigRef.current.fpath}`;
          }
        }

        setError(errorMessage);
        // Don't show toast since the plot component displays the detailed error
      } finally {
        setIsLoading(false);
        setIsSliderRefresh(false); // Reset slider refresh flag
      }
    },
    [showToast]
  ); // No dependency on currentConfig, use ref instead

  // Special refresh function for slider changes that preserves PlotWrapper state
  // Note: This is no longer needed as PlotWrapper handles filter/slider application directly
  // const refreshForSliders = useCallback(async () => {
  //   const currentConfig = currentConfigRef.current;
  //   console.log(`[IndividualPlot] refreshForSliders called - recreating plot with dataset: ${currentConfig.fpath}`);
  //   setIsSliderRefresh(true);
  //   await createPlot(currentConfig);
  // }, [createPlot]);

  const handleConfigUpdate = useCallback(
    (updates: Partial<PlotConfiguration>) => {
      setCurrentConfig((prev) => {
        // For filters, completely replace them instead of merging to avoid duplication
        const newConfig = { ...prev };

        // Handle filters specially to avoid duplication
        if ("filters_order" in updates || "filters_opts" in updates) {
          newConfig.filters_order = updates.filters_order || [];
          newConfig.filters_opts = updates.filters_opts || {};
        }

        // Handle other updates normally
        Object.keys(updates).forEach((key) => {
          if (key !== "filters_order" && key !== "filters_opts") {
            const typedKey = key as keyof PlotConfiguration;
            const typedNewConfig = newConfig as Record<
              keyof PlotConfiguration,
              unknown
            >;
            const typedUpdates = updates as Record<
              keyof PlotConfiguration,
              unknown
            >;
            typedNewConfig[typedKey] = typedUpdates[typedKey];
          }
        });

        return newConfig;
      });
      // Don't automatically refresh - let the PlotWrapper handle refresh via onRefresh
    },
    []
  );

  const handleRetryClick = useCallback(() => {
    createPlot();
  }, [createPlot]);

  // Update current config when props change and refresh plot if fpath changed
  useEffect(() => {
    const previousFpath = currentConfigRef.current.fpath;
    setCurrentConfig(config);

    // If this is not the initial setup and the fpath has changed, DON'T recreate the plot
    // Let PlotWrapper handle the dataset change by updating data source in place
    if (hasInitialized.current && previousFpath !== config.fpath) {
      console.log(
        `[IndividualPlot] Dataset changed from ${previousFpath} to ${config.fpath}, NOT recreating plot`
      );
      setError(null);
      // Don't call createPlot() - preserve the existing plot and let PlotWrapper handle data source change
    }
  }, [config]);

  // Only create plot on initial mount - prevent double execution
  useEffect(() => {
    if (!hasInitialized.current) {
      hasInitialized.current = true;
      createPlot();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleClose = () => {
    onRemove(config.id);
  };

  // Show loading state for initial load or non-slider refreshes
  if (isLoading && !isSliderRefresh) {
    return (
      <div className="relative min-h-[400px] flex items-center justify-center bg-gray-50 rounded-lg">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-2"></div>
          <p className="text-sm text-gray-600">Creating plot...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="relative min-h-[400px] flex items-center justify-center bg-red-50 rounded-lg border border-red-200">
        <div className="text-center max-w-md">
          <p className="text-red-700 font-medium">Failed to create plot</p>
          <p className="text-red-600 text-sm mt-1 mb-2">{error}</p>

          {/* Show current plot configuration for debugging */}
          <div className="text-xs text-gray-600 bg-gray-100 p-2 rounded mb-3">
            <div>
              <strong>Dataset:</strong> {currentConfig.fpath.split("/").pop()}
            </div>
            <div>
              <strong>Variables:</strong> [{currentConfig.indeps.join(", ")}] →
              [{currentConfig.deps.join(", ")}]
            </div>
            <div>
              <strong>Plot Type:</strong> {currentConfig.plotType}
            </div>
          </div>

          <div className="space-x-2">
            <button
              onClick={handleRetryClick}
              className="px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 transition-colors"
            >
              Retry
            </button>
            <button
              onClick={handleClose}
              className="px-3 py-1 bg-gray-600 text-white text-sm rounded hover:bg-gray-700 transition-colors"
            >
              Remove
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Show loading state when plot data hasn't loaded yet and we're still loading
  if (!plotJson && isLoading) {
    return (
      <div className="relative min-h-[400px] flex items-center justify-center bg-gray-50 rounded-lg">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-2"></div>
          <p className="text-sm text-gray-600">Creating plot...</p>
        </div>
      </div>
    );
  }

  if (!plotJson) {
    return (
      <div className="relative min-h-[400px] flex items-center justify-center bg-gray-50 rounded-lg">
        <div className="text-center text-gray-500">
          <p className="text-lg font-medium">No plot data</p>
          <p className="text-sm">Unable to load plot data</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-[400px]">
      <PlotWrapper
        plotJson={plotJson}
        onClose={handleClose}
        plotConfig={currentConfig}
        onUpdateConfig={handleConfigUpdate}
        availableSliders={availableSliders}
        isLoading={isLoading && isSliderRefresh} // Pass loading state for slider refreshes
        // live dataset props removed
      />
    </div>
  );
};

export default IndividualPlot;

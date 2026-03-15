import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
} from "react";
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

type CreatePlotOptions = {
  silent?: boolean;
  skipIfPending?: boolean;
};

const MEMORY_REFRESH_INTERVAL_MS = 500;

const inferSourceFromPath = (path: string): "memory" | "disk" => {
  const inferred = path.startsWith("memory://") ? "memory" : "disk";
  console.log(`[IndividualPlot] inferSourceFromPath(${path}) -> ${inferred}`);
  return inferred;
};

interface IndividualPlotProps {
  config: PlotConfiguration;
  onRemove: (id: string) => void;
}

type PlotLiveStatus = "live" | "paused" | "error" | "completed";

const IndividualPlot: React.FC<IndividualPlotProps> = ({
  config,
  onRemove,
}) => {
  const [plotJson, setPlotJson] = useState<PlotlyJSON | null>(null);
  const [plotRef, setPlotRef] = useState<string | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentConfig, setCurrentConfig] = useState<PlotConfiguration>(config);
  const [isFiltersModalOpen, setIsFiltersModalOpen] = useState(false);
  const [availableSliders, setAvailableSliders] = useState<
    Record<string, SliderConfig>
  >({});
  const currentConfigRef = useRef(currentConfig);
  const hasInitialized = useRef(false);
  const { showToast } = useToast();
  const fetchInFlight = useRef(false);
  const autoRefreshTimer = useRef<number | null>(null);
  // Guard against transient live read failures by requiring multiple
  // consecutive non-live responses before marking the measurement completed.
  const consecutiveNonLiveCount = useRef(0);
  const CONSECUTIVE_NON_LIVE_THRESHOLD = 10;

  const plotStatus: PlotLiveStatus = useMemo(() => {
    if (error) {
      return "error";
    }

    if (currentConfig.source !== "memory") {
      return "completed";
    }

    return isFiltersModalOpen ? "paused" : "live";
  }, [error, currentConfig.source, isFiltersModalOpen]);

  // Keep ref in sync with state
  useEffect(() => {
    currentConfigRef.current = currentConfig;
  }, [currentConfig]);

  const createPlot = useCallback(
    async (
      configToUse?: PlotConfiguration,
      options: CreatePlotOptions = {},
    ) => {
      if (options.skipIfPending && fetchInFlight.current) {
        return;
      }

      fetchInFlight.current = true;

      if (!options.silent) {
        setIsLoading(true);
      }

      try {
        const plotConfig = configToUse || currentConfigRef.current;
        console.log(
          `[IndividualPlot] Creating plot with dataset: ${plotConfig.fpath}`,
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
          setPlotRef(plot.plot_ref);

          // Track consecutive non-live responses. The backend returns is_live=false
          // both for transient WebSocket failures (recovers next poll) and for
          // permanently ended measurements. Only switch to disk after several
          // consecutive non-live responses to avoid killing the poll on a blip.
          if (plot.is_live === false) {
            consecutiveNonLiveCount.current += 1;
          } else {
            consecutiveNonLiveCount.current = 0;
          }

          if (
            plot.is_live === false &&
            currentConfigRef.current.source === "memory" &&
            consecutiveNonLiveCount.current >= CONSECUTIVE_NON_LIVE_THRESHOLD
          ) {
            const resolvedPath =
              typeof plot.resolved_fpath === "string" &&
              plot.resolved_fpath.length > 0
                ? plot.resolved_fpath
                : currentConfigRef.current.fpath;
            console.log(
              `[IndividualPlot] Measurement completed (${consecutiveNonLiveCount.current} consecutive non-live responses), switching to disk source at: ${resolvedPath}`,
            );
            setCurrentConfig((prev) => ({
              ...prev,
              source: "disk",
              fpath: resolvedPath,
            }));
          }

          const clonedPlotJson: PlotlyJSON = structuredClone(plot.plotJson);
          if (Array.isArray(clonedPlotJson.data)) {
            clonedPlotJson.data = clonedPlotJson.data.map((trace, idx) => {
              if (!trace || typeof trace !== "object") {
                return trace;
              }

              const hovertemplate = (
                trace as {
                  hovertemplate?: unknown;
                }
              ).hovertemplate;
              const zValue = (trace as { z?: unknown }).z;

              if (
                typeof hovertemplate === "string" &&
                hovertemplate.includes("%{z") &&
                zValue == null
              ) {
                console.warn(
                  `[IndividualPlot] Trace ${idx} (${
                    (trace as { name?: string; type?: string }).name ||
                    (trace as { type?: string }).type ||
                    "unknown"
                  }) has hovertemplate referencing %{{z}} but no z data; sanitizing template`,
                );
                let sanitizedTemplate = hovertemplate
                  .split("<br>")
                  .filter((segment: string) => !segment.includes("%{z"))
                  .join("<br>");
                if (!sanitizedTemplate.includes("<extra")) {
                  sanitizedTemplate = `${sanitizedTemplate}<extra></extra>`;
                }
                return {
                  ...trace,
                  hovertemplate: sanitizedTemplate,
                };
              }

              return trace;
            });
          }
          clonedPlotJson.layout = {
            ...(clonedPlotJson.layout || {}),
            // Ensure Plotly.react sees a revision bump even if data arrays compare equal
            datarevision: Date.now(),
            // Keep uirevision stable so Plotly preserves the user's zoom/pan state
            // across live refresh cycles. Changing it would reset zoom every 500 ms.
            uirevision: currentConfigRef.current.fpath,
          };
          setPlotJson(clonedPlotJson);
          setError(null);

          // Capture auto-generated slider configuration from backend
          if (plot.slider_config) {
            setAvailableSliders(plot.slider_config);
          } else {
            setAvailableSliders({});
          }
        } else {
          const errorMsg = response.message || "No plots created";
          setError(errorMsg);
          if (!options.silent) {
            showToast(`Failed to create plot: ${errorMsg}`, "error", 5000, "Plotter", {
              dataset: plotConfig.fpath,
              type: plotConfig.plotType,
              vars: { indeps: plotConfig.indeps, deps: plotConfig.deps },
              backend_error: errorMsg
            });
          }
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
              ", ",
            )}] → [${config.deps.join(
              ", ",
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
        if (!options.silent) {
          setIsLoading(false);
        }
        fetchInFlight.current = false;
      }
    },
    [showToast],
  ); // No dependency on currentConfig, use ref instead

  const handleConfigUpdate = useCallback(
    (updates: Partial<PlotConfiguration>) => {
      console.log("[IndividualPlot] handleConfigUpdate invoked with", updates);
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
          if (
            key === "filters_order" ||
            key === "filters_opts" ||
            key === "fpath" ||
            key === "source"
          ) {
            return;
          }

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
        });

        if (typeof updates.fpath === "string") {
          newConfig.fpath = updates.fpath;
          const shouldDeriveSource =
            !("source" in updates) || updates.source === undefined;
          if (shouldDeriveSource) {
            const inferred = inferSourceFromPath(updates.fpath);
            console.log(
              `[IndividualPlot] handleConfigUpdate inferred source ${inferred} for ${updates.fpath}`,
            );
            newConfig.source = inferred;
          }
        }

        if (typeof updates.source === "string") {
          console.log(
            `[IndividualPlot] handleConfigUpdate received explicit source ${updates.source}`,
          );
          newConfig.source = updates.source;
        }

        console.log(
          "[IndividualPlot] handleConfigUpdate next config",
          newConfig,
        );
        return newConfig;
      });
      // Don't automatically refresh - let the PlotWrapper handle refresh via onRefresh
    },
    [],
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
        `[IndividualPlot] Dataset changed from ${previousFpath} to ${config.fpath}, NOT recreating plot`,
      );
      setError(null);
      // Don't call createPlot() - preserve the existing plot and let PlotWrapper handle data source change
    }
  }, [config]);

  useEffect(() => {
    // Only check the source field, not fpath
    // (fpath may still be memory:// even when loading from disk)
    const isMemorySource = currentConfig.source === "memory";

    // Log current source and fpath
    console.log(
      `[IndividualPlot] auto-refresh check: fpath=${currentConfig.fpath} | source=${currentConfig.source} | isMemorySource=${isMemorySource}`,
    );

    if (!isMemorySource || isFiltersModalOpen) {
      console.log(
        `[IndividualPlot] auto-refresh disabled for source=${currentConfig.source}, filtersModalOpen=${isFiltersModalOpen}`,
      );
      if (autoRefreshTimer.current !== null) {
        window.clearInterval(autoRefreshTimer.current);
        autoRefreshTimer.current = null;
      }
      return;
    }

    if (autoRefreshTimer.current !== null) {
      console.log(
        "[IndividualPlot] Clearing existing auto-refresh interval before creating new one",
      );
      window.clearInterval(autoRefreshTimer.current);
    }

    const intervalId = window.setInterval(() => {
      console.log(
        "[IndividualPlot] auto-refresh interval firing for memory dataset",
      );
      createPlot(undefined, { silent: true, skipIfPending: true });
    }, MEMORY_REFRESH_INTERVAL_MS);
    console.log(
      `[IndividualPlot] auto-refresh interval set (id=${intervalId}) for source=${currentConfig.source} fpath=${currentConfig.fpath}`,
    );
    autoRefreshTimer.current = intervalId;

    return () => {
      console.log(
        "[IndividualPlot] auto-refresh effect cleanup running, clearing interval",
      );
      if (autoRefreshTimer.current !== null) {
        window.clearInterval(autoRefreshTimer.current);
        autoRefreshTimer.current = null;
      }
    };
  }, [
    currentConfig.fpath,
    currentConfig.source,
    createPlot,
    isFiltersModalOpen,
  ]);

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

  if (isLoading) {
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
        plotRef={plotRef}
        plotStatus={plotStatus}
        onClose={handleClose}
        plotConfig={currentConfig}
        onUpdateConfig={handleConfigUpdate}
        onFiltersModalOpenChange={setIsFiltersModalOpen}
        availableSliders={availableSliders}
      />
    </div>
  );
};

export default IndividualPlot;

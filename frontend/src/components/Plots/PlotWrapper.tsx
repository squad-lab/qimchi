import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  startTransition,
} from "react";
import { flushSync } from "react-dom";
import axios from "axios";
import {
  Maximize2,
  Minimize2,
  Palette,
  X,
  Filter,
  RotateCcw,
  Paintbrush,
  ImageDown,
  ImagePlus,
  ArrowLeftRight,
} from "lucide-react";
import { Data, Layout, Config } from "plotly.js";
import type { AxisType, Dash } from "plotly.js";

// Local imports
import plotlyColorscales from "./plotly_colorscales_plotlyjs.json";
import { PlotAPI } from "../../services/plotAPI";
import { PROD_BACKEND_URL } from "../../config";
import "./PlotWrapper.css";
import PlotComponent from "./Plot";
import AppearanceModal from "./AppearanceModal";
import FiltersModal from "./FiltersModal";
import type { AppliedFilter } from "../../components/interfaces";
import type { PlotAppearanceSettings } from "../../components/types";
import type {
  PlotConfiguration,
  SliderConfig,
} from "../../components/interfaces";
import { useToast } from "../../hooks/useToast";
import { usePlotStore } from "../../stores/plotStore";
import type { PlotPersistentState } from "../../components/interfaces";
import usePainterStore from "../../stores/painterStore";
import Tooltip from "../Tooltip";

type PlotlyJSON = {
  data: Data[];
  layout: Partial<Layout>;
  config?: Partial<Config>;
};

type PlotLiveStatus = "live" | "paused" | "error" | "completed";

type Props = {
  plotJson: PlotlyJSON;
  plotRef?: string;
  plotStatus?: PlotLiveStatus;
  onClose?: () => void;
  plotConfig?: PlotConfiguration;
  onUpdateConfig?: (config: Partial<PlotConfiguration>) => void;
  onFiltersModalOpenChange?: (isOpen: boolean) => void;
  availableSliders?: Record<string, SliderConfig>; // Sliders from backend
};

// Default appearance settings based on backend
const DEFAULT_APPEARANCE_SETTINGS: PlotAppearanceSettings = {
  hmap: {
    colorscale: "viridis",
    rangecolor: null,
  },
  line: {
    mode: "lines+markers",
    color: "#6acc64",
    width: 3,
    opacity: 1.0,
    dash: "solid",
    shape: "linear",
    smoothing: 0.9,
  },
  marker: {
    color: "#6acc64",
    size: 6,
    symbol: "circle",
    opacity: 0.5,
  },
  x: {
    maj: {
      showgrid: false,
      type: "linear",
      nticks: 5,
      gridcolor: "gray",
      griddash: "solid",
      gridwidth: 1,
      tickcolor: "gray",
      tickwidth: 1,
      ticklen: 5,
      tickangle: 0,
    },
    min: {
      showgrid: false,
      nticks: 5,
      gridcolor: "gray",
      griddash: "solid",
      gridwidth: 1,
      tickcolor: "gray",
      tickwidth: 1,
      ticklen: 4,
    },
  },
  y: {
    maj: {
      showgrid: false,
      type: "linear",
      nticks: 5,
      gridcolor: "gray",
      griddash: "solid",
      gridwidth: 1,
      tickcolor: "gray",
      tickwidth: 1,
      ticklen: 5,
      tickangle: 0,
    },
    min: {
      showgrid: false,
      nticks: 5,
      gridcolor: "gray",
      griddash: "solid",
      gridwidth: 1,
      tickcolor: "gray",
      tickwidth: 1,
      ticklen: 4,
    },
  },
};

// Recursively merge persisted appearance settings with defaults, while validating shapes.
const mergeAppearanceDefaults = (
  defaults: PlotAppearanceSettings,
  persisted: unknown,
): PlotAppearanceSettings => {
  if (!persisted || typeof persisted !== "object") return defaults;

  const p = persisted as Record<string, unknown>;

  const merge = (def: unknown, pit: unknown): unknown => {
    if (Array.isArray(def)) {
      return Array.isArray(pit) ? pit : def;
    }
    if (def === null || typeof def !== "object") {
      // primitive
      return typeof pit === typeof def ? pit : def;
    }
    const defObj = def as Record<string, unknown>;
    const out: Record<string, unknown> = { ...defObj };
    for (const key of Object.keys(defObj)) {
      const childDef = defObj[key];
      const childPit = (pit as Record<string, unknown> | undefined)?.[key];
      out[key] = merge(childDef, childPit);
    }
    return out;
  };

  return merge(defaults, p) as PlotAppearanceSettings;
};

// Helper function to get colorscale data from name
const getColorscaleData = (
  name: string,
): string | Array<[number, string]> | Array<Array<number | string>> => {
  const key = name.toLowerCase();

  // First, try to get from our JSON file
  if (key in plotlyColorscales) {
    return plotlyColorscales[key as keyof typeof plotlyColorscales] as Array<
      [number, string]
    >;
  }

  // Fallback: return capitalized name for built-in Plotly colorscales
  const builtInMap: Record<string, string> = {
    viridis: "Viridis",
    plasma: "Plasma",
    inferno: "Inferno",
    magma: "Magma",
    cividis: "Cividis",
    blues: "Blues",
    greens: "Greens",
    greys: "Greys",
    oranges: "Oranges",
    purples: "Purples",
    reds: "Reds",
    ylorrd: "YlOrRd",
    ylorbr: "YlOrBr",
    ylgnbu: "YlGnBu",
    ylgn: "YlGn",
    spectral: "Spectral",
    rdylbu: "RdYlBu",
    rdylgn: "RdYlGn",
    rdbu: "RdBu",
    piyg: "PiYG",
    prgn: "PRGn",
    brbg: "BrBG",
    puor: "PuOr",
    rdgy: "RdGy",
    turbo: "Turbo",
    hot: "Hot",
    jet: "Jet",
    rainbow: "Rainbow",
    sinebow: "Sinebow",
  };
  return builtInMap[key] || name.charAt(0).toUpperCase() + name.slice(1);
};

const swapAxesInPlotJson = (plotJson: PlotlyJSON): PlotlyJSON => {
  // Shallow-clone with shared references
  const swapped: PlotlyJSON = { ...plotJson };

  if (plotJson.data && plotJson.data.length > 0) {
    swapped.data = plotJson.data.map((trace) => {
      const swappedTrace = { ...trace } as Record<string, unknown>;
      const traceAny = trace as Record<string, unknown>;

      if (trace.type === "heatmap" || trace.type === "heatmapgl") {
        // For heatmaps, swap x and y coordinates
        const xObj = traceAny.x as Record<string, unknown> | undefined;
        const yObj = traceAny.y as Record<string, unknown> | undefined;
        const zObj = traceAny.z as Record<string, unknown> | undefined;

        if (xObj && yObj) {
          swappedTrace.x = { ...yObj };
          swappedTrace.y = { ...xObj };
        }

        // Use Plotly's transpose property
        if (zObj) {
          swappedTrace.transpose = true;
        }
      } else {
        // For line plots and other types, just swap x and y
        const x = traceAny.x;
        const y = traceAny.y;
        if (x !== undefined && y !== undefined) {
          swappedTrace.x = y;
          swappedTrace.y = x;
        }
      }

      return swappedTrace as Data;
    });
  }

  if (plotJson.layout) {
    swapped.layout = { ...plotJson.layout };
    const layoutAny = swapped.layout as Record<string, unknown>;
    // Swap xaxis and yaxis properties
    if (layoutAny.xaxis && layoutAny.yaxis) {
      const tempXaxis = { ...(layoutAny.xaxis as object) };
      layoutAny.xaxis = { ...(layoutAny.yaxis as object) };
      layoutAny.yaxis = tempXaxis;

      // Remove range properties to force autoscale after swap
      // This ensures Plotly recalculates the correct axis ranges
      const xaxisAny = layoutAny.xaxis as Record<string, unknown>;
      const yaxisAny = layoutAny.yaxis as Record<string, unknown>;
      if ("range" in xaxisAny) {
        delete xaxisAny.range;
      }
      if ("range" in yaxisAny) {
        delete yaxisAny.range;
      }
      xaxisAny.autorange = true;
      yaxisAny.autorange = true;
    }
    const now = Date.now();
    (swapped.layout as Record<string, unknown>).datarevision = now;
  }

  return swapped;
};

const PlotWrapper: React.FC<Props> = ({
  plotJson,
  plotRef,
  plotStatus = "completed",
  onClose,
  plotConfig,
  onUpdateConfig,
  onFiltersModalOpenChange,
  availableSliders = {},
}) => {
  const { showToast } = useToast();

  // Detect plot type from plotJson
  const detectPlotType = (plotData: PlotlyJSON): string => {
    if (!plotData.data || plotData.data.length === 0) {
      return "line";
    }

    const firstTrace = plotData.data[0];
    // Check for heatmap types
    if (firstTrace.type === "heatmap" || firstTrace.type === "heatmapgl") {
      return "heatmap";
    }

    // Default to line plot for scatter, line, etc.
    return "line";
  };

  const plotType = detectPlotType(plotJson);

  // Extract plot title from plotJson
  const getPlotTitle = (plotData: PlotlyJSON): string => {
    const layout = plotData.layout;
    if (!layout) return "";

    if (typeof layout.title === "string") {
      return layout.title;
    }

    if (layout.title && typeof layout.title === "object" && layout.title.text) {
      return layout.title.text;
    }

    return "";
  };

  const plotTitle = getPlotTitle(plotJson);

  // Initialize settings based on plot type
  const getInitialSettings = (plotType: string): PlotAppearanceSettings => {
    const baseSettings = { ...DEFAULT_APPEARANCE_SETTINGS };

    if (plotType === "heatmap") {
      // Ensure heatmap settings are included
      baseSettings.hmap = baseSettings.hmap || {
        colorscale: "viridis",
        rangecolor: null,
      };
    }

    return baseSettings;
  };

  const [isMaximized, setIsMaximized] = useState(false);
  const [isAppearanceModalOpen, setIsAppearanceModalOpen] = useState(false);
  // Squarify state - when true, force the plot container to maintain 1:1 aspect ratio
  const [isSquareMode, setIsSquareMode] = useState<boolean>(false);
  const [appearanceSettings, setAppearanceSettings] =
    useState<PlotAppearanceSettings>(() => getInitialSettings(plotType));
  const [customizedPlotJson, setCustomizedPlotJson] =
    useState<PlotlyJSON>(plotJson);
  const [isHoveredOrFocused, setIsHoveredOrFocused] = useState(false);
  const [relayoutData, setRelayoutData] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [activePlotRef, setActivePlotRef] = useState<string | undefined>(
    plotRef,
  );

  // Store the original plot JSON (never modified, always the raw data from backend)
  const [originalPlotJson, setOriginalPlotJson] =
    useState<PlotlyJSON>(plotJson);
  // Store the base plot JSON (original or filtered, before appearance modifications)

  useEffect(() => {
    setActivePlotRef(plotRef);
  }, [plotRef]);

  const handleRelayout = useCallback((data: Record<string, unknown>) => {
    setRelayoutData(data);
  }, []);

  // Save plot as PNG, PDF & SVG
  const handleSavePlotImages = async () => {
    if (!plotConfig || !customizedPlotJson) {
      showToast("No plot configuration or plot data available.", "error");
      return;
    }

    try {
      showToast("Starting export... This may take a moment.", "info");

      // Step 1: Start the export task
      const startResponse = await axios.post(
        `${PROD_BACKEND_URL}/export-plot-images`,
        {
          plot_json: customizedPlotJson,
          fpath: plotConfig.fpath,
          relayout_data: relayoutData,
        },
        {
          headers: { "Content-Type": "application/json" },
        },
      );

      if (startResponse.status !== 202 || !startResponse.data.task_id) {
        throw new Error(startResponse.data.message || "Failed to start export");
      }

      const taskId = startResponse.data.task_id;

      // Step 2: Poll for completion
      const pollInterval = 500; // 500ms
      const maxPolls = 120; // 60 seconds max
      let pollCount = 0;

      while (pollCount < maxPolls) {
        await new Promise((resolve) => setTimeout(resolve, pollInterval));
        pollCount++;

        const statusResponse = await axios.get(
          `${PROD_BACKEND_URL}/export-plot-images/status/${taskId}`,
        );

        const status = statusResponse.data.status;

        if (status === "completed") {
          // Download the zip file
          const downloadUrl = `${PROD_BACKEND_URL}${statusResponse.data.download_url}`;
          const filename =
            statusResponse.data.zip_filename || "plot_images.zip";

          const downloadResponse = await axios.get(downloadUrl, {
            responseType: "blob",
          });

          const blob = new Blob([downloadResponse.data], {
            type: "application/zip",
          });
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          a.remove();
          window.URL.revokeObjectURL(url);

          showToast(`Downloaded ${filename}`, "success");
          return;
        } else if (status === "failed") {
          throw new Error(statusResponse.data.error || "Export failed");
        }
        // status === "pending", continue polling
      }

      throw new Error("Export timed out after 60 seconds");
    } catch (error: any) {
      console.error("Export error:", error);
      showToast(
        error.response?.data?.message ||
          error.message ||
          "Failed to export plot images",
        "error",
      );
    }
  };

  // Save light/dark PNGs and append markdown to notes
  const handleSendToNotes = async () => {
    if (!plotConfig || !customizedPlotJson) {
      showToast("No plot configuration or plot data available.", "error");
      return;
    }

    try {
      const axiosResponse = await axios.post(
        `${PROD_BACKEND_URL}/export-plot-images/send-to-notes`,
        {
          plot_json: customizedPlotJson,
          fpath: plotConfig.fpath,
          relayout_data: relayoutData,
        },
        {
          headers: { "Content-Type": "application/json" },
          responseType: "json",
        },
      );

      const data = axiosResponse.data;
      if (axiosResponse.status >= 200 && data && data.success) {
        showToast(data.message || "Saved to notes", "success");
        // notify notes panel to append the markdown line
        if (data.md_line) {
          try {
            window.dispatchEvent(
              new CustomEvent("notes:append", {
                detail: {
                  datasetPath: plotConfig.fpath,
                  md_line: data.md_line,
                },
              }),
            );
          } catch {
            // ignore dispatch errors
          }
        }
      } else {
        showToast(
          (data && data.message) || "Failed to send to notes.",
          "error",
        );
      }
    } catch (err) {
      showToast(`Failed to send to notes: ${err}`, "error");
    }
  };
  const [basePlotJson, setBasePlotJson] = useState<PlotlyJSON>(plotJson);

  // Filters state
  const [isFiltersModalOpen, setIsFiltersModalOpen] = useState(false);
  const [appliedFilters, setAppliedFilters] = useState<AppliedFilter[]>([]);
  const [isApplyingFilters, setIsApplyingFilters] = useState(false);

  // Hover states for modal buttons to show paint overlay when Shift is held
  const [hoverAppearanceBtn, setHoverAppearanceBtn] = useState(false);
  const [hoverFiltersBtn, setHoverFiltersBtn] = useState(false);

  const shiftHeld = usePainterStore((s) => s.shiftHeld);

  // Ref to track isApplyingFilters for effects that shouldn't re-run when this flag changes
  const isApplyingFiltersRef = useRef<boolean>(isApplyingFilters);

  useEffect(() => {
    isApplyingFiltersRef.current = isApplyingFilters;
  }, [isApplyingFilters]);

  // Sliders state
  const [sliderConfig, setSliderConfig] = useState<
    Record<string, SliderConfig>
  >({});
  // Track the last applied slider values to avoid unnecessary updates
  const lastAppliedSliders = useRef<Record<string, SliderConfig>>({});

  // Dataset update error state
  const [datasetUpdateError, setDatasetUpdateError] = useState<string | null>(
    null,
  );

  const displayStatus: PlotLiveStatus = datasetUpdateError
    ? "error"
    : plotStatus;

  const statusLabel: Record<PlotLiveStatus, string> = {
    live: "Live",
    paused: "Paused",
    error: "Error",
    completed: "Completed",
  };

  const statusClass: Record<PlotLiveStatus, string> = {
    live: "bg-emerald-500 animate-pulse",
    paused: "bg-amber-400",
    error: "bg-red-500",
    completed: "bg-sky-500",
  };

  // Track previous fpath to detect dataset changes
  const prevFpathRef = useRef<string | undefined>(undefined);

  // State to track if axes are swapped (per-plot)
  const [areAxesSwapped, setAreAxesSwapped] = useState(false);

  // Persistence hook
  const {
    getPlotState,
    setPlotAppearance,
    setPlotFilters,
    setPlotSliders,
    setPlotAxesSwapped,
  } = usePlotStore();

  // Load persisted state when component mounts or plot config changes
  useEffect(() => {
    if (plotConfig?.id) {
      const plotState = getPlotState(plotConfig.id) as
        | PlotPersistentState
        | undefined;
      if (plotState) {
        if (plotState.appearance_settings) {
          const normalized = mergeAppearanceDefaults(
            getInitialSettings(plotType),
            plotState.appearance_settings,
          );
          setAppearanceSettings(normalized);
        }
        if (plotState.applied_filters && plotState.applied_filters.length > 0) {
          setAppliedFilters(plotState.applied_filters);
          // Note: Filters will be reapplied by a separate useEffect that watches appliedFilters
        } else {
          setAppliedFilters([]);
        }
        if (plotState.slider_settings) {
          setSliderConfig(plotState.slider_settings);
          // Initialize lastAppliedSliders to prevent "off by one" issues
          lastAppliedSliders.current = { ...plotState.slider_settings };
        }
        if (typeof plotState.axes_swapped === "boolean") {
          setAreAxesSwapped(plotState.axes_swapped);
        }
      } else {
        // No persisted state, but check if plotConfig has filter settings from backend
        if (plotConfig.filters_order && plotConfig.filters_order.length > 0) {
          // Convert backend filter config to UI filter format
          // This is a simplified conversion - you might need to enhance this based on your filter structure
          const filtersFromConfig = plotConfig.filters_order.map(
            (filterName) => ({
              name: filterName,
              options: plotConfig.filters_opts?.[filterName] || {},
            }),
          ) as AppliedFilter[];

          console.log("Loaded filters from plot config:", filtersFromConfig);

          // Set the filters and trigger reapplication by clearing and resetting them
          // This approach ensures the filters are applied to the new dataset
          setAppliedFilters([]);
          setTimeout(() => {
            setAppliedFilters(filtersFromConfig);
          }, 100);
        }
      }
    }
  }, [
    plotConfig?.id,
    plotConfig?.filters_order,
    plotConfig?.filters_opts,
    getPlotState,
    plotType,
  ]); // Don't include originalPlotJson to avoid loops

  // Initialize when plotJson prop changes (new plot loaded)
  useEffect(() => {
    // Skip initialization during filter operations to prevent conflicts
    if (isApplyingFiltersRef.current) {
      return;
    }

    setOriginalPlotJson(plotJson); // Store the original unfiltered data
    setBasePlotJson(plotJson);

    // Don't immediately set customizedPlotJson here - let the appearance useEffect handle it
    // This prevents flickering by ensuring appearance settings are applied before rendering
  }, [plotJson]); // Only depend on plotJson changes

  // Function to apply appearance settings to plotly JSON
  const applyAppearanceSettings = useCallback(
    (
      originalPlotJson: PlotlyJSON,
      settings: PlotAppearanceSettings,
    ): PlotlyJSON => {
      // Shallow-clone the top level so trace metadata (colorscale, zmin, line…) and
      // layout properties can be updated without mutating the source object, and
      // without deep-cloning the large data arrays.
      const updatedPlotJson: PlotlyJSON = { ...originalPlotJson };

      // Apply to data traces
      if (originalPlotJson.data && originalPlotJson.data.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        updatedPlotJson.data = originalPlotJson.data.map((trace: any) => {
          const updatedTrace = { ...trace };

          // Apply heatmap settings
          if (
            (trace.type === "heatmap" || trace.type === "heatmapgl") &&
            settings.hmap
          ) {
            // If trace is not using a shared coloraxis, set per-trace fallback
            updatedTrace.colorscale = getColorscaleData(
              settings.hmap.colorscale,
            );
            if (settings.hmap.rangecolor) {
              // Convert percentages (0-100) to actual z-values.
              // Try multiple sources for the data bounds in priority order:
              //   1. Existing per-trace zmin/zmax (set by backend)
              //   2. Scan the z array (if it's a plain JS array)
              let zMin = Infinity;
              let zMax = -Infinity;

              // Source 1: backend-provided per-trace zmin/zmax
              if (
                typeof (trace as any).zmin === "number" &&
                typeof (trace as any).zmax === "number" &&
                !isNaN((trace as any).zmin) &&
                !isNaN((trace as any).zmax)
              ) {
                zMin = (trace as any).zmin;
                zMax = (trace as any).zmax;
              } else if (trace.z) {
                // Source 2: scan the z array
                const zData = trace.z as any;
                const isNested =
                  Array.isArray(zData[0]) ||
                  (ArrayBuffer.isView(zData[0]) &&
                    !(zData[0] instanceof DataView));

                if (isNested) {
                  for (let i = 0; i < zData.length; i++) {
                    const row = zData[i];
                    for (let j = 0; j < row.length; j++) {
                      const val = +row[j];
                      if (!isNaN(val)) {
                        if (val < zMin) zMin = val;
                        if (val > zMax) zMax = val;
                      }
                    }
                  }
                } else if (Array.isArray(zData) || ArrayBuffer.isView(zData)) {
                  for (let i = 0; i < (zData as any).length; i++) {
                    const val = +(zData as any)[i];
                    if (!isNaN(val)) {
                      if (val < zMin) zMin = val;
                      if (val > zMax) zMax = val;
                    }
                  }
                }
              }

              if (zMin !== Infinity && zMax !== -Infinity) {
                const range = zMax - zMin;
                updatedTrace.zmin =
                  zMin + (range * settings.hmap.rangecolor[0]) / 100;
                updatedTrace.zmax =
                  zMin + (range * settings.hmap.rangecolor[1]) / 100;
                updatedTrace.zauto = false;
              } else {
                // Could not determine data bounds – let Plotly auto-range.
                delete updatedTrace.zmin;
                delete updatedTrace.zmax;
                updatedTrace.zauto = true;
              }
            } else {
              // Remove manual range settings to use auto
              delete updatedTrace.zmin;
              delete updatedTrace.zmax;
              updatedTrace.zauto = true;
            }
          }

          // Apply line settings if trace has line
          if (trace.line || trace.type === "scatter") {
            updatedTrace.mode = settings.line.mode;
            updatedTrace.line = {
              ...trace.line,
              color: settings.line.color,
              width: settings.line.width,
              dash: settings.line.dash,
              shape: settings.line.shape,
              smoothing: settings.line.smoothing,
            };
            updatedTrace.opacity = settings.line.opacity;
          }

          // Apply marker settings if trace has marker
          if (trace.marker || trace.type === "scatter") {
            updatedTrace.marker = {
              ...trace.marker,
              color: settings.marker.color,
              size: settings.marker.size,
              symbol: settings.marker.symbol,
              opacity: settings.marker.opacity,
            };
          }

          return updatedTrace;
        });
      }

      // Apply to layout - shallow-clone first so property assignments below
      // don't mutate the original layout object.
      if (updatedPlotJson.layout) {
        updatedPlotJson.layout = { ...updatedPlotJson.layout };
        // Ensure layout has required structure
        if (!updatedPlotJson.layout.xaxis) {
          updatedPlotJson.layout.xaxis = {};
        }
        if (!updatedPlotJson.layout.yaxis) {
          updatedPlotJson.layout.yaxis = {};
        }
        // When using heatmaps built by the backend, traces use a shared coloraxis.
        // Update layout.coloraxis so the colorscale actually changes.
        const hasHeatmap = (updatedPlotJson.data || []).some(
          (t: Data) => t.type === "heatmap" || t.type === "heatmapgl",
        );
        if (hasHeatmap && settings.hmap) {
          type LayoutWithColorAxis = {
            coloraxis?: {
              colorscale?: unknown;
              cmin?: number;
              cmax?: number;
              [k: string]: unknown;
            };
          };
          const layoutRef = updatedPlotJson.layout as Partial<Layout> &
            LayoutWithColorAxis;
          const existing = (layoutRef.coloraxis || {}) as NonNullable<
            LayoutWithColorAxis["coloraxis"]
          >;
          const newColoraxis: NonNullable<LayoutWithColorAxis["coloraxis"]> = {
            ...existing,
          };
          // Update scale - use the actual colorscale data array from JSON
          (newColoraxis as { colorscale?: unknown }).colorscale =
            getColorscaleData(settings.hmap.colorscale);
          // Update or clear range
          if (settings.hmap.rangecolor) {
            // Map percentages to actual data-space bounds.
            // Try multiple sources for global min/max in priority order:
            //   1. layout.coloraxis.cmin/cmax already computed by Plotly on
            //      the previous render (most reliable — avoids having to parse z)
            //   2. Per-trace zmin/zmax set by the backend
            //   3. Scan the z arrays (plain JS arrays / TypedArrays)
            let combinedMin = Infinity;
            let combinedMax = -Infinity;

            // Source 1: existing Plotly-computed coloraxis bounds in the
            // _original_ (unmodified) plot JSON's layout
            const origLayout = originalPlotJson.layout as any;
            if (
              typeof origLayout?.coloraxis?.cmin === "number" &&
              typeof origLayout?.coloraxis?.cmax === "number" &&
              !isNaN(origLayout.coloraxis.cmin) &&
              !isNaN(origLayout.coloraxis.cmax)
            ) {
              combinedMin = origLayout.coloraxis.cmin;
              combinedMax = origLayout.coloraxis.cmax;
            } else {
              // Source 2 + 3: per-trace zmin/zmax or z-array scan
              (originalPlotJson.data || []).forEach((trace: any) => {
                if (
                  (trace.type === "heatmap" || trace.type === "heatmapgl")
                ) {
                  // Source 2: backend-provided per-trace zmin/zmax
                  if (
                    typeof trace.zmin === "number" &&
                    typeof trace.zmax === "number" &&
                    !isNaN(trace.zmin) &&
                    !isNaN(trace.zmax)
                  ) {
                    if (trace.zmin < combinedMin) combinedMin = trace.zmin;
                    if (trace.zmax > combinedMax) combinedMax = trace.zmax;
                  } else if (trace.z) {
                    // Source 3: scan the z array
                    const zData = trace.z as any;
                    const isNested =
                      Array.isArray(zData[0]) ||
                      (ArrayBuffer.isView(zData[0]) &&
                        !(zData[0] instanceof DataView));

                    if (isNested) {
                      for (let i = 0; i < zData.length; i++) {
                        const row = zData[i];
                        for (let j = 0; j < row.length; j++) {
                          const val = +row[j];
                          if (!isNaN(val)) {
                            if (val < combinedMin) combinedMin = val;
                            if (val > combinedMax) combinedMax = val;
                          }
                        }
                      }
                    } else if (
                      Array.isArray(zData) ||
                      ArrayBuffer.isView(zData)
                    ) {
                      for (let i = 0; i < (zData as any).length; i++) {
                        const val = +(zData as any)[i];
                        if (!isNaN(val)) {
                          if (val < combinedMin) combinedMin = val;
                          if (val > combinedMax) combinedMax = val;
                        }
                      }
                    }
                  }
                }
              });
            }

            console.log(
              "[HeatmapRange] combinedMin:",
              combinedMin,
              "combinedMax:",
              combinedMax,
              "rangecolor:",
              settings.hmap.rangecolor,
            );

            if (combinedMin !== Infinity && combinedMax !== -Infinity) {
              const range = combinedMax - combinedMin;
              (newColoraxis as { cmin?: number }).cmin =
                combinedMin + (range * settings.hmap.rangecolor[0]) / 100;
              (newColoraxis as { cmax?: number }).cmax =
                combinedMin + (range * settings.hmap.rangecolor[1]) / 100;
              console.log(
                "[HeatmapRange] Setting cmin:",
                (newColoraxis as any).cmin,
                "cmax:",
                (newColoraxis as any).cmax,
              );
              // Force Plotly to respect our explicit range
              (newColoraxis as Record<string, unknown>).cauto = false;
              (newColoraxis as Record<string, unknown>).autocolorscale = false;
            } else {
              // Could not determine data bounds – fall back to auto-range
              delete (newColoraxis as Record<string, unknown>).cmin;
              delete (newColoraxis as Record<string, unknown>).cmax;
              (newColoraxis as Record<string, unknown>).cauto = true;
              (newColoraxis as Record<string, unknown>).autocolorscale = false;
              console.log(
                "[HeatmapRange] FALLBACK - could not compute data bounds, using auto-range",
              );
            }
          } else {
            // Remove to let Plotly auto-range
            delete (newColoraxis as Record<string, unknown>).cmin;
            delete (newColoraxis as Record<string, unknown>).cmax;
            (newColoraxis as Record<string, unknown>).cauto = true;
            (newColoraxis as Record<string, unknown>).autocolorscale = false;
          }
          layoutRef.coloraxis = newColoraxis;
        }

        if (updatedPlotJson.layout.xaxis) {
          updatedPlotJson.layout.xaxis = {
            ...updatedPlotJson.layout.xaxis,
            type: settings.x.maj.type as AxisType,
            showgrid: settings.x.maj.showgrid,
            nticks: settings.x.maj.nticks,
            gridcolor: settings.x.maj.gridcolor,
            griddash: settings.x.maj.griddash as Dash,
            gridwidth: settings.x.maj.gridwidth,
            tickcolor: settings.x.maj.tickcolor,
            tickwidth: settings.x.maj.tickwidth,
            ticklen: settings.x.maj.ticklen,
            tickangle: settings.x.maj.tickangle,
            minor: {
              ...(updatedPlotJson.layout.xaxis.minor || {}),
              showgrid: settings.x.min.showgrid,
              nticks: settings.x.min.nticks,
              gridcolor: settings.x.min.gridcolor,
              griddash: settings.x.min.griddash as Dash,
              gridwidth: settings.x.min.gridwidth,
              tickcolor: settings.x.min.tickcolor,
              tickwidth: settings.x.min.tickwidth,
              ticklen: settings.x.min.ticklen,
            },
          };
        }

        if (updatedPlotJson.layout.yaxis) {
          updatedPlotJson.layout.yaxis = {
            ...updatedPlotJson.layout.yaxis,
            type: settings.y.maj.type as AxisType,
            showgrid: settings.y.maj.showgrid,
            nticks: settings.y.maj.nticks,
            gridcolor: settings.y.maj.gridcolor,
            griddash: settings.y.maj.griddash as Dash,
            gridwidth: settings.y.maj.gridwidth,
            tickcolor: settings.y.maj.tickcolor,
            tickwidth: settings.y.maj.tickwidth,
            ticklen: settings.y.maj.ticklen,
            tickangle: settings.y.maj.tickangle,
            minor: {
              ...(updatedPlotJson.layout.yaxis.minor || {}),
              showgrid: settings.y.min.showgrid,
              nticks: settings.y.min.nticks,
              gridcolor: settings.y.min.gridcolor,
              griddash: settings.y.min.griddash as Dash,
              gridwidth: settings.y.min.gridwidth,
              tickcolor: settings.y.min.tickcolor,
              tickwidth: settings.y.min.tickwidth,
              ticklen: settings.y.min.ticklen,
            },
          };
        }
      }

      return updatedPlotJson;
    },
    [],
  );

  // Apply current appearance settings when a new plot loads or when appearance settings change
  // Use useMemo to prevent unnecessary re-calculations
  const customizedPlotJsonMemo = useMemo(() => {
    let result = applyAppearanceSettings(basePlotJson, appearanceSettings);
    if (areAxesSwapped) {
      result = swapAxesInPlotJson(result);
    }
    // console.log(`[PlotWrapper] Calculated new customizedPlotJsonMemo`);
    return result;
  }, [
    basePlotJson,
    appearanceSettings,
    applyAppearanceSettings,
    areAxesSwapped,
  ]);

  // Update customized plot JSON only when memo changes (but not during filter operations)
  // Use React 18's concurrent features to batch updates and prevent intermediate renders
  useEffect(() => {
    // Skip automatic updates during filter operations to prevent race conditions
    if (isApplyingFilters) {
      // console.log(
      //   `[PlotWrapper] Skipping automatic plot update while filters are being applied`
      // );
      return;
    }

    // Use startTransition to mark this as a non-urgent update that can be batched
    // This helps React optimize the rendering and reduces flickering
    startTransition(() => {
      setCustomizedPlotJson(customizedPlotJsonMemo);
    });
  }, [customizedPlotJsonMemo, isApplyingFilters]);

  // Close modals only when plot configuration changes (new plot loaded)
  // Close modals only when loading a completely new plot, not when refreshing the same plot
  useEffect(() => {
    // For now, let's not auto-close modals on plot config changes
    // This allows sliders to work without closing the modal
    // We can revisit this if we need more sophisticated logic
    // console.log("Plot config changed:", plotConfig?.id);
  }, [plotConfig?.id]);

  // Throttled onUpdateConfig to prevent excessive backend calls
  const throttledUpdateConfig = useRef<NodeJS.Timeout | null>(null);

  const handleUpdateConfig = useCallback(
    (config: Partial<PlotConfiguration>) => {
      if (!onUpdateConfig) return;

      // Clear existing timeout
      if (throttledUpdateConfig.current) {
        clearTimeout(throttledUpdateConfig.current);
      }

      // Throttle updates to every 300ms
      throttledUpdateConfig.current = setTimeout(() => {
        onUpdateConfig(config);
      }, 300);
    },
    [onUpdateConfig],
  );

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (throttledUpdateConfig.current) {
        clearTimeout(throttledUpdateConfig.current);
      }
    };
  }, []);

  // Listen for global squarify toggle from Viewer and apply locally
  useEffect(() => {
    const handler = (e: Event) => {
      try {
        const ce = e as CustomEvent<{ enabled: boolean }>;
        const enabled = Boolean(ce.detail?.enabled);
        setIsSquareMode(enabled);
      } catch {
        // ignore
      }
    };
    window.addEventListener("plot-squarify", handler as EventListener);
    return () =>
      window.removeEventListener("plot-squarify", handler as EventListener);
  }, []);

  // Handle dataset changes by reapplying current filters/sliders with new dataset
  // This allows cycling through datasets while preserving filter/slider state

  // Helper function to compare filters and sliders to prevent unnecessary operations
  const filtersOrSlidersChanged = useCallback(
    (
      newFilters: AppliedFilter[],
      newSliders?: Record<string, SliderConfig>,
    ): boolean => {
      // Compare filters
      if (newFilters.length !== appliedFilters.length) {
        return true;
      }

      const filtersChanged = newFilters.some((newFilter, index) => {
        const currentFilter = appliedFilters[index];
        return (
          newFilter.name !== currentFilter?.name ||
          JSON.stringify(newFilter.options) !==
            JSON.stringify(currentFilter?.options)
        );
      });

      if (filtersChanged) {
        return true;
      }

      // Compare sliders
      if (newSliders) {
        const currentSliderKeys = Object.keys(sliderConfig);
        const newSliderKeys = Object.keys(newSliders);

        if (currentSliderKeys.length !== newSliderKeys.length) {
          return true;
        }

        const slidersChanged = newSliderKeys.some((key) => {
          const currentSlider = sliderConfig[key];
          const newSlider = newSliders[key];
          return !currentSlider || currentSlider.value !== newSlider.value;
        });

        return slidersChanged;
      }

      return false;
    },
    [appliedFilters, sliderConfig],
  );

  // Core function that executes filter/slider operations
  const executeFiltersApply = useCallback(
    async (
      updateRequest: {
        filters: AppliedFilter[];
        sliders?: Record<string, SliderConfig>;
      } | null,
    ) => {
      if (!updateRequest) return;

      const { filters, sliders } = updateRequest;

      // Always use local filter application to avoid plot reload and modal closure
      // This decouples filter application from plot refresh
      // let fallbackTimer: NodeJS.Timeout | null = null;

      try {
        setIsApplyingFilters(true);
        // console.log(
        //   `[PlotWrapper] Starting filter application - blocking concurrent operations`
        // );

        // // Safety fallback: Clear loading state after 3 seconds no matter what
        // fallbackTimer = setTimeout(() => {
        //   console.warn(
        //     "Fallback timer: Clearing isApplyingFilters after 3 seconds"
        //   );
        //   setIsApplyingFilters(false);
        // }, 3000);

        console.log("[PlotWrapper] Set isApplyingFilters to true");

        // DON'T update state immediately to prevent flickering
        // Only update state after successful API call with all new data

        // Prepare filters for backend
        const filtersOrder = filters.map((f) => f.name);
        const filtersOpts = filters.reduce(
          (acc, filter) => {
            if (filter.options) {
              acc[filter.name] = filter.options;
            }
            return acc;
          },
          {} as Record<string, unknown>,
        );

        // For filter-only changes, always use filter API even if sliders exist
        // Only use slider path when sliders are actually being changed
        const isSliderChange = sliders && Object.keys(sliders).length > 0;

        // Check if slider values have actually changed from the last applied ones
        const hasSliderValuesChanged =
          isSliderChange &&
          Object.keys(sliders).some((key) => {
            const newValue = sliders[key]?.value;
            const lastValue = lastAppliedSliders.current[key]?.value;
            return newValue !== lastValue;
          });

        const shouldUseSliderPath =
          hasSliderValuesChanged ||
          (isSliderChange && Object.keys(sliderConfig).length === 0);

        if (shouldUseSliderPath) {
          // Use new slider API for slider changes with filters
          try {
            if (!plotConfig) {
              throw new Error(
                "Plot configuration not available for slider operation",
              );
            }
            if (!activePlotRef) {
              throw new Error(
                "Plot reference not available for transform operation",
              );
            }

            console.log("[PlotWrapper] Starting slider API call");
            const result = await PlotAPI.transformPlot({
              plot_ref: activePlotRef,
              filters_order: filtersOrder,
              filters_opts: filtersOpts,
              slider: sliders || sliderConfig,
            });
            console.log("[PlotWrapper] Slider API call completed successfully");

            // Ensure the returned plot JSON has proper structure
            if (!result.plot_json.layout) {
              result.plot_json.layout = {};
            }

            // Batch ALL state updates together to prevent flickering
            const appliedSliderConfig = sliders || sliderConfig;
            const slicedWithAppearance = applyAppearanceSettings(
              result.plot_json,
              appearanceSettings,
            );

            // Update all related state in one batch using concurrent features for smoother updates
            startTransition(() => {
              flushSync(() => {
                setAppliedFilters(filters);
                if (sliders) {
                  setSliderConfig(sliders);
                }
                setBasePlotJson(result.plot_json);
                setCustomizedPlotJson(slicedWithAppearance);
              });
            });

            // Clear loading overlay after a brief delay to ensure smooth transition
            setTimeout(() => {
              // if (fallbackTimer) clearTimeout(fallbackTimer);
              console.log(
                "[PlotWrapper] Clearing isApplyingFilters after successful operation",
              );
              setIsApplyingFilters(false);
            }, 100);
            lastAppliedSliders.current = { ...appliedSliderConfig };

            // Delay backend config update to separate UI responsiveness from persistence
            setTimeout(() => {
              if (handleUpdateConfig) {
                handleUpdateConfig({
                  filters_order: filtersOrder,
                  filters_opts: filtersOpts,
                  slider: appliedSliderConfig,
                });
              }
            }, 200);

            showToast("Sliders applied successfully", "success");
          } catch (error) {
            console.error("Error applying sliders:", error);
            showToast("Failed to apply sliders", "error");
          }
        } else {
          // Filter-only changes - use filter API directly
          if (filters.length === 0) {
            // No filters - check if we have sliders to apply
            if (sliders && Object.keys(sliders).length > 0) {
              // No filters but have sliders - use slider API to get sliced data without filters
              try {
                if (!plotConfig) {
                  throw new Error(
                    "Plot configuration not available for slider operation",
                  );
                }
                if (!activePlotRef) {
                  throw new Error(
                    "Plot reference not available for transform operation",
                  );
                }

                const result = await PlotAPI.transformPlot({
                  plot_ref: activePlotRef,
                  filters_order: [],
                  filters_opts: {},
                  slider: sliders,
                });

                // Ensure the returned plot JSON has proper structure
                if (!result.plot_json.layout) {
                  result.plot_json.layout = {};
                }

                // Batch ALL state updates together to prevent flickering
                const slicedWithAppearance = applyAppearanceSettings(
                  result.plot_json,
                  appearanceSettings,
                );

                // Update all related state in one batch using concurrent features for smoother updates
                startTransition(() => {
                  flushSync(() => {
                    setAppliedFilters(filters); // This should be empty array for this path
                    setSliderConfig(sliders);
                    setBasePlotJson(result.plot_json);
                    setCustomizedPlotJson(slicedWithAppearance);
                  });
                });

                // Clear loading overlay after a brief delay to ensure smooth transition
                setTimeout(() => {
                  // if (fallbackTimer) clearTimeout(fallbackTimer);
                  // console.log(
                  //   `[PlotWrapper] Filter application complete - re-enabling concurrent operations`
                  // );
                  setIsApplyingFilters(false);
                }, 100);
                lastAppliedSliders.current = { ...sliders };

                showToast("Filters reset, sliders maintained", "success");
              } catch (error) {
                console.error(
                  "Error applying sliders after filter reset:",
                  error,
                );
                showToast(
                  "Failed to apply sliders after filter reset",
                  "error",
                );
                // Clear loading state on error
                setIsApplyingFilters(false);
              }
            } else {
              // No filters, no sliders - reset to original
              const resetPlotWithAppearance = applyAppearanceSettings(
                originalPlotJson,
                appearanceSettings,
              );

              // Update all related state in one batch using concurrent features for smoother updates
              startTransition(() => {
                flushSync(() => {
                  setAppliedFilters(filters); // This should be empty array
                  if (sliders) {
                    setSliderConfig(sliders);
                  }
                  setBasePlotJson(originalPlotJson);
                  setCustomizedPlotJson(resetPlotWithAppearance);
                });
              });

              // Clear loading overlay after a brief delay to ensure smooth transition
              setTimeout(() => {
                // if (fallbackTimer) clearTimeout(fallbackTimer);
                // console.log(
                //   `[PlotWrapper] Filter application complete - re-enabling concurrent operations`
                // );
                setIsApplyingFilters(false);
              }, 100);

              // Only show "Filters cleared" toast if we actually had filters before
              showToast("Filters cleared", "success");
            }

            // Delay backend config update
            setTimeout(() => {
              if (handleUpdateConfig) {
                handleUpdateConfig({
                  filters_order: [],
                  filters_opts: {},
                  slider:
                    sliders && Object.keys(sliders).length > 0 ? sliders : {},
                });
              }
            }, 200);
          } else {
            // Filters but no sliders - use filter API
            if (!activePlotRef) {
              throw new Error(
                "Plot reference not available for transform operation",
              );
            }

            console.log("[PlotWrapper] Starting filter API call");
            const result = await PlotAPI.transformPlot({
              plot_ref: activePlotRef,
              filters_order: filtersOrder,
              filters_opts: filtersOpts,
              slider: {},
            });
            console.log("[PlotWrapper] Filter API call completed successfully");

            // Batch ALL state updates together to prevent flickering
            // Cast backend response to PlotlyJSON (assume backend contract)
            const filteredPlotJson = result.plot_json as PlotlyJSON;
            const filteredWithAppearance = applyAppearanceSettings(
              filteredPlotJson,
              appearanceSettings,
            );

            // Update all related state in one batch
            setAppliedFilters(filters);
            setBasePlotJson(filteredPlotJson);
            setCustomizedPlotJson(filteredWithAppearance);

            // Delay backend config update
            setTimeout(() => {
              if (handleUpdateConfig) {
                handleUpdateConfig({
                  filters_order: filtersOrder,
                  filters_opts: filtersOpts,
                  slider: {},
                });
              }
            }, 200);
          }
        }

        // Save to store if available (for persistence)
        if (plotConfig?.id) {
          setPlotFilters(plotConfig.id, filters);
          if (sliders) {
            setPlotSliders(plotConfig.id, sliders);
            // Also update the tracking reference for slider persistence
            lastAppliedSliders.current = { ...sliders };
          }
        }

        // Show appropriate success message - only show for actual filter changes, not slider changes
        if (filters.length > 0) {
          showToast(`Applied ${filters.length} filter(s)`, "success");
        }

        // Ensure isApplyingFilters is cleared in all success paths
        setTimeout(() => {
          setIsApplyingFilters(false);
        }, 100);
      } catch (error) {
        console.error("Error applying filters:", error);
        showToast(
          `Failed to apply filters: ${
            error instanceof Error ? error.message : "Unknown error"
          }`,
          "error",
          5000,
        );
        // Clear loading overlay immediately on error
        // if (fallbackTimer) clearTimeout(fallbackTimer);
        console.log("[PlotWrapper] Clearing isApplyingFilters after error");
        setIsApplyingFilters(false);
      }
      // Note: setIsApplyingFilters(false) is now handled in setTimeout for success cases
    },
    [
      plotConfig,
      originalPlotJson,
      sliderConfig,
      appearanceSettings,
      showToast,
      handleUpdateConfig,
      setPlotFilters,
      setPlotSliders,
      plotType,
      applyAppearanceSettings,
      activePlotRef,
    ],
  );

  // Simplified filter/slider handler with smart comparison to prevent unnecessary operations
  const handleFiltersApply = useCallback(
    async (
      filters: AppliedFilter[],
      sliders?: Record<string, SliderConfig>,
    ) => {
      // Prevent overlapping operations
      if (isApplyingFilters) {
        // console.log("[PlotWrapper] Operation already in progress, skipping");
        return;
      }

      // Smart comparison to prevent unnecessary operations when values haven't changed
      if (!filtersOrSlidersChanged(filters, sliders)) {
        console.log(
          "[PlotWrapper] Filters/sliders unchanged, skipping operation",
        );
        return;
      }

      console.log(
        "[PlotWrapper] Filters/sliders changed, proceeding with operation",
      );

      // Execute immediately without debouncing to fix refresh loop
      await executeFiltersApply({ filters, sliders });
    },
    [executeFiltersApply, isApplyingFilters, filtersOrSlidersChanged],
  );

  // Function to update the plot's data source without recreating the plot component
  const updateDataSource = useCallback(
    async (newFpath: string) => {
      try {
        if (!plotConfig) return;

        console.log(`[PlotWrapper] Fetching fresh plot data from ${newFpath}`);

        // Clear any previous dataset update errors
        setDatasetUpdateError(null);

        // Create a basic plot request to get the new dataset's plot
        const request = {
          fpaths: [newFpath],
          indeps: plotConfig.indeps,
          deps: plotConfig.deps,
          plotType: plotConfig.plotType,
          filters_order: [], // Start with no filters
          filters_opts: {},
          slider: {},
        };

        const response = await PlotAPI.createPlots(request);

        if (response.success && response.plots.length > 0) {
          const newPlot = response.plots[0];
          const nextPlotRef = newPlot.plot_ref || activePlotRef;
          setActivePlotRef(nextPlotRef);

          // Update the original plot JSON with the new dataset
          setOriginalPlotJson(newPlot.plotJson);

          // Update available sliders if they exist
          if (newPlot.slider_config) {
            // Note: We don't update the current slider values, just the available options
            // This preserves the user's slider positions across dataset changes
          }

          // Check if we need to apply filters/sliders
          const hasFiltersOrSliders =
            appliedFilters.length > 0 || Object.keys(sliderConfig).length > 0;

          if (hasFiltersOrSliders) {
            console.log(
              `[PlotWrapper] Applying ${appliedFilters.length} filters and ${
                Object.keys(sliderConfig).length
              } sliders to new dataset before display`,
            );

            // Apply filters/sliders immediately to prevent flicker
            // Use the same logic as handleFiltersApply but synchronously
            const filtersOrder = appliedFilters.map((f) => f.name);
            const filtersOpts = appliedFilters.reduce(
              (acc, filter) => {
                if (filter.options) {
                  acc[filter.name] = filter.options;
                }
                return acc;
              },
              {} as Record<string, unknown>,
            );

            const isSliderChange = Object.keys(sliderConfig).length > 0;

            try {
              if (isSliderChange) {
                if (!nextPlotRef) {
                  throw new Error(
                    "Plot reference not available for transform operation",
                  );
                }

                // Use unified transform API to apply both filters and sliders
                const result = await PlotAPI.transformPlot({
                  plot_ref: nextPlotRef,
                  filters_order: filtersOrder,
                  filters_opts: filtersOpts,
                  slider: sliderConfig,
                });

                if (!result.plot_json.layout) {
                  result.plot_json.layout = {};
                }

                const slicedPlotJson = result.plot_json as PlotlyJSON;
                setBasePlotJson(slicedPlotJson);
                const slicedWithAppearance = applyAppearanceSettings(
                  slicedPlotJson,
                  appearanceSettings,
                );
                setCustomizedPlotJson(slicedWithAppearance);
              } else if (appliedFilters.length > 0) {
                if (!nextPlotRef) {
                  throw new Error(
                    "Plot reference not available for transform operation",
                  );
                }

                // Use unified transform API for filters only
                const result = await PlotAPI.transformPlot({
                  plot_ref: nextPlotRef,
                  filters_order: filtersOrder,
                  filters_opts: filtersOpts,
                  slider: {},
                });

                const filteredPlotJson = result.plot_json as PlotlyJSON;
                setBasePlotJson(filteredPlotJson);
                const filteredWithAppearance = applyAppearanceSettings(
                  filteredPlotJson,
                  appearanceSettings,
                );
                setCustomizedPlotJson(filteredWithAppearance);
              }
            } catch (filterError) {
              console.error(
                `[PlotWrapper] Error applying filters/sliders to new dataset:`,
                filterError,
              );
              // Fallback to showing unfiltered plot
              setBasePlotJson(newPlot.plotJson);
              const plotWithAppearance = applyAppearanceSettings(
                newPlot.plotJson,
                appearanceSettings,
              );
              setCustomizedPlotJson(plotWithAppearance);
            }
          } else {
            // No filters/sliders to apply - show the new plot directly
            setBasePlotJson(newPlot.plotJson);
            const plotWithAppearance = applyAppearanceSettings(
              newPlot.plotJson,
              appearanceSettings,
            );
            setCustomizedPlotJson(plotWithAppearance);
          }

          console.log(
            `[PlotWrapper] Successfully updated data source to ${newFpath}${
              hasFiltersOrSliders ? " with filters/sliders applied" : ""
            }`,
          );
        } else {
          console.error(
            `[PlotWrapper] Failed to fetch plot data for ${newFpath}:`,
            response.message,
          );

          // Check if it's a variable not found error and provide helpful message
          if (
            response.message &&
            (response.message.includes("not found") ||
              response.message.includes("KeyError"))
          ) {
            const missingVars = plotConfig
              ? [...plotConfig.indeps, ...plotConfig.deps]
              : [];
            setDatasetUpdateError(
              `Cannot update to new dataset: Variables [${missingVars.join(
                ", ",
              )}] not found in the selected dataset. Please select a dataset that contains these variables or create a new plot.`,
            );
          } else {
            setDatasetUpdateError(
              `Failed to update to new dataset: ${
                response.message || "Unknown error"
              }`,
            );
          }
        }
      } catch (error) {
        console.error(
          `[PlotWrapper] Error updating data source to ${newFpath}:`,
          error,
        );

        // Provide user-friendly error message for variable compatibility issues
        let errorMessage = "Failed to update to new dataset";
        if (error instanceof Error) {
          if (
            error.message.includes("not found") ||
            error.message.includes("KeyError")
          ) {
            const missingVars = plotConfig
              ? [...plotConfig.indeps, ...plotConfig.deps]
              : [];
            errorMessage = `Cannot update to new dataset: Variables [${missingVars.join(
              ", ",
            )}] not found in the selected dataset. Please select a dataset that contains these variables or create a new plot.`;
          } else {
            errorMessage = `Failed to update to new dataset: ${error.message}`;
          }
        }

        setDatasetUpdateError(errorMessage);
      }
    },
    [
      plotConfig,
      appearanceSettings,
      appliedFilters,
      sliderConfig,
      applyAppearanceSettings,
      activePlotRef,
    ],
  );

  // Watch for dataset changes and update data source without recreating the plot
  useEffect(() => {
    const currentFpath = plotConfig?.fpath;

    // Skip updates if filters are currently being applied to prevent race conditions
    if (isApplyingFilters) {
      console.log(
        `[PlotWrapper] Skipping dataset update while filters are being applied`,
      );
      return;
    }

    // Only trigger updateDataSource if this is a dataset cycle (not initial plot creation)
    if (
      currentFpath &&
      prevFpathRef.current &&
      currentFpath !== prevFpathRef.current
    ) {
      console.log(
        `[PlotWrapper] Dataset path changed from ${prevFpathRef.current} to ${currentFpath}`,
      );
      console.log(
        `[PlotWrapper] Updating data source to new dataset while preserving UI state`,
      );

      // Update the data source by fetching fresh plot data from the new dataset
      // This preserves all UI state (filters, sliders, modals) while changing the underlying data
      updateDataSource(currentFpath);
    }

    // Always update the ref to track the current fpath
    prevFpathRef.current = currentFpath;
  }, [plotConfig?.fpath, updateDataSource, isApplyingFilters]);

  const handleMaximize = () => {
    setIsMaximized(!isMaximized);
  };

  const handleAppearanceSettingsOpen = () => {
    setIsAppearanceModalOpen(true);
  };

  const handleAppearanceSettingsClose = () => {
    setIsAppearanceModalOpen(false);
  };

  // Filters handlers
  const handleFiltersModalOpen = () => {
    setIsFiltersModalOpen(true);
    onFiltersModalOpenChange?.(true);
  };

  const handleFiltersModalClose = () => {
    setIsFiltersModalOpen(false);
    onFiltersModalOpenChange?.(false);
  };

  // Reset handler to clear all filters and appearance modifications
  const handleReset = async () => {
    setAreAxesSwapped(false);

    // Always use local reset to avoid plot reload and maintain consistency with filter approach
    const defaultSettings = getInitialSettings(plotType);
    setAppearanceSettings(defaultSettings);

    // Clear all filters and sliders
    setAppliedFilters([]);
    setSliderConfig({});
    lastAppliedSliders.current = {}; // Clear the tracking ref too

    // Reset to original plot JSON (not the current potentially filtered plotJson)
    setBasePlotJson(originalPlotJson);

    // Apply default appearance to original plot
    const resetPlotJson = applyAppearanceSettings(
      originalPlotJson,
      defaultSettings,
    );
    setCustomizedPlotJson(resetPlotJson);

    // Update backend configuration to clear filters and sliders
    if (handleUpdateConfig) {
      handleUpdateConfig({
        filters_order: [],
        filters_opts: {},
        slider: {},
      });
    }

    // Save to store if available (for persistence)
    if (plotConfig?.id) {
      setPlotAppearance(plotConfig.id, defaultSettings);
      setPlotFilters(plotConfig.id, []);
      setPlotSliders(plotConfig.id, {});
      setPlotAxesSwapped(plotConfig.id, false);
    }

    showToast("Plot reset to original state", "success");
  };

  const handleSwapAxes = () => {
    const newSwapped = !areAxesSwapped;
    setAreAxesSwapped(newSwapped);
    if (plotConfig?.id) {
      setPlotAxesSwapped(plotConfig.id, newSwapped);
    }
  };

  const handleAppearanceSettingsChange = useCallback(
    (newSettings: PlotAppearanceSettings) => {
      setAppearanceSettings(newSettings);

      // Save to store if available
      if (plotConfig?.id) {
        setPlotAppearance(plotConfig.id, newSettings);
      }

      // The appearance will be applied by the useMemo and useEffect that watches customizedPlotJsonMemo
      // This ensures we always apply appearance to the currently filtered data without triggering unnecessary re-renders
    },
    [plotConfig?.id, setPlotAppearance],
  );

  // Painter interactions (use store selectors)
  const deactivatePainter = usePainterStore((s) => s.deactivate);
  const activateTheme = usePainterStore((s) => s.activateTheme);
  const activateFilter = usePainterStore((s) => s.activateFilter);

  const startThemePaintFromThis = useCallback(() => {
    if (!plotConfig?.id) return;
    activateTheme(plotConfig.id, plotType, appearanceSettings);
    showToast(
      "Theme selected — hold Shift and click target plots to apply",
      "info",
    );
  }, [activateTheme, plotConfig?.id, plotType, appearanceSettings, showToast]);

  const startFilterPaintFromThis = useCallback(() => {
    if (!plotConfig?.id) return;
    activateFilter(plotConfig.id, plotType, appliedFilters, sliderConfig);
    showToast(
      "Filter selection made — hold Shift and click target plots to apply",
      "info",
    );
  }, [
    activateFilter,
    plotConfig?.id,
    plotType,
    appliedFilters,
    sliderConfig,
    showToast,
  ]);

  const handlePaintTargetClick = useCallback(() => {
    const mode = usePainterStore.getState().mode;
    if (!mode || mode === "none") return;

    const sourceType = usePainterStore.getState().sourcePlotType;
    // If source and target types mismatch, show error
    if (sourceType && sourceType !== plotType) {
      showToast("Cannot paint: incompatible plot types", "error");
      if (!usePainterStore.getState().shiftHeld) deactivatePainter();
      return;
    }

    if (mode === "theme") {
      const appearance = usePainterStore.getState().sourceAppearance;
      if (appearance) {
        setAppearanceSettings(appearance);
        if (plotConfig?.id) setPlotAppearance(plotConfig.id, appearance);
        showToast("Theme applied", "success");
      }
    } else if (mode === "filter") {
      const filters = usePainterStore.getState().sourceFilters as
        | AppliedFilter[]
        | undefined;
      const sliders = usePainterStore.getState().sourceSliders as
        | Record<string, SliderConfig>
        | undefined;
      if (filters) {
        handleFiltersApply(filters, sliders);
        if (plotConfig?.id) {
          setPlotFilters(plotConfig.id, filters);
          if (sliders) setPlotSliders(plotConfig.id, sliders);
        }
        showToast("Filters applied", "success");
      }
    }

    if (!usePainterStore.getState().shiftHeld) deactivatePainter();
  }, [
    plotType,
    deactivatePainter,
    setAppearanceSettings,
    plotConfig?.id,
    setPlotAppearance,
    handleFiltersApply,
    setPlotFilters,
    setPlotSliders,
    showToast,
  ]);

  // When maximized, render as a modal overlay
  if (isMaximized) {
    return (
      <div
        className="fixed inset-0 z-50 bg-black bg-opacity-50 flex items-center justify-center p-4"
        onClick={handleMaximize}
      >
        <div
          className="bg-white rounded-lg shadow-2xl border border-gray-200 overflow-hidden w-full h-full max-h-full"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header with controls */}
          <div
            className="flex items-center justify-between p-3 bg-gray-50 border-b border-gray-200"
            style={{ height: "52px" }}
          >
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-gray-700">
                {(typeof plotJson.layout?.title === "string"
                  ? plotJson.layout.title
                  : plotJson.layout?.title?.text) || "Plot"}
              </span>
            </div>

            <div className="flex items-center gap-1">
              <button
                onClick={handleMaximize}
                className="p-1.5 rounded hover:bg-gray-200 transition-colors duration-150"
                title="Restore"
              >
                <Minimize2 size={16} className="text-gray-600" />
              </button>
            </div>
          </div>

          {/* Plot content */}
          <div className="plot-content" style={{ height: "calc(100% - 52px)" }}>
            <div
              className={`p-4 h-full relative ${
                isSquareMode ? "square-mode" : ""
              }`}
            >
              <div
                className="absolute top-3 left-3 z-20 inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white/90 px-2.5 py-1 shadow-sm"
                aria-label={`Status: ${statusLabel[displayStatus]}`}
              >
                <span
                  className={`block h-3.5 w-3.5 rounded-full border border-black/10 ${statusClass[displayStatus]}`}
                ></span>
                <span className="text-xs font-medium text-gray-700">
                  {statusLabel[displayStatus]}
                </span>
              </div>

              <PlotComponent
                plotJson={customizedPlotJson}
                onRelayout={handleRelayout}
              />

              {/* Dataset update error overlay */}
              {datasetUpdateError && (
                <div className="absolute inset-0 flex items-center justify-center bg-white bg-opacity-90 rounded">
                  <div className="max-w-md p-6 text-center">
                    <div className="text-red-600 font-semibold text-lg mb-2">
                      Dataset Update Failed
                    </div>
                    <div className="text-gray-700 text-sm mb-4">
                      {datasetUpdateError}
                    </div>
                    <button
                      onClick={() => setDatasetUpdateError(null)}
                      className="px-4 py-2 bg-red-600 text-white text-sm rounded hover:bg-red-700 transition-colors"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Regular view when not maximized
  return (
    <>
      <div
        className="relative w-full h-full bg-white rounded-lg shadow-md border border-gray-200 overflow-hidden"
        onMouseEnter={() => setIsHoveredOrFocused(true)}
        onMouseLeave={() => setIsHoveredOrFocused(false)}
        onFocus={() => setIsHoveredOrFocused(true)}
        onBlur={() => setIsHoveredOrFocused(false)}
        tabIndex={0}
        onClick={() => handlePaintTargetClick()}
      >
        {/* Plot content */}
        <div className="plot-content">
          <div
            className={`p-2 pb-0 relative ${isSquareMode ? "square-mode" : ""}`}
          >
            <div
              className="absolute top-3 left-3 z-20 inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white/90 px-2.5 py-1 shadow-sm"
              aria-label={`Status: ${statusLabel[displayStatus]}`}
            >
              <span
                className={`block h-3.5 w-3.5 rounded-full border border-black/10 ${statusClass[displayStatus]}`}
              ></span>
              <span className="text-xs font-medium text-gray-700">
                {statusLabel[displayStatus]}
              </span>
            </div>

            <PlotComponent
              plotJson={customizedPlotJson}
              onRelayout={handleRelayout}
            />

            {/* Dataset update error overlay */}
            {datasetUpdateError && (
              <div className="absolute inset-0 flex items-center justify-center bg-white bg-opacity-90 rounded">
                <div className="max-w-md p-6 text-center">
                  <div className="text-red-600 font-semibold text-lg mb-2">
                    Dataset Update Failed
                  </div>
                  <div className="text-gray-700 text-sm mb-4">
                    {datasetUpdateError}
                  </div>
                  <button
                    onClick={() => setDatasetUpdateError(null)}
                    className="px-4 py-2 bg-red-600 text-white text-sm rounded hover:bg-red-700 transition-colors"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Loading overlay to prevent flickering during filter/slider operations */}
        {/* {isApplyingFilters && (
          <div className="absolute inset-0 bg-white bg-opacity-75 flex items-center justify-center z-20">
            <div className="text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-2"></div>
              <p className="text-sm text-gray-600">Applying filters...</p>
            </div>
          </div>
        )} */}

        {/* Sliding Control Panel */}
        <div
          className={`
            absolute top-0 right-0 h-full w-12 bg-white border-l border-gray-200 shadow-lg
            flex flex-col justify-between py-2
            transform transition-transform duration-300 ease-in-out
            ${isHoveredOrFocused ? "translate-x-0" : "translate-x-full"}
          `}
          style={{ zIndex: 10 }}
        >
          {/* Close button at top */}
          <div className="flex justify-center">
            <div className="flex flex-col gap-1 items-center">
              {onClose && (
                <Tooltip content="Close" position="left">
                  <button
                    onClick={onClose}
                    className="p-1.5 rounded hover:bg-gray-300 transition-colors"
                    title="Close"
                  >
                    <X size={16} className="text-red-600" />
                  </button>
                </Tooltip>
              )}

              {/* Reset button at the top */}
              <Tooltip content="Reset plot" position="left">
                <button
                  onClick={handleReset}
                  className="p-1.5 rounded hover:bg-orange-100 hover:text-orange-600 transition-colors duration-150"
                  title="Reset"
                >
                  <RotateCcw size={16} className="text-gray-600" />
                </button>
              </Tooltip>
            </div>
          </div>

          {/* Control buttons at bottom */}
          <div className="flex flex-col gap-1 items-center">
            <div className="flex flex-col gap-1 items-center mt-1">
              {/* Save as PNG, PDF & SVG on server */}
              <Tooltip content="Export images" position="left">
                <button
                  onClick={handleSavePlotImages}
                  className="relative p-1.5 rounded hover:bg-gray-200 transition-colors duration-150"
                  title="Export images"
                >
                  <ImageDown size={16} className="text-gray-600" />
                </button>
              </Tooltip>

              {/* Send to Notes - saves light/dark PNG and appends markdown link */}
              <Tooltip content="Send to Notes" position="left">
                <button
                  onClick={handleSendToNotes}
                  className="relative p-1.5 rounded hover:bg-gray-200 transition-colors duration-150"
                  title="Send to Notes"
                >
                  <ImagePlus size={16} className="text-gray-600" />
                </button>
              </Tooltip>

              {/* Appearance Settings */}
              <Tooltip
                content={
                  shiftHeld && hoverAppearanceBtn
                    ? "Paint Appearance"
                    : "Edit Appearance"
                }
                position="left"
              >
                <button
                  onClick={() => {
                    if (shiftHeld && hoverAppearanceBtn) {
                      // activate painter from this appearance button
                      startThemePaintFromThis();
                    } else {
                      handleAppearanceSettingsOpen();
                    }
                  }}
                  onMouseEnter={() => setHoverAppearanceBtn(true)}
                  onMouseLeave={() => setHoverAppearanceBtn(false)}
                  className="relative p-1.5 rounded hover:bg-gray-200 transition-colors duration-150"
                  title={
                    shiftHeld && hoverAppearanceBtn
                      ? "Paint Appearance"
                      : "Edit Appearance"
                  }
                >
                  <Palette
                    size={16}
                    className={`text-${
                      shiftHeld && hoverAppearanceBtn ? "blue-600" : "gray-600"
                    }`}
                  />
                  {shiftHeld && hoverAppearanceBtn && (
                    <span className="absolute -top-1 -left-1">
                      <Paintbrush size={14} className="text-blue-600" />
                    </span>
                  )}
                </button>
              </Tooltip>

              {/* Filters */}
              <Tooltip
                content={
                  shiftHeld && hoverFiltersBtn
                    ? "Paint Filters"
                    : "Apply Filters & Sliders"
                }
                position="left"
              >
                <button
                  onClick={() => {
                    if (shiftHeld && hoverFiltersBtn) {
                      startFilterPaintFromThis();
                    } else {
                      handleFiltersModalOpen();
                    }
                  }}
                  onMouseEnter={() => setHoverFiltersBtn(true)}
                  onMouseLeave={() => setHoverFiltersBtn(false)}
                  className="relative p-1.5 rounded hover:bg-gray-200 transition-colors duration-150"
                  title={
                    shiftHeld && hoverFiltersBtn
                      ? "Paint Filters"
                      : "Apply Filters & Sliders"
                  }
                  disabled={isApplyingFilters}
                >
                  <Filter
                    size={16}
                    className={`text-${
                      shiftHeld && hoverFiltersBtn ? "blue-600" : "gray-600"
                    }`}
                  />
                  {appliedFilters.length > 0 && (
                    <span className="absolute -top-1 -right-1 flex items-center gap-1">
                      <span className="font-semibold text-blue-700 text-xs bg-blue-100 rounded-full px-0.5 py-0.5 min-w-[18px] text-center">
                        {appliedFilters.length}
                      </span>
                    </span>
                  )}
                  {shiftHeld && hoverFiltersBtn && (
                    <span className="absolute -top-1 -left-1">
                      <Paintbrush size={14} className="text-blue-600" />
                    </span>
                  )}
                  {isApplyingFilters && (
                    <div className="absolute inset-0 flex items-center justify-center bg-white bg-opacity-75 rounded">
                      <div className="w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                    </div>
                  )}
                </button>
              </Tooltip>

              {/* Swap X & Y Axes */}
              <Tooltip content="Swap X & Y Axes" position="left">
                <button
                  onClick={handleSwapAxes}
                  className={`relative p-1.5 rounded transition-colors duration-150 ${
                    areAxesSwapped
                      ? "bg-blue-100 text-blue-600"
                      : "hover:bg-gray-200"
                  }`}
                  title="Swap X & Y Axes (Visual)" // TODOLATER: After filters are moved to frontend
                >
                  <ArrowLeftRight
                    size={16}
                    className={
                      areAxesSwapped ? "text-blue-600" : "text-gray-600"
                    }
                  />
                </button>
              </Tooltip>

              {/* Maximize */}
              <Tooltip content="Maximize" position="left">
                <button
                  onClick={handleMaximize}
                  className="p-1.5 rounded hover:bg-gray-200 transition-colors duration-150"
                  title="Maximize"
                >
                  <Maximize2 size={16} className="text-gray-600" />
                </button>
              </Tooltip>
            </div>
          </div>
        </div>
      </div>

      {/* Appearance Settings Modal */}
      <AppearanceModal
        isOpen={isAppearanceModalOpen}
        onClose={handleAppearanceSettingsClose}
        settings={appearanceSettings}
        onChange={handleAppearanceSettingsChange}
        plotType={plotType}
        plotTitle={plotTitle}
      />

      {/* Filters Modal */}
      <FiltersModal
        isOpen={isFiltersModalOpen}
        onClose={handleFiltersModalClose}
        onApplyFilters={handleFiltersApply}
        plotType={plotType}
        plotTitle={plotTitle}
        currentFilters={appliedFilters}
        currentSliders={sliderConfig}
        availableSliders={availableSliders}
      />
    </>
  );
};

export default PlotWrapper;

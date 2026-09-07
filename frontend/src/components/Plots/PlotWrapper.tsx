import React, { useState, useEffect, useRef, useCallback, useMemo, startTransition } from "react";
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
  Crosshair,
  Scissors,
  Split,
  Pin,
  PinOff,
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
import type { PlotConfiguration, SliderConfig } from "../../components/interfaces";
import { useToast } from "../../hooks/useToast";
import { usePlotStore } from "../../stores/plotStore";
import type { PlotPersistentState } from "../../components/interfaces";
import usePainterStore from "../../stores/painterStore";
import Tooltip from "../Tooltip";
import { useShortcut } from "../../hooks/useGlobalShortcuts";

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
  /** Toggle whether this plot stays on its measurement during Next/Prev. */
  onTogglePinned?: (pinned: boolean) => void;
  plotConfig?: PlotConfiguration;
  onUpdateConfig?: (config: Partial<PlotConfiguration>) => void;
  onFiltersModalOpenChange?: (isOpen: boolean) => void;
  availableSliders?: Record<string, SliderConfig>; // Sliders from backend
  onAddPlot?: (config: Omit<PlotConfiguration, "id">) => void;
  onSwapAxesChange?: (swapped: boolean) => void;
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
    return plotlyColorscales[key as keyof typeof plotlyColorscales] as Array<[number, string]>;
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

const PlotWrapper: React.FC<Props> = ({
  plotJson,
  plotRef,
  plotStatus = "completed",
  onClose,
  onTogglePinned,
  plotConfig,
  onUpdateConfig,
  onFiltersModalOpenChange,
  availableSliders = {},
  onAddPlot,
  onSwapAxesChange,
}) => {
  const { showToast } = useToast();

  // Detect plot type from plotJson
  const detectPlotType = (plotData: PlotlyJSON): string => {
    if (!plotData.data || plotData.data.length === 0) {
      return "line";
    }

    const firstTrace = plotData.data[0];
    // Check for heatmap types
    if (firstTrace.type === "heatmap") {
      return "heatmap";
    }

    // Default to line plot for scatter, line, etc.
    return "line";
  };

  const plotType = detectPlotType(plotJson);
  const isHeatmapPlot = plotType === "heatmap";

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
  const [appearanceSettings, setAppearanceSettings] = useState<PlotAppearanceSettings>(() =>
    getInitialSettings(plotType),
  );
  const [customizedPlotJson, setCustomizedPlotJson] = useState<PlotlyJSON>(plotJson);
  const [isHoveredOrFocused, setIsHoveredOrFocused] = useState(false);
  const [relayoutData, setRelayoutData] = useState<Record<string, unknown> | null>(null);
  const [activePlotRef, setActivePlotRef] = useState<string | undefined>(plotRef);

  // Store the original plot JSON (never modified, always the raw data from backend)
  const [originalPlotJson, setOriginalPlotJson] = useState<PlotlyJSON>(plotJson);
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
          const filename = statusResponse.data.zip_filename || "plot_images.zip";

          // Desktop mode: the backend already wrote the zip to disk (WebView2
          // can't save browser downloads), so just report where it landed.
          const savedTo: string | undefined = statusResponse.data.saved_to;
          if (savedTo) {
            showToast(`Saved to ${savedTo}`, "success");
            return;
          }

          // Browser mode: download the zip via a blob + anchor click.
          const downloadUrl = `${PROD_BACKEND_URL}${statusResponse.data.download_url}`;
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
        error.response?.data?.message || error.message || "Failed to export plot images",
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
      showToast("Starting export to notes... This may take a moment.", "info");

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
        showToast(data.message || "Exported and saved to notes", "success");
        try {
          window.dispatchEvent(
            new CustomEvent("notes:open", {
              detail: {
                datasetPath: plotConfig.fpath,
                openPanel: true,
              },
            }),
          );

          // Force Notes panel to reload content even when the same target is already selected.
          window.dispatchEvent(
            new CustomEvent("notes:refresh", {
              detail: {
                datasetPath: plotConfig.fpath,
              },
            }),
          );
        } catch {
          // ignore dispatch errors
        }
      } else {
        showToast((data && data.message) || "Failed to send to notes.", "error");
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

  // Background Correction ("BG Corr") state
  const [isBGCorrActive, setIsBGCorrActive] = useState(false);
  const [bgCorrPoints, setBgCorrPoints] = useState<
    {
      x: number;
      y: number;
      z?: number;
      row_idx?: number;
      col_idx?: number;
    }[]
  >([]);
  const [is3DMode, setIs3DMode] = useState(false);
  const [bgCorrMode, setBgCorrMode] = useState<
    "constant" | "linear" | "row_mean" | "col_mean" | "plane"
  >("constant");
  const [plotKey, setPlotKey] = useState(0);
  const plotContainerRef = useRef<HTMLDivElement>(null);

  // Hover states for modal buttons to show paint overlay when Shift is held
  const [hoverAppearanceBtn, setHoverAppearanceBtn] = useState(false);
  const [hoverFiltersBtn, setHoverFiltersBtn] = useState(false);

  // LineCut state
  const [isLineCutActive, setIsLineCutActive] = useState(false);
  const [lineCutAxis, setLineCutAxis] = useState<"x" | "y" | null>(null);
  const [lineCutPreviewJson, setLineCutPreviewJson] = useState<PlotlyJSON | null>(null);
  const [hoverData, setHoverData] = useState<{
    x: number;
    y: number;
    xIndex: number;
    yIndex: number;
  } | null>(null);
  const lastLineCutAxisDomainsRef = useRef<{ x: number[]; y: number[] }>({
    x: [],
    y: [],
  });
  const lastHoverDataRef = useRef<{
    x: number;
    y: number;
    xIndex: number;
    yIndex: number;
  } | null>(null);
  const lastLineCutAxisRef = useRef<"x" | "y" | null>(null);

  const shiftHeld = usePainterStore((s) => s.shiftHeld);
  const lineCutForcedWidthRef = useRef(false);

  const dispatchPlotWidthPreset = useCallback(
    (percent: number) => {
      try {
        if (!plotConfig?.id) return;
        window.dispatchEvent(
          new CustomEvent("plot-size-preset", {
            detail: { id: plotConfig.id, percent },
          }),
        );
      } catch {
        // ignore resize dispatch errors
      }
    },
    [plotConfig?.id],
  );

  useEffect(() => {
    if (lineCutAxis) {
      lastLineCutAxisRef.current = lineCutAxis;
    }
  }, [lineCutAxis]);

  const resolvedLineCutAxis = lineCutAxis ?? lastLineCutAxisRef.current ?? ("x" as const);

  // Keyboard listeners for LineCut mode selection (X/Y keys)
  useEffect(() => {
    if (!isLineCutActive || (!isHoveredOrFocused && !isMaximized)) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        (e.target as HTMLElement).isContentEditable
      ) {
        return;
      }
      const key = e.key.toLowerCase();
      if (key === "x") setLineCutAxis("y");
      else if (key === "y") setLineCutAxis("x");
      else if (key === "escape") {
        setIsLineCutActive(false);
        setLineCutAxis(null);
        setLineCutPreviewJson(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isLineCutActive, isHoveredOrFocused, isMaximized]);

  // Ref to track isApplyingFilters for effects that shouldn't re-run when this flag changes
  const isApplyingFiltersRef = useRef<boolean>(isApplyingFilters);

  useEffect(() => {
    isApplyingFiltersRef.current = isApplyingFilters;
  }, [isApplyingFilters]);

  // Sliders state
  const [sliderConfig, setSliderConfig] = useState<Record<string, SliderConfig>>({});
  // Track the last applied slider values to avoid unnecessary updates
  const lastAppliedSliders = useRef<Record<string, SliderConfig>>({});

  // Dataset update error state
  const [datasetUpdateError, setDatasetUpdateError] = useState<string | null>(null);

  const displayStatus: PlotLiveStatus = datasetUpdateError ? "error" : plotStatus;

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
  const { getPlotState, setPlotAppearance, setPlotFilters, setPlotSliders, setPlotAxesSwapped } =
    usePlotStore();

  const isArrayLikeValue = useCallback((value: unknown): boolean => {
    if (value == null) return false;
    if (Array.isArray(value) || ArrayBuffer.isView(value)) return true;
    if (typeof value !== "object") return false;
    const len = (value as { length?: unknown }).length;
    return typeof len === "number" && Number.isFinite(len) && len >= 0;
  }, []);

  const toNumericArray = useCallback(
    (values: unknown): number[] => {
      if (!values) return [];

      if (typeof values === "object" && !Array.isArray(values)) {
        const obj = values as Record<string, unknown>;

        // Plotly/NumPy-style binary typed-array payload: { dtype, bdata }
        if (typeof obj.bdata === "string" && typeof obj.dtype === "string") {
          try {
            const dtypeRaw = String(obj.dtype).trim();
            const dtype = dtypeRaw.replace(/^[<>=|]/, "").toLowerCase();
            const b64 = String(obj.bdata);
            const bin = atob(b64);
            const bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
            const buffer = bytes.buffer;

            const typedToNumbers = (arr: ArrayLike<number | bigint>) =>
              Array.from(arr as ArrayLike<number | bigint>)
                .map((v) => (typeof v === "bigint" ? Number(v) : Number(v)))
                .filter((v) => Number.isFinite(v));

            if (dtype === "f8" || dtype === "float64") {
              return typedToNumbers(new Float64Array(buffer));
            }
            if (dtype === "f4" || dtype === "float32") {
              return typedToNumbers(new Float32Array(buffer));
            }
            if (dtype === "i1" || dtype === "int8") {
              return typedToNumbers(new Int8Array(buffer));
            }
            if (dtype === "u1" || dtype === "uint8") {
              return typedToNumbers(new Uint8Array(buffer));
            }
            if (dtype === "i2" || dtype === "int16") {
              return typedToNumbers(new Int16Array(buffer));
            }
            if (dtype === "u2" || dtype === "uint16") {
              return typedToNumbers(new Uint16Array(buffer));
            }
            if (dtype === "i4" || dtype === "int32") {
              return typedToNumbers(new Int32Array(buffer));
            }
            if (dtype === "u4" || dtype === "uint32") {
              return typedToNumbers(new Uint32Array(buffer));
            }
          } catch {
            // fall through to generic array-like decoder
          }
        }
      }

      if (!isArrayLikeValue(values)) return [];

      return Array.from(values as ArrayLike<unknown>)
        .map((v) => (typeof v === "number" ? v : Number(v)))
        .filter((v) => Number.isFinite(v));
    },
    [isArrayLikeValue],
  );

  const toNumeric2DArray = useCallback(
    (values: unknown): number[][] => {
      if (!values) return [];

      // Handle ndarray-like payloads such as { dtype, bdata, shape, _inputArray }
      if (typeof values === "object" && !Array.isArray(values)) {
        const obj = values as Record<string, unknown>;

        // Plotly often stores z as { dtype, bdata, shape, _inputArray }.
        // Prefer _inputArray when present because it is already row-structured.
        if (Array.isArray(obj._inputArray)) {
          const rowsFromInputArray = (obj._inputArray as unknown[])
            .map((row) => toNumericArray(row))
            .filter((row) => row.length > 0);
          if (rowsFromInputArray.length > 0) {
            return rowsFromInputArray;
          }
        }

        const shapeRaw = obj.shape;

        const parseShape = (shape: unknown): { rows: number; cols: number } | null => {
          if (Array.isArray(shape) && shape.length >= 2) {
            const rows = Number(shape[0]);
            const cols = Number(shape[1]);
            if (Number.isFinite(rows) && Number.isFinite(cols)) {
              return {
                rows: Math.max(0, Math.floor(rows)),
                cols: Math.max(0, Math.floor(cols)),
              };
            }
          }
          if (typeof shape === "string") {
            const nums = shape
              .replace(/[()[\]\s]/g, "")
              .split(",")
              .map((x) => Number(x))
              .filter((x) => Number.isFinite(x));
            if (nums.length >= 2) {
              return {
                rows: Math.max(0, Math.floor(nums[0])),
                cols: Math.max(0, Math.floor(nums[1])),
              };
            }
          }
          return null;
        };

        const parsedShape = parseShape(shapeRaw);
        if (parsedShape) {
          const rows = parsedShape.rows;
          const cols = parsedShape.cols;
          const flat = toNumericArray(values);
          if (rows > 0 && cols > 0 && flat.length >= rows * cols) {
            const out: number[][] = [];
            for (let r = 0; r < rows; r++) {
              out.push(flat.slice(r * cols, (r + 1) * cols));
            }
            return out;
          }
        }
      }

      if (!isArrayLikeValue(values)) return [];

      const rows = Array.from(values as ArrayLike<unknown>);
      if (rows.length === 0) return [];

      const first = rows[0];
      if (isArrayLikeValue(first)) {
        return rows.map((row) => toNumericArray(row)).filter((row) => row.length > 0);
      }

      const flat = toNumericArray(rows);
      return flat.length > 0 ? [flat] : [];
    },
    [isArrayLikeValue, toNumericArray],
  );

  const getClosestIndex = useCallback(
    (axisValues: number[], target: number, fallback: number): number => {
      if (!axisValues.length || !Number.isFinite(target)) {
        return Math.max(0, fallback);
      }

      let bestIdx = 0;
      let bestDelta = Infinity;
      for (let i = 0; i < axisValues.length; i++) {
        const delta = Math.abs(axisValues[i] - target);
        if (delta < bestDelta) {
          bestDelta = delta;
          bestIdx = i;
        }
      }
      return bestIdx;
    },
    [],
  );

  // Handle Heatmap Hover for LineCut Preview
  const handlePlotHover = useCallback(
    (event: any) => {
      if (!isLineCutActive || !event.points || !event.points[0]) {
        return;
      }

      const point = event.points[0];

      try {
        let fallbackXIndex = 0;
        let fallbackYIndex = 0;

        if (Array.isArray(point.pointIndex) && point.pointIndex.length >= 2) {
          fallbackYIndex = Number(point.pointIndex[0]) || 0;
          fallbackXIndex = Number(point.pointIndex[1]) || 0;
        } else if (Array.isArray(point.pointNumber) && point.pointNumber.length >= 2) {
          fallbackYIndex = Number(point.pointNumber[0]) || 0;
          fallbackXIndex = Number(point.pointNumber[1]) || 0;
        } else {
          const flatIdx =
            typeof point.pointIndex === "number"
              ? point.pointIndex
              : Number(point.pointNumber) || 0;
          fallbackXIndex = flatIdx;
          fallbackYIndex = flatIdx;
        }

        const pointX = typeof point.x === "number" ? point.x : Number(point.x || 0);
        const pointY = typeof point.y === "number" ? point.y : Number(point.y || 0);

        // Persist hover lock even if preview generation fails.
        const earlyHoverData = {
          x: pointX,
          y: pointY,
          xIndex: fallbackXIndex,
          yIndex: fallbackYIndex,
        };
        setHoverData(earlyHoverData);
        lastHoverDataRef.current = earlyHoverData;

        const pointObj = point as {
          data?: Record<string, unknown>;
          fullData?: Record<string, unknown>;
        };
        const hoveredTrace = pointObj.data ?? pointObj.fullData;
        const fallbackHeatmapTrace = (customizedPlotJson.data || []).find(
          (t) => t.type === "heatmap",
        ) as unknown as Record<string, unknown> | undefined;
        const activeTrace = hoveredTrace ?? fallbackHeatmapTrace;

        const zSource =
          (activeTrace && activeTrace["z"]) || (fallbackHeatmapTrace && fallbackHeatmapTrace["z"]);

        if (!zSource) {
          setLineCutPreviewJson(null);
          return;
        }

        const xArr = toNumericArray(
          (activeTrace && activeTrace["x"]) || customizedPlotJson.layout?.xaxis?.tickvals,
        );
        const yArr = toNumericArray(
          (activeTrace && activeTrace["y"]) || customizedPlotJson.layout?.yaxis?.tickvals,
        );
        lastLineCutAxisDomainsRef.current = { x: xArr, y: yArr };
        const zRows = toNumeric2DArray(zSource);

        if (zRows.length === 0) {
          setLineCutPreviewJson(null);
          return;
        }

        const xIndex = getClosestIndex(xArr, pointX, fallbackXIndex);
        const yIndex = getClosestIndex(yArr, pointY, fallbackYIndex);

        const nextHoverData = {
          x: pointX,
          y: pointY,
          xIndex,
          yIndex,
        };

        setHoverData(nextHoverData);
        lastHoverDataRef.current = nextHoverData;

        const activeAxis = lineCutAxis ?? lastLineCutAxisRef.current;
        if (!activeAxis) return;
        lastLineCutAxisRef.current = activeAxis;

        let previewX: number[] = [];
        let previewY: number[] = [];
        let title = "";

        const getTitleText = (axis: any) => {
          if (!axis?.title) return "";
          if (typeof axis.title === "string") return axis.title;
          return axis.title.text || "";
        };

        const getZTitle = () => {
          const coloraxis = (customizedPlotJson.layout as any)?.coloraxis;
          if (coloraxis?.colorbar?.title?.text) return coloraxis.colorbar.title.text;
          return "Intensity";
        };

        if (activeAxis === "x") {
          previewY = zRows.map((row) => row[xIndex]).filter((v) => Number.isFinite(v));
          previewX = yArr.length > 0 ? yArr.slice(0, previewY.length) : previewY.map((_, i) => i);
          title = `Slice at X = ${typeof point.x === "number" ? point.x.toFixed(4) : String(point.x)}`;
        } else {
          const row = zRows[yIndex] || [];
          previewY = row.filter((v) => Number.isFinite(v));
          previewX = xArr.length > 0 ? xArr.slice(0, previewY.length) : previewY.map((_, i) => i);
          title = `Slice at Y = ${typeof point.y === "number" ? point.y.toFixed(4) : String(point.y)}`;
        }

        if (previewY.length === 0) {
          setLineCutPreviewJson(null);
          return;
        }

        const previewJson: PlotlyJSON = {
          data: [
            {
              x: previewX,
              y: previewY,
              type: "scatter",
              mode: "lines",
              line: { color: "#2563eb", width: 3 },
              name: "LineCut Preview",
            },
          ],
          layout: {
            title: { text: title, font: { size: 16 } },
            margin: { t: 48, r: 20, b: 52, l: 70 },
            xaxis: {
              title: {
                text:
                  activeAxis === "x"
                    ? getTitleText(customizedPlotJson.layout?.yaxis)
                    : getTitleText(customizedPlotJson.layout?.xaxis),
                font: { size: 14 },
              },
              tickfont: { size: 13 },
            },
            yaxis: {
              title: {
                text: getZTitle(),
                font: { size: 14 },
              },
              tickfont: { size: 13 },
            },
            paper_bgcolor: "rgba(0,0,0,0)",
            plot_bgcolor: "rgba(0,0,0,0)",
          },
          config: { responsive: true, displayModeBar: false },
        };

        setLineCutPreviewJson(previewJson);
      } catch (err: any) {
        console.error("LineCut preview generation error:", err);
      }
    },
    [
      isLineCutActive,
      lineCutAxis,
      customizedPlotJson,
      toNumericArray,
      toNumeric2DArray,
      getClosestIndex,
    ],
  );

  const handleLineCutClick = useCallback(
    async (event?: Plotly.PlotMouseEvent) => {
      if (!isLineCutActive) return;
      const activeAxis = lineCutAxis ?? lastLineCutAxisRef.current;
      const clickedPoint = event?.points?.[0];

      let clickSelection: {
        x: number;
        y: number;
        xIndex: number;
        yIndex: number;
      } | null = null;

      if (clickedPoint) {
        const pointX = typeof clickedPoint.x === "number" ? clickedPoint.x : Number(clickedPoint.x);
        const pointY = typeof clickedPoint.y === "number" ? clickedPoint.y : Number(clickedPoint.y);

        if (Number.isFinite(pointX) && Number.isFinite(pointY)) {
          let fallbackXIndex = 0;
          let fallbackYIndex = 0;

          if (Array.isArray(clickedPoint.pointIndex) && clickedPoint.pointIndex.length >= 2) {
            fallbackYIndex = Number(clickedPoint.pointIndex[0]) || 0;
            fallbackXIndex = Number(clickedPoint.pointIndex[1]) || 0;
          } else if (
            Array.isArray(clickedPoint.pointNumber) &&
            clickedPoint.pointNumber.length >= 2
          ) {
            fallbackYIndex = Number(clickedPoint.pointNumber[0]) || 0;
            fallbackXIndex = Number(clickedPoint.pointNumber[1]) || 0;
          }

          const pointObj = clickedPoint as unknown as {
            data?: Record<string, unknown>;
            fullData?: Record<string, unknown>;
          };
          const clickedTrace = pointObj.data ?? pointObj.fullData;

          const xArr = toNumericArray(
            (clickedTrace && clickedTrace["x"]) || customizedPlotJson.layout?.xaxis?.tickvals,
          );
          const yArr = toNumericArray(
            (clickedTrace && clickedTrace["y"]) || customizedPlotJson.layout?.yaxis?.tickvals,
          );

          if (xArr.length || yArr.length) {
            lastLineCutAxisDomainsRef.current = { x: xArr, y: yArr };
          }

          clickSelection = {
            x: pointX,
            y: pointY,
            xIndex: getClosestIndex(xArr, pointX, fallbackXIndex),
            yIndex: getClosestIndex(yArr, pointY, fallbackYIndex),
          };

          setHoverData(clickSelection);
          lastHoverDataRef.current = clickSelection;
        }
      }

      const activeHoverData = clickSelection ?? hoverData ?? lastHoverDataRef.current;

      if (!activeAxis) {
        showToast("LineCut Axis not detected. Hold X or Y and retry.", "warning");
        return;
      }
      if (!activeHoverData) {
        showToast("Hover coordinates not locked. Hover over points and retry.", "warning");
        return;
      }
      if (!onAddPlot) {
        showToast("System error: onAddPlot missing.", "error");
        return;
      }

      try {
        showToast("Creating persistent LinePlot...", "info");

        const xVar = plotConfig?.indeps?.[0];
        const yVar = plotConfig?.indeps?.[1];

        if (!xVar || !yVar) {
          showToast(
            `Failed: Missing variables. indeps: ${JSON.stringify(plotConfig?.indeps)}`,
            "error",
          );
          throw new Error("Cannot determine independent variables for cut");
        }

        const normalizeAxisLabel = (label: string): string =>
          label
            .toLowerCase()
            .replace(/\([^)]*\)/g, "")
            .replace(/\s+/g, "")
            .trim();

        const getAxisTitleText = (axis: unknown): string => {
          if (!axis || typeof axis !== "object") return "";
          const axisObj = axis as { title?: string | { text?: string } };
          if (typeof axisObj.title === "string") return axisObj.title;
          if (axisObj.title && typeof axisObj.title === "object") {
            return axisObj.title.text || "";
          }
          return "";
        };

        const xAxisTitle = getAxisTitleText(customizedPlotJson.layout?.xaxis);
        const yAxisTitle = getAxisTitleText(customizedPlotJson.layout?.yaxis);

        const nxTitle = normalizeAxisLabel(xAxisTitle);
        const nyTitle = normalizeAxisLabel(yAxisTitle);
        const nxVar = normalizeAxisLabel(xVar);
        const nyVar = normalizeAxisLabel(yVar);

        const xMatchesXVar = nxTitle && (nxTitle.includes(nxVar) || nxVar.includes(nxTitle));
        const xMatchesYVar = nxTitle && (nxTitle.includes(nyVar) || nyVar.includes(nxTitle));
        const yMatchesXVar = nyTitle && (nyTitle.includes(nxVar) || nxVar.includes(nyTitle));
        const yMatchesYVar = nyTitle && (nyTitle.includes(nyVar) || nyVar.includes(nyTitle));

        const displayXVar =
          xMatchesXVar && !xMatchesYVar
            ? xVar
            : xMatchesYVar && !xMatchesXVar
              ? yVar
              : areAxesSwapped
                ? xVar
                : yVar;

        const displayYVar =
          yMatchesYVar && !yMatchesXVar
            ? yVar
            : yMatchesXVar && !yMatchesYVar
              ? xVar
              : areAxesSwapped
                ? yVar
                : xVar;

        const cutVar = activeAxis === "x" ? displayXVar : displayYVar;
        const remainVar = activeAxis === "x" ? displayYVar : displayXVar;
        const cutVal = activeAxis === "x" ? activeHoverData.x : activeHoverData.y;

        // Keep slider editable in the created LinePlot by preserving range/step.
        const sourceCutSlider =
          availableSliders[cutVar] ||
          (sliderConfig[cutVar] && sliderConfig[cutVar].step > 0
            ? sliderConfig[cutVar]
            : undefined);

        const domainForCutVar =
          activeAxis === "x"
            ? lastLineCutAxisDomainsRef.current.x
            : lastLineCutAxisDomainsRef.current.y;

        const domainFallbackSlider: SliderConfig | undefined = (() => {
          if (!domainForCutVar || domainForCutVar.length < 2) {
            return undefined;
          }

          let min = Infinity;
          let max = -Infinity;
          for (const v of domainForCutVar) {
            if (Number.isFinite(v)) {
              if (v < min) min = v;
              if (v > max) max = v;
            }
          }

          if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) {
            return undefined;
          }

          let bestStep = Infinity;
          for (let i = 1; i < domainForCutVar.length; i++) {
            const d = Math.abs(domainForCutVar[i] - domainForCutVar[i - 1]);
            if (d > 0 && d < bestStep) bestStep = d;
          }

          const step =
            Number.isFinite(bestStep) && bestStep > 0
              ? bestStep
              : Math.abs(max - min) / Math.max(domainForCutVar.length - 1, 1);

          return {
            min,
            max,
            step: step > 0 ? step : 0.001,
            value: Math.min(max, Math.max(min, cutVal)),
          };
        })();

        const normalizedCutSlider: SliderConfig = sourceCutSlider
          ? {
              min: sourceCutSlider.min,
              max: sourceCutSlider.max,
              step: sourceCutSlider.step > 0 ? sourceCutSlider.step : 1,
              value: Math.min(sourceCutSlider.max, Math.max(sourceCutSlider.min, cutVal)),
            }
          : domainFallbackSlider || {
              // Final fallback if domain metadata is missing.
              min: cutVal - 1,
              max: cutVal + 1,
              step: 0.001,
              value: cutVal,
            };

        // Keep non-cut sliders but never lock the variable that should remain on x-axis.
        const nextSliders: Record<string, SliderConfig> = { ...sliderConfig };
        delete nextSliders[remainVar];
        nextSliders[cutVar] = normalizedCutSlider;

        const valid1DFilters = new Set([
          "diff",
          "savgol",
          "sma",
          "normalize",
          "log_scale",
          "polyfit",
          "bg_corr_constant",
          "bg_corr_linear",
        ]);

        const filtersOrder: string[] = [];
        const filtersOpts: Record<string, unknown> = {};

        appliedFilters.forEach((filter) => {
          let name = filter.name;
          // Translate 2D diff to 1D diff
          if (name === "diff_x" || name === "diff_y") {
            name = "diff";
          }

          if (valid1DFilters.has(name) && !filtersOrder.includes(name)) {
            filtersOrder.push(name);
            filtersOpts[name] = filter.options ?? {};
          }
        });

        onAddPlot({
          fpath: plotConfig.fpath,
          indeps: [remainVar],
          deps: plotConfig.deps,
          plotType: "LinePlot",
          source: plotConfig.source,
          preferredSource: plotConfig.preferredSource,
          slider: nextSliders,
          filters_order: filtersOrder,
          filters_opts: filtersOpts,
        });

        showToast(`LinePlot created at ${cutVar}=${cutVal.toFixed(4)}`, "success");
      } catch (err: any) {
        showToast(`Failed to create linecut: ${err.message}`, "error");
      }
    },
    [
      isLineCutActive,
      lineCutAxis,
      hoverData,
      areAxesSwapped,
      appliedFilters,
      availableSliders,
      customizedPlotJson.layout?.xaxis,
      customizedPlotJson.layout?.yaxis,
      getClosestIndex,
      onAddPlot,
      plotConfig,
      sliderConfig,
      showToast,
      toNumericArray,
    ],
  );

  // Load persisted state when component mounts or plot config changes
  useEffect(() => {
    if (plotConfig?.id) {
      const plotState = getPlotState(plotConfig.id) as PlotPersistentState | undefined;
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
          onSwapAxesChange?.(plotState.axes_swapped);
        }
      } else {
        // No persisted state, but check if plotConfig has filter or slider settings
        if (plotConfig.filters_order && plotConfig.filters_order.length > 0) {
          // Convert backend filter config to UI filter format
          const filtersFromConfig = plotConfig.filters_order.map((filterName) => ({
            name: filterName,
            options: plotConfig.filters_opts?.[filterName] || {},
          })) as AppliedFilter[];

          console.log("Loaded filters from plot config:", filtersFromConfig);

          // Set the filters and trigger reapplication by clearing and resetting them
          setAppliedFilters([]);
          setTimeout(() => {
            setAppliedFilters(filtersFromConfig);
            if (plotConfig.id) {
              setPlotFilters(plotConfig.id, filtersFromConfig);
            }
          }, 100);
        }

        if (plotConfig.slider && Object.keys(plotConfig.slider).length > 0) {
          console.log("Loaded sliders from plot config:", plotConfig.slider);
          setSliderConfig(plotConfig.slider);
          lastAppliedSliders.current = { ...plotConfig.slider };
          if (plotConfig.id) {
            setPlotSliders(plotConfig.id, plotConfig.slider);
          }
        }
      }
    }
  }, [
    getPlotState,
    onSwapAxesChange,
    plotConfig?.filters_opts,
    plotConfig?.filters_order,
    plotConfig?.id,
    plotConfig?.slider,
    plotType,
    setPlotFilters,
    setPlotSliders,
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
    (originalPlotJson: PlotlyJSON, settings: PlotAppearanceSettings): PlotlyJSON => {
      // Shallow-clone the top level so trace metadata (colorscale, zmin, line…) and
      // layout properties can be updated without mutating the source object, and
      // without deep-cloning the large data arrays.
      const updatedPlotJson: PlotlyJSON = { ...originalPlotJson };

      // Apply to data traces
      if (originalPlotJson.data && originalPlotJson.data.length > 0) {
        updatedPlotJson.data = originalPlotJson.data.map((trace: any) => {
          const updatedTrace = { ...trace };

          // Apply heatmap settings
          if (trace.type === "heatmap" && settings.hmap) {
            // If trace is not using a shared coloraxis, set per-trace fallback
            updatedTrace.colorscale = getColorscaleData(settings.hmap.colorscale);
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
                  (ArrayBuffer.isView(zData[0]) && !(zData[0] instanceof DataView));

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
                updatedTrace.zmin = zMin + (range * settings.hmap.rangecolor[0]) / 100;
                updatedTrace.zmax = zMin + (range * settings.hmap.rangecolor[1]) / 100;
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
        const hasHeatmap = (updatedPlotJson.data || []).some((t: Data) => t.type === "heatmap");
        if (hasHeatmap && settings.hmap) {
          type LayoutWithColorAxis = {
            coloraxis?: {
              colorscale?: unknown;
              cmin?: number;
              cmax?: number;
              [k: string]: unknown;
            };
          };
          const layoutRef = updatedPlotJson.layout as Partial<Layout> & LayoutWithColorAxis;
          const existing = (layoutRef.coloraxis || {}) as NonNullable<
            LayoutWithColorAxis["coloraxis"]
          >;
          const newColoraxis: NonNullable<LayoutWithColorAxis["coloraxis"]> = {
            ...existing,
          };
          // Update scale - use the actual colorscale data array from JSON
          (newColoraxis as { colorscale?: unknown }).colorscale = getColorscaleData(
            settings.hmap.colorscale,
          );
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
                if (trace.type === "heatmap") {
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
                      (ArrayBuffer.isView(zData[0]) && !(zData[0] instanceof DataView));

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
                    } else if (Array.isArray(zData) || ArrayBuffer.isView(zData)) {
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
    const result = applyAppearanceSettings(basePlotJson, appearanceSettings);
    // console.log(`[PlotWrapper] Calculated new customizedPlotJsonMemo`);
    return result;
  }, [basePlotJson, appearanceSettings, applyAppearanceSettings]);

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
  const throttledUpdateConfig = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    return () => window.removeEventListener("plot-squarify", handler as EventListener);
  }, []);

  // Handle dataset changes by reapplying current filters/sliders with new dataset
  // This allows cycling through datasets while preserving filter/slider state

  // Helper function to compare filters and sliders to prevent unnecessary operations
  const filtersOrSlidersChanged = useCallback(
    (newFilters: AppliedFilter[], newSliders?: Record<string, SliderConfig>): boolean => {
      // Compare filters
      if (newFilters.length !== appliedFilters.length) {
        return true;
      }

      const filtersChanged = newFilters.some((newFilter, index) => {
        const currentFilter = appliedFilters[index];
        return (
          newFilter.name !== currentFilter?.name ||
          JSON.stringify(newFilter.options) !== JSON.stringify(currentFilter?.options)
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
        swapAxesOverride?: boolean;
      } | null,
    ) => {
      if (!updateRequest) return;

      const { filters, sliders, swapAxesOverride } = updateRequest;
      const shouldSwapAxes = plotType === "heatmap" && (swapAxesOverride ?? areAxesSwapped);

      // Always use local filter application to avoid plot reload and modal closure
      // This decouples filter application from plot refresh
      // let fallbackTimer: ReturnType<typeof setTimeout> | null = null;

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
          hasSliderValuesChanged || (isSliderChange && Object.keys(sliderConfig).length === 0);

        if (shouldUseSliderPath) {
          // Use new slider API for slider changes with filters
          try {
            if (!plotConfig) {
              throw new Error("Plot configuration not available for slider operation");
            }
            if (!activePlotRef) {
              throw new Error("Plot reference not available for transform operation");
            }

            console.log("[PlotWrapper] Starting slider API call");
            const result = await PlotAPI.transformPlot({
              plot_ref: activePlotRef,
              filters_order: filtersOrder,
              filters_opts: filtersOpts,
              slider: sliders || sliderConfig,
              swap_xy: shouldSwapAxes,
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
              console.log("[PlotWrapper] Clearing isApplyingFilters after successful operation");
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
            if (result.warnings && result.warnings.length > 0) {
              result.warnings.forEach((warn) => showToast(warn, "warning"));
            } else {
              showToast("Sliders applied successfully", "success");
            }
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
                  throw new Error("Plot configuration not available for slider operation");
                }
                if (!activePlotRef) {
                  throw new Error("Plot reference not available for transform operation");
                }

                const result = await PlotAPI.transformPlot({
                  plot_ref: activePlotRef,
                  filters_order: [],
                  filters_opts: {},
                  slider: sliders,
                  swap_xy: shouldSwapAxes,
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
                console.error("Error applying sliders after filter reset:", error);
                showToast("Failed to apply sliders after filter reset", "error");
                // Clear loading state on error
                setIsApplyingFilters(false);
              }
            } else {
              // No filters, no sliders. For swapped heatmaps, re-request backend data;
              // otherwise reset to the original local payload.
              if (shouldSwapAxes) {
                if (!activePlotRef) {
                  throw new Error("Plot reference not available for transform operation");
                }

                const result = await PlotAPI.transformPlot({
                  plot_ref: activePlotRef,
                  filters_order: [],
                  filters_opts: {},
                  slider: {},
                  swap_xy: true,
                });

                if (!result.plot_json.layout) {
                  result.plot_json.layout = {};
                }

                const swappedWithAppearance = applyAppearanceSettings(
                  result.plot_json,
                  appearanceSettings,
                );

                startTransition(() => {
                  flushSync(() => {
                    setAppliedFilters(filters);
                    setBasePlotJson(result.plot_json);
                    setCustomizedPlotJson(swappedWithAppearance);
                  });
                });

                setTimeout(() => {
                  setIsApplyingFilters(false);
                }, 100);
              } else {
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
                  setIsApplyingFilters(false);
                }, 100);
              }

              // Only show "Filters cleared" toast if we actually had filters before
              showToast("Filters cleared", "success");
            }

            // Delay backend config update
            setTimeout(() => {
              if (handleUpdateConfig) {
                handleUpdateConfig({
                  filters_order: [],
                  filters_opts: {},
                  slider: sliders && Object.keys(sliders).length > 0 ? sliders : {},
                });
              }
            }, 200);
          } else {
            // Filters but no sliders - use filter API
            if (!activePlotRef) {
              throw new Error("Plot reference not available for transform operation");
            }

            console.log("[PlotWrapper] Starting filter API call");
            const result = await PlotAPI.transformPlot({
              plot_ref: activePlotRef,
              filters_order: filtersOrder,
              filters_opts: filtersOpts,
              slider: {},
              swap_xy: shouldSwapAxes,
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

            if (result.warnings && result.warnings.length > 0) {
              result.warnings.forEach((warn) => showToast(warn, "warning"));
            }

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
          `Failed to apply filters: ${error instanceof Error ? error.message : "Unknown error"}`,
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
      areAxesSwapped,
    ],
  );

  // Simplified filter/slider handler with smart comparison to prevent unnecessary operations
  const handleFiltersApply = useCallback(
    async (filters: AppliedFilter[], sliders?: Record<string, SliderConfig>) => {
      // Prevent overlapping operations
      if (isApplyingFilters) {
        // console.log("[PlotWrapper] Operation already in progress, skipping");
        return;
      }

      // Smart comparison to prevent unnecessary operations when values haven't changed
      if (!filtersOrSlidersChanged(filters, sliders)) {
        console.log("[PlotWrapper] Filters/sliders unchanged, skipping operation");
        return;
      }

      console.log("[PlotWrapper] Filters/sliders changed, proceeding with operation");

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
          const shouldSwapAxes = isHeatmapPlot && areAxesSwapped;

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
                  throw new Error("Plot reference not available for transform operation");
                }

                // Use unified transform API to apply both filters and sliders
                const result = await PlotAPI.transformPlot({
                  plot_ref: nextPlotRef,
                  filters_order: filtersOrder,
                  filters_opts: filtersOpts,
                  slider: sliderConfig,
                  swap_xy: shouldSwapAxes,
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
                  throw new Error("Plot reference not available for transform operation");
                }

                // Use unified transform API for filters only
                const result = await PlotAPI.transformPlot({
                  plot_ref: nextPlotRef,
                  filters_order: filtersOrder,
                  filters_opts: filtersOpts,
                  slider: {},
                  swap_xy: shouldSwapAxes,
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
              // TODOLATER: Check if needed
              // Test Fallback: request a filtered/sliced plot directly from /plot/
              // so dataset cycling does not silently drop filters for refs
              // like sqlite#run_id=... when transform context is transient.
              try {
                const fallbackPlotResponse = await PlotAPI.createPlots({
                  fpaths: [newFpath],
                  indeps: plotConfig.indeps,
                  deps: plotConfig.deps,
                  plotType: plotConfig.plotType,
                  filters_order: filtersOrder,
                  filters_opts: filtersOpts,
                  slider: isSliderChange ? sliderConfig : {},
                });

                if (fallbackPlotResponse.success && fallbackPlotResponse.plots.length > 0) {
                  const fallbackPlot = fallbackPlotResponse.plots[0];
                  const fallbackPlotJson = fallbackPlot.plotJson as PlotlyJSON;
                  setBasePlotJson(fallbackPlotJson);
                  const fallbackWithAppearance = applyAppearanceSettings(
                    fallbackPlotJson,
                    appearanceSettings,
                  );
                  setCustomizedPlotJson(fallbackWithAppearance);
                } else {
                  throw new Error(
                    fallbackPlotResponse.message || "Fallback plot request returned no plots",
                  );
                }
              } catch (fallbackError) {
                console.error(
                  `[PlotWrapper] Fallback filtered plot request failed:`,
                  fallbackError,
                );
                // Last-resort fallback to unfiltered plot
                setBasePlotJson(newPlot.plotJson);
                const plotWithAppearance = applyAppearanceSettings(
                  newPlot.plotJson,
                  appearanceSettings,
                );
                setCustomizedPlotJson(plotWithAppearance);
              }
            }
          } else {
            // No filters/sliders to apply.
            // For swapped heatmaps, fetch swapped data from backend.
            if (shouldSwapAxes && nextPlotRef) {
              const result = await PlotAPI.transformPlot({
                plot_ref: nextPlotRef,
                filters_order: [],
                filters_opts: {},
                slider: {},
                swap_xy: true,
              });
              const swappedPlotJson = result.plot_json as PlotlyJSON;
              setBasePlotJson(swappedPlotJson);
              const plotWithAppearance = applyAppearanceSettings(
                swappedPlotJson,
                appearanceSettings,
              );
              setCustomizedPlotJson(plotWithAppearance);
            } else {
              setBasePlotJson(newPlot.plotJson);
              const plotWithAppearance = applyAppearanceSettings(
                newPlot.plotJson,
                appearanceSettings,
              );
              setCustomizedPlotJson(plotWithAppearance);
            }
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
            (response.message.includes("not found") || response.message.includes("KeyError"))
          ) {
            const missingVars = plotConfig ? [...plotConfig.indeps, ...plotConfig.deps] : [];
            setDatasetUpdateError(
              `Cannot update to new dataset: Variables [${missingVars.join(
                ", ",
              )}] not found in the selected dataset. Please select a dataset that contains these variables or create a new plot.`,
            );
          } else {
            setDatasetUpdateError(
              `Failed to update to new dataset: ${response.message || "Unknown error"}`,
            );
          }
        }
      } catch (error) {
        console.error(`[PlotWrapper] Error updating data source to ${newFpath}:`, error);

        // Provide user-friendly error message for variable compatibility issues
        let errorMessage = "Failed to update to new dataset";
        if (error instanceof Error) {
          if (error.message.includes("not found") || error.message.includes("KeyError")) {
            const missingVars = plotConfig ? [...plotConfig.indeps, ...plotConfig.deps] : [];
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
      isHeatmapPlot,
      areAxesSwapped,
    ],
  );

  // Watch for dataset changes and update data source without recreating the plot
  useEffect(() => {
    const currentFpath = plotConfig?.fpath;

    // Skip updates if filters are currently being applied to prevent race conditions
    if (isApplyingFilters) {
      console.log(`[PlotWrapper] Skipping dataset update while filters are being applied`);
      return;
    }

    // Only trigger updateDataSource if this is a dataset cycle (not initial plot creation)
    if (currentFpath && prevFpathRef.current && currentFpath !== prevFpathRef.current) {
      console.log(
        `[PlotWrapper] Dataset path changed from ${prevFpathRef.current} to ${currentFpath}`,
      );
      console.log(`[PlotWrapper] Updating data source to new dataset while preserving UI state`);

      // Update the data source by fetching fresh plot data from the new dataset
      // This preserves all UI state (filters, sliders, modals) while changing the underlying data
      updateDataSource(currentFpath);
    }

    // Always update the ref to track the current fpath
    prevFpathRef.current = currentFpath;
  }, [plotConfig?.fpath, updateDataSource, isApplyingFilters]);

  const handleMaximize = () => {
    setIsMaximized((prev) => {
      const next = !prev;
      // Leaving maximized mode should also leave LineCut so layout resets.
      if (!next) {
        setIsLineCutActive(false);
        setLineCutAxis(null);
        setLineCutPreviewJson(null);
        if (lineCutForcedWidthRef.current) {
          dispatchPlotWidthPreset(50);
          lineCutForcedWidthRef.current = false;
        }
      }
      return next;
    });
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

  useShortcut("escape", () => {
    if (isFiltersModalOpen) {
      handleFiltersModalClose();
    }
    if (isAppearanceModalOpen) {
      handleAppearanceSettingsClose();
    }
    if (isBGCorrActive) {
      setIsBGCorrActive(false);
      setBgCorrPoints([]);
    }
    if (isLineCutActive) {
      setIsLineCutActive(false);
      setLineCutAxis(null);
      setLineCutPreviewJson(null);
      if (lineCutForcedWidthRef.current) {
        dispatchPlotWidthPreset(50);
        lineCutForcedWidthRef.current = false;
      }
    }
    if (isMaximized) {
      handleMaximize();
    }
  });

  const enterLineCutMode = useCallback(() => {
    if (!isHeatmapPlot || isApplyingFilters) return;
    setIsLineCutActive(true);
    setLineCutAxis("x");
    setLineCutPreviewJson(null);

    if (!isMaximized) {
      setIsMaximized(true);
      dispatchPlotWidthPreset(100);
      lineCutForcedWidthRef.current = true;
    }

    showToast("LineCut active. Default mode: Vertical (X). Press X/Y to switch.", "info");
  }, [isHeatmapPlot, isApplyingFilters, isMaximized, dispatchPlotWidthPreset, showToast]);

  const toggleLineCutMode = useCallback(() => {
    if (isLineCutActive) {
      setIsLineCutActive(false);
      setLineCutAxis(null);
      setLineCutPreviewJson(null);
      return;
    }
    enterLineCutMode();
  }, [isLineCutActive, enterLineCutMode]);

  // Reset handler to clear all filters and appearance modifications
  const handleReset = async () => {
    try {
      setIsApplyingFilters(true);
      setAreAxesSwapped(false);
      onSwapAxesChange?.(false);

      // Reset state locally
      const defaultSettings = getInitialSettings(plotType);
      setAppearanceSettings(defaultSettings);
      setAppliedFilters([]);
      setSliderConfig({});
      lastAppliedSliders.current = {};

      // Increment plot key to force Plotly to reset internal state (relayout, etc.)
      setPlotKey((prev) => prev + 1);

      // Call backend to get a truly fresh plot
      if (plotConfig?.fpath) {
        const request = {
          fpaths: [plotConfig.fpath],
          indeps: plotConfig.indeps,
          deps: plotConfig.deps,
          plotType: plotConfig.plotType,
          filters_order: [],
          filters_opts: {},
          slider: {},
        };

        const response = await PlotAPI.createPlots(request);

        if (response.success && response.plots.length > 0) {
          const newPlot = response.plots[0];
          setActivePlotRef(newPlot.plot_ref || activePlotRef);
          setOriginalPlotJson(newPlot.plotJson);
          setBasePlotJson(newPlot.plotJson);

          const resetPlotJson = applyAppearanceSettings(newPlot.plotJson, defaultSettings);
          setCustomizedPlotJson(resetPlotJson);
          showToast("Plot successfully reset to original state", "success");
        } else {
          // Fallback to local reset if API fails
          setBasePlotJson(originalPlotJson);
          const resetPlotJson = applyAppearanceSettings(originalPlotJson, defaultSettings);
          setCustomizedPlotJson(resetPlotJson);
          showToast("Reset locally (backend refresh failed)", "warning");
        }
      }

      // Update backend configuration to clear filters and sliders
      if (handleUpdateConfig) {
        handleUpdateConfig({
          filters_order: [],
          filters_opts: {},
          slider: {},
        });
      }

      // Save to store if available
      if (plotConfig?.id) {
        setPlotAppearance(plotConfig.id, defaultSettings);
        setPlotFilters(plotConfig.id, []);
        setPlotSliders(plotConfig.id, {});
        setPlotAxesSwapped(plotConfig.id, false);
      }
    } catch (error) {
      console.error("[PlotWrapper] Error during reset:", error);
      showToast("Failed to fully reset plot", "error");
    } finally {
      setIsApplyingFilters(false);
    }
  };

  const handleSwapAxes = async () => {
    if (!isHeatmapPlot || isApplyingFilters) return;

    const newSwapped = !areAxesSwapped;
    setAreAxesSwapped(newSwapped);
    onSwapAxesChange?.(newSwapped);
    if (plotConfig?.id) {
      setPlotAxesSwapped(plotConfig.id, newSwapped);
    }

    await executeFiltersApply({
      filters: appliedFilters,
      sliders: sliderConfig,
      swapAxesOverride: newSwapped,
    });
  };

  const handleBGCorrToggle = () => {
    if (isBGCorrActive) {
      setIsBGCorrActive(false);
      setBgCorrPoints([]);
    } else {
      // Auto expand the plot for easier selection of points
      if (!isMaximized) {
        setIsMaximized(true);
      }

      setIsBGCorrActive(true);
      setBgCorrPoints([]);
      setBgCorrMode("constant");

      // Focus the plot container so user can immediately interact
      setTimeout(() => {
        plotContainerRef.current?.focus();
      }, 50);

      const msg = isHeatmapPlot
        ? "Heatmap BG Corr active. Pick mode and click plot. Plane mode is WIP."
        : "BG Corr active: Click points on the plot. 1 = Offset, 2 = Linear.";
      showToast(msg, "info");
    }
  };

  // Per-plot keyboard shortcut actions dispatched from Viewer.
  /* eslint-disable react-hooks/exhaustive-deps -- existing inline handler dependencies rebind this listener every render */
  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{
        id?: string;
        action?:
          | "enter-linecut"
          | "open-filters"
          | "open-appearance"
          | "toggle-maximize"
          | "toggle-bgcorr"
          | "swap-axes"
          | "reset-plot"
          | "send-to-notes"
          | "export-images";
      }>;

      if (!plotConfig?.id || ce.detail?.id !== plotConfig.id) {
        return;
      }

      const action = ce.detail?.action;
      if (action === "enter-linecut") {
        enterLineCutMode();
      } else if (action === "open-filters") {
        handleFiltersModalOpen();
      } else if (action === "open-appearance") {
        handleAppearanceSettingsOpen();
      } else if (action === "toggle-maximize") {
        handleMaximize();
      } else if (action === "toggle-bgcorr") {
        handleBGCorrToggle();
      } else if (action === "swap-axes") {
        handleSwapAxes();
      } else if (action === "reset-plot") {
        handleReset();
      } else if (action === "send-to-notes") {
        handleSendToNotes();
      } else if (action === "export-images") {
        handleSavePlotImages();
      }
    };

    window.addEventListener("plot-shortcut-action", handler as EventListener);
    return () => window.removeEventListener("plot-shortcut-action", handler as EventListener);
  }, [
    plotConfig?.id,
    enterLineCutMode,
    handleBGCorrToggle,
    handleSwapAxes,
    handleFiltersModalOpen,
    handleAppearanceSettingsOpen,
    handleMaximize,
  ]);
  /* eslint-enable react-hooks/exhaustive-deps */

  const applyBGCorrNow = useCallback(
    async (points: any[]) => {
      if (points.length === 0) return;

      let mode = bgCorrMode;
      // Force constant/linear for LinePlot; for heatmap row_mean/col_mean the
      // backend handles baseline computation — just pass mode + points through.
      if (!isHeatmapPlot) {
        mode = points.length === 1 ? "constant" : "linear";
      }

      const filterName = `bg_corr_${mode}`;

      const newFilter: AppliedFilter = {
        name: filterName,
        options: {
          points,
        },
      };

      const otherFilters = appliedFilters.filter((f) => f.name !== filterName);
      const nextFilters = [...otherFilters, newFilter];

      setAppliedFilters(nextFilters);
      await executeFiltersApply({
        filters: nextFilters,
        sliders: sliderConfig,
      });

      // Keep overlay active but clear markers to avoid squishing/autoscale issues.
      // setIsBGCorrActive(false);
      setBgCorrPoints([]);
    },
    [appliedFilters, executeFiltersApply, sliderConfig, bgCorrMode, isHeatmapPlot],
  );

  // Visual feedback for BG Corr points
  const plotWithBGMarkers = useMemo(() => {
    let basePlot = customizedPlotJson;

    // If 3D Mode is active for heatmap BG Corr, transform base plot to surface
    if (isBGCorrActive && isHeatmapPlot && is3DMode) {
      basePlot = {
        ...basePlot,
        data: basePlot.data.map((trace: any) => {
          if (trace.type === "heatmap") {
            return {
              ...trace,
              type: "surface",
              scene: "scene1",
            };
          }
          return trace;
        }),
        layout: {
          ...basePlot.layout,
          uirevision: "bg-corr", // Keep camera constant across point selection
          scene: (basePlot.layout as any).scene || {
            aspectmode: "cube",
            dragmode: "turntable",
            camera: {
              eye: { x: 1.5, y: 1.5, z: 1.5 },
            },
          },
        },
      };
    } else if (isBGCorrActive) {
      // Still set uirevision for 2D mode to preserve zoom
      basePlot = {
        ...basePlot,
        layout: {
          ...basePlot.layout,
          uirevision: "bg-corr",
        },
      };
    }

    if (bgCorrPoints.length === 0) return basePlot;

    const markerTrace: any = {
      x: bgCorrPoints.map((p) => p.x),
      y: bgCorrPoints.map((p) => p.y),
      z: bgCorrPoints.map((p) => p.z || 0),
      type: isHeatmapPlot && is3DMode ? "scatter3d" : "scatter",
      mode: "markers",
      marker: {
        color: bgCorrPoints.map((_, i) => (i === bgCorrPoints.length - 1 ? "red" : "#888")),
        size: isHeatmapPlot && is3DMode ? 10 : 10,
        symbol: isHeatmapPlot && is3DMode ? "circle" : "cross",
        line: { color: "white", width: 2 },
      },
      text: bgCorrPoints.map(
        (p, i) =>
          `Pt ${i + 1}: (${p.x.toFixed(2)}, ${p.y.toFixed(2)}${
            p.z !== undefined ? `, Z: ${p.z.toFixed(2)}` : ""
          })`,
      ),
      hoverinfo: "text",
      name: "BG Corr Points",
      showlegend: false,
    };

    if (isHeatmapPlot && is3DMode) {
      markerTrace.scene = "scene1";
      // Don't skip hover if we have text labels
      markerTrace.hoverinfo = "text";

      // Calculate a relative offset to lift markers slightly above the surface
      const zDataArr = (basePlot.data[0] as any)?.z;
      if (Array.isArray(zDataArr)) {
        const flatZ = zDataArr.flat().filter((v: any) => typeof v === "number");
        if (flatZ.length > 0) {
          const zMin = Math.min(...flatZ);
          const zMax = Math.max(...flatZ);
          const zRange = zMax - zMin;
          const offset = zRange * 0.02 || 0.1;
          markerTrace.z = markerTrace.z.map((val: number) => val + offset);
        }
      }
    }

    const traces = [...(basePlot.data || []), markerTrace];

    // Heatmap mode indicators: row/col dotted lines
    if (isHeatmapPlot && !is3DMode && bgCorrPoints.length === 1) {
      const p = bgCorrPoints[0];
      if (bgCorrMode === "row_mean" || bgCorrMode === "col_mean") {
        // Use a Plotly layout SHAPE instead of a scatter trace so that the
        // line does not affect autoscaling or require axis range locking.
        const lineShape: any =
          bgCorrMode === "row_mean"
            ? {
                type: "line",
                xref: "paper",
                yref: "y",
                x0: 0,
                x1: 1,
                y0: p.y,
                y1: p.y,
                line: { color: "white", width: 3, dash: "dot" },
              }
            : {
                type: "line",
                xref: "x",
                yref: "paper",
                x0: p.x,
                x1: p.x,
                y0: 0,
                y1: 1,
                line: { color: "white", width: 3, dash: "dot" },
              };

        return {
          ...basePlot,
          data: traces,
          layout: {
            ...basePlot.layout,
            shapes: [...((basePlot.layout as any)?.shapes ?? []), lineShape],
          },
        };
      }
    }

    // LinePlot linear mode: line between 2 points
    if (!isHeatmapPlot && bgCorrPoints.length === 2) {
      const lineTrace: any = {
        x: bgCorrPoints.map((p) => p.x),
        y: bgCorrPoints.map((p) => p.y),
        type: "scatter",
        mode: "lines",
        line: {
          color: "red",
          dash: "dash",
          width: 2,
        },
        name: "BG Corr Line",
        showlegend: false,
      };
      traces.push(lineTrace);
    }

    return {
      ...basePlot,
      data: traces,
    };
  }, [customizedPlotJson, bgCorrPoints, isBGCorrActive, isHeatmapPlot, is3DMode, bgCorrMode]);

  const plotWithLineCutGuide = useMemo(() => {
    const basePlot = isBGCorrActive ? plotWithBGMarkers : customizedPlotJson;

    if (!isLineCutActive || !isHeatmapPlot || !hoverData) {
      return basePlot;
    }

    const axisForGuide = lineCutAxis ?? lastLineCutAxisRef.current ?? "x";
    const normalizedGuideShapes =
      axisForGuide === "x"
        ? [
            {
              type: "line",
              xref: "x",
              yref: "paper",
              x0: hoverData.x,
              x1: hoverData.x,
              y0: 0,
              y1: 1,
              editable: false,
              line: { color: "#ffffff", width: 2.5 },
            },
            {
              type: "line",
              xref: "x",
              yref: "paper",
              x0: hoverData.x,
              x1: hoverData.x,
              y0: 0,
              y1: 1,
              editable: false,
              line: { color: "#ef4444", width: 1.5 },
            },
          ]
        : [
            {
              type: "line",
              xref: "paper",
              yref: "y",
              x0: 0,
              x1: 1,
              y0: hoverData.y,
              y1: hoverData.y,
              editable: false,
              line: { color: "#ffffff", width: 2.5 },
            },
            {
              type: "line",
              xref: "paper",
              yref: "y",
              x0: 0,
              x1: 1,
              y0: hoverData.y,
              y1: hoverData.y,
              editable: false,
              line: { color: "#ef4444", width: 1.5 },
            },
          ];

    return {
      ...basePlot,
      layout: {
        ...basePlot.layout,
        shapes: [...(((basePlot.layout as any)?.shapes as any[]) ?? []), ...normalizedGuideShapes],
      },
      // Prevent Plotly's shape-edit cursor/handles from stealing LineCut clicks.
      config: {
        ...(basePlot.config || {}),
        editable: false,
      },
    };
  }, [
    isBGCorrActive,
    plotWithBGMarkers,
    customizedPlotJson,
    isLineCutActive,
    isHeatmapPlot,
    hoverData,
    lineCutAxis,
  ]);

  const handlePlotClick = (event: Plotly.PlotMouseEvent) => {
    if (!isBGCorrActive) return;

    const point = event.points[0];

    // Ignore clicks on existing BG markers
    if (point.data.name === "BG Corr Points" || point.data.name === "BG Corr Line") {
      return;
    }

    const x = typeof point.x === "number" ? point.x : Number(point.x);
    const y = typeof point.y === "number" ? point.y : Number(point.y);
    const z = (point as any).z;
    // Plotly heatmap click events expose indices via pointIndex = [row, col].
    // The .row / .col properties do not exist on 2-D heatmap points.
    const rawPointIdx = (point as any).pointIndex;
    const rowIdx = Array.isArray(rawPointIdx) ? rawPointIdx[0] : (point as any).row;
    const colIdx = Array.isArray(rawPointIdx) ? rawPointIdx[1] : (point as any).col;

    if (isNaN(x) || isNaN(y)) {
      showToast("Invalid point data", "error");
      return;
    }

    const newPoint = {
      x,
      y,
      z: typeof z === "number" ? z : undefined,
      row_idx: typeof rowIdx === "number" ? rowIdx : undefined,
      col_idx: typeof colIdx === "number" ? colIdx : undefined,
    };

    if (isHeatmapPlot) {
      if (bgCorrMode === "plane") {
        // Plane needs 3 points, cycle through 3
        setBgCorrPoints((prev) => {
          if (prev.length >= 3) return [newPoint];
          return [...prev, newPoint];
        });
      } else {
        // Other heatmap modes (constant, row_mean, col_mean) only need 1 point
        setBgCorrPoints([newPoint]);
      }
    } else {
      // LinePlot: Cycle selection: 1st click -> Pt1, 2nd click -> Pt2, 3rd click -> Pt1 (reset)
      setBgCorrPoints((prev) => {
        if (prev.length >= 2) return [newPoint];
        return [...prev, newPoint];
      });
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
    showToast("Theme selected — hold Shift and click target plots to apply", "info");
  }, [activateTheme, plotConfig?.id, plotType, appearanceSettings, showToast]);

  const startFilterPaintFromThis = useCallback(() => {
    if (!plotConfig?.id) return;
    activateFilter(plotConfig.id, plotType, appliedFilters, sliderConfig);
    showToast("Filter selection made — hold Shift and click target plots to apply", "info");
  }, [activateFilter, plotConfig?.id, plotType, appliedFilters, sliderConfig, showToast]);

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
      const filters = usePainterStore.getState().sourceFilters as AppliedFilter[] | undefined;
      const sliders = usePainterStore.getState().sourceSliders as
        Record<string, SliderConfig> | undefined;
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
              {/* Swap X & Y Axes (heatmaps only) */}
              {isHeatmapPlot && (
                <Tooltip content="Swap X & Y Axes" position="bottom">
                  <button
                    onClick={handleSwapAxes}
                    className={`relative p-1.5 rounded transition-colors duration-150 ${
                      areAxesSwapped ? "bg-blue-100 text-blue-600" : "hover:bg-gray-200"
                    }`}
                    title="Swap X & Y Axes"
                    disabled={isApplyingFilters}
                  >
                    <ArrowLeftRight
                      size={16}
                      className={areAxesSwapped ? "text-blue-600" : "text-gray-600"}
                    />
                  </button>
                </Tooltip>
              )}

              {/* LineCut (Heatmaps only) */}
              {isHeatmapPlot && (
                <Tooltip content="LineCut" position="bottom">
                  <button
                    onClick={toggleLineCutMode}
                    className={`relative p-1.5 rounded transition-colors duration-150 ${
                      isLineCutActive
                        ? "bg-blue-100 text-blue-600 border border-blue-600"
                        : "hover:bg-gray-200"
                    }`}
                    title="Generate line slices (X/Y keys)"
                    disabled={isApplyingFilters}
                  >
                    <Split
                      size={16}
                      className={isLineCutActive ? "text-blue-600" : "text-gray-600"}
                    />
                  </button>
                </Tooltip>
              )}

              {/* Background Correction */}
              <Tooltip content="Background Correction" position="bottom">
                <button
                  onClick={handleBGCorrToggle}
                  className={`relative p-1.5 rounded transition-colors duration-150 ${
                    isBGCorrActive
                      ? "bg-blue-100 text-blue-600 border border-blue-600"
                      : "hover:bg-gray-200"
                  }`}
                  title="BG Correction (interactive)"
                  disabled={isApplyingFilters}
                >
                  <Crosshair
                    size={16}
                    className={isBGCorrActive ? "text-blue-600" : "text-gray-600"}
                  />
                </button>
              </Tooltip>

              <div className="w-px h-6 bg-gray-200 mx-1" />

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
            <div className="flex h-full w-full relative">
              <div
                className={`p-2 pb-0 h-full relative ${isSquareMode ? "square-mode" : ""}`}
                style={{
                  width: isLineCutActive ? "50%" : "100%",
                  transition: "width 0.3s ease-in-out",
                }}
              >
                <div
                  className="plot-status-badge absolute top-3 left-3 z-20 inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white/90 px-2.5 py-1 shadow-sm dark:bg-gray-800/90"
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
                  key={plotKey}
                  plotJson={plotWithLineCutGuide}
                  onRelayout={handleRelayout}
                  onHover={handlePlotHover}
                  onClick={
                    isLineCutActive
                      ? handleLineCutClick
                      : isBGCorrActive
                        ? handlePlotClick
                        : undefined
                  }
                />

                {/* BG Corr Controls Overlay (Maximized) */}

                {isBGCorrActive && (
                  <div className="absolute top-16 left-1/2 transform -translate-x-1/2 z-30 flex flex-col items-center gap-3 bg-white/95 dark:bg-gray-800/95 backdrop-blur-md border border-blue-200 px-6 py-4 rounded-[2rem] shadow-2xl animate-in fade-in slide-in-from-top-4 duration-300 min-w-[400px]">
                    <div className="flex items-center justify-between w-full mb-1">
                      <div className="flex items-center gap-2">
                        <div className="flex h-2.5 w-2.5 rounded-full bg-blue-500 animate-pulse" />
                        <span className="text-sm font-bold text-gray-800 uppercase tracking-tight">
                          Background Correction
                        </span>
                      </div>
                      <span className="text-xs font-semibold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full border border-blue-100">
                        {bgCorrPoints.length} {bgCorrPoints.length === 1 ? "point" : "points"}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 w-full">
                      {isHeatmapPlot ? (
                        <div className="flex items-center gap-1.5 p-1 bg-gray-100/80 dark:bg-gray-700/80 rounded-full w-full">
                          {[
                            {
                              id: "constant",
                              label: "Offset",
                              disabled: false,
                            },
                            {
                              id: "row_mean",
                              label: "Row",
                              disabled: false,
                            },
                            {
                              id: "col_mean",
                              label: "Col",
                              disabled: false,
                            },
                            { id: "plane", label: "Plane", disabled: false },
                          ].map((m) => (
                            <button
                              key={m.id}
                              onClick={() => {
                                if (m.disabled) return;
                                setBgCorrMode(m.id as any);
                                setBgCorrPoints([]);
                                setIs3DMode(false);
                              }}
                              disabled={m.disabled}
                              title={m.disabled ? "WIP" : m.label}
                              className={`flex-1 text-[10px] font-bold py-1.5 px-3 rounded-full transition-all ${
                                bgCorrMode === m.id
                                  ? "bg-white text-blue-700 shadow-sm border border-blue-100"
                                  : m.disabled
                                    ? "text-gray-400 cursor-not-allowed"
                                    : "text-gray-500 hover:text-gray-700"
                              }`}
                            >
                              <span className="inline-flex items-center gap-1 justify-center w-full">
                                {m.label}
                                {m.disabled && <span className="text-[9px]">WIP</span>}
                              </span>
                            </button>
                          ))}
                        </div>
                      ) : (
                        <div className="text-xs text-gray-500 px-2 italic">
                          Click 1 point for Offset, 2 points for Linear baseline
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-3 w-full mt-1">
                      <button
                        onClick={() => applyBGCorrNow(bgCorrPoints)}
                        disabled={
                          bgCorrPoints.length === 0 ||
                          (isHeatmapPlot && bgCorrMode === "plane" && bgCorrPoints.length < 3)
                        }
                        className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white text-xs font-bold py-2 rounded-full transition-all shadow-md active:scale-[0.98]"
                      >
                        Apply{" "}
                        {isHeatmapPlot
                          ? bgCorrMode.replace("_", " ")
                          : bgCorrPoints.length < 2
                            ? "constant"
                            : "linear"}
                      </button>
                      <button
                        onClick={() => setBgCorrPoints([])}
                        className="px-4 py-2 hover:bg-gray-100 text-gray-600 text-xs font-bold rounded-full transition-colors"
                      >
                        Clear
                      </button>
                      <button
                        onClick={() => {
                          setIsBGCorrActive(false);
                          setIs3DMode(false);
                          setBgCorrPoints([]);
                        }}
                        className="px-4 py-2 hover:bg-red-50 text-red-600 text-xs font-bold rounded-full transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {/* Dataset update error overlay */}
                {datasetUpdateError && (
                  <div className="absolute inset-0 flex items-center justify-center bg-white bg-opacity-90 rounded">
                    <div className="max-w-md p-6 text-center">
                      <div className="text-red-600 font-semibold text-lg mb-2">
                        Dataset Update Failed
                      </div>
                      <div className="text-gray-700 text-sm mb-4">{datasetUpdateError}</div>
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

              {/* LineCut Side Panel (Maximized) */}
              {isLineCutActive && (
                <div
                  className="h-full bg-white border-l border-gray-200 flex flex-col z-30 transition-all duration-300 animate-in slide-in-from-right"
                  style={{ width: "50%" }}
                >
                  <div className="flex items-center p-3 border-b border-gray-100 bg-gray-50/50 dark:bg-gray-900/50">
                    <div className="flex items-center gap-2">
                      <div className="p-1 px-2 bg-blue-100 text-blue-700 rounded-md text-[10px] font-black uppercase tracking-tighter">
                        LineCut Preview
                      </div>
                      <span className="text-[11px] font-bold text-gray-600 uppercase">
                        Mode: {resolvedLineCutAxis === "x" ? "Vertical" : "Horizontal"}
                      </span>
                      <span className="text-[10px] font-bold text-gray-500 uppercase ml-2 border-l border-gray-200 pl-2">
                        State:{" "}
                        {hoverData &&
                        typeof hoverData.x === "number" &&
                        typeof hoverData.y === "number"
                          ? `[${hoverData.x.toFixed(4)}, ${hoverData.y.toFixed(4)}]`
                          : "None"}
                      </span>
                    </div>
                  </div>

                  <div className="flex-1 p-2 relative">
                    {lineCutPreviewJson ? (
                      <PlotComponent plotJson={lineCutPreviewJson} />
                    ) : (
                      <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-6 space-y-3">
                        <div className="p-4 bg-blue-50 rounded-full animate-pulse">
                          <Scissors size={24} className="text-blue-400" />
                        </div>
                        <div>
                          <p className="text-xs font-bold text-gray-600">Ready for LineCut</p>
                          <p className="text-[10px] text-gray-400 mt-1 max-w-[150px]">
                            Press{" "}
                            <kbd className="font-sans border px-1 rounded bg-white shadow-sm">
                              Y
                            </kbd>{" "}
                            for Vertical mode or{" "}
                            <kbd className="font-sans border px-1 rounded bg-white shadow-sm">
                              X
                            </kbd>{" "}
                            for Horizontal mode.
                          </p>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="p-3 border-t border-gray-100 bg-white">
                    <div className="text-[12px] text-gray-400 font-medium mb-2 flex items-center gap-1">
                      <div className="w-1 h-1 rounded-full bg-blue-400"></div>
                      Click Heatmap to create persistent LinePlot
                    </div>
                    <button
                      onClick={() => setIsLineCutActive(false)}
                      className="w-full py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-[10px] font-bold rounded-lg transition-colors active:scale-[0.98]"
                    >
                      Exit LineCut Mode
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
        ref={plotContainerRef}
        className="relative w-full h-full bg-white rounded-lg shadow-md border border-gray-200 overflow-hidden outline-none focus:ring-2 focus:ring-blue-400/50"
        onMouseEnter={() => setIsHoveredOrFocused(true)}
        onMouseLeave={() => setIsHoveredOrFocused(false)}
        onFocus={() => setIsHoveredOrFocused(true)}
        onBlur={() => setIsHoveredOrFocused(false)}
        tabIndex={0}
        onClick={() => handlePaintTargetClick()}
      >
        {/* Plot content */}
        <div className="plot-content">
          <div className={`p-2 pb-0 relative ${isSquareMode ? "square-mode" : ""}`}>
            <div
              className="plot-status-badge absolute top-3 left-3 z-20 inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white/90 px-2.5 py-1 shadow-sm dark:bg-gray-800/90"
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
              key={plotKey}
              plotJson={isBGCorrActive ? plotWithBGMarkers : customizedPlotJson}
              onRelayout={handleRelayout}
              onHover={handlePlotHover}
              onClick={
                isLineCutActive ? handleLineCutClick : isBGCorrActive ? handlePlotClick : undefined
              }
            />

            {/* BG Corr Controls Overlay */}

            {isBGCorrActive && (
              <div className="absolute top-12 left-1/2 transform -translate-x-1/2 z-30 flex items-center gap-2 bg-white/95 dark:bg-gray-800/95 backdrop-blur-md border border-blue-200 px-3 py-2 rounded-full shadow-xl animate-in fade-in slide-in-from-top-2 duration-300">
                <span className="text-[10px] font-bold text-blue-600 px-1 uppercase tracking-wider">
                  {bgCorrPoints.length === 0
                    ? "Pick Points"
                    : `${bgCorrPoints.length} Pt${bgCorrPoints.length > 1 ? "s" : ""}`}
                </span>

                <div className="flex items-center gap-1">
                  <button
                    onClick={() => applyBGCorrNow(bgCorrPoints)}
                    disabled={bgCorrPoints.length === 0}
                    className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white text-[10px] font-bold px-2.5 py-1 rounded-full transition-all active:scale-95"
                  >
                    Apply
                  </button>
                  <button
                    onClick={() => setIsBGCorrActive(false)}
                    className="hover:bg-red-50 text-red-600 text-[10px] font-bold px-2 py-1 rounded-full transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Dataset update error overlay */}
            {datasetUpdateError && (
              <div className="absolute inset-0 flex items-center justify-center bg-white bg-opacity-90 rounded">
                <div className="max-w-md p-6 text-center">
                  <div className="text-red-600 font-semibold text-lg mb-2">
                    Dataset Update Failed
                  </div>
                  <div className="text-gray-700 text-sm mb-4">{datasetUpdateError}</div>
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

              {/* Pin: hold this plot on its current measurement while
                  Next/Prev repoints the others. */}
              {onTogglePinned && (
                <Tooltip
                  content={
                    plotConfig?.pinned
                      ? "Unpin - follow Next/Prev again"
                      : "Pin to this measurement (Next/Prev won't change it)"
                  }
                  position="left"
                >
                  <button
                    onClick={() => onTogglePinned(!plotConfig?.pinned)}
                    className={`p-1.5 rounded transition-colors ${
                      plotConfig?.pinned ? "bg-amber-100 hover:bg-amber-200" : "hover:bg-gray-300"
                    }`}
                    title={plotConfig?.pinned ? "Unpin" : "Pin to measurement"}
                    aria-pressed={Boolean(plotConfig?.pinned)}
                  >
                    {plotConfig?.pinned ? (
                      <Pin size={16} className="text-amber-600 fill-amber-500" />
                    ) : (
                      <PinOff size={16} className="text-gray-500" />
                    )}
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
                content={shiftHeld && hoverAppearanceBtn ? "Paint Appearance" : "Edit Appearance"}
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
                  title={shiftHeld && hoverAppearanceBtn ? "Paint Appearance" : "Edit Appearance"}
                >
                  <Palette
                    size={16}
                    className={`text-${shiftHeld && hoverAppearanceBtn ? "blue-600" : "gray-600"}`}
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
                    : appliedFilters.length > 0
                      ? // Names only, in the order they are applied -- the full
                        // filter strings live in the modal.
                        `Filters: ${appliedFilters.map((f) => f.name).join(" → ")}`
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
                      : appliedFilters.length > 0
                        ? `Filters: ${appliedFilters.map((f) => f.name).join(" → ")}`
                        : "Apply Filters & Sliders"
                  }
                  disabled={isApplyingFilters}
                >
                  <Filter
                    size={16}
                    className={`text-${shiftHeld && hoverFiltersBtn ? "blue-600" : "gray-600"}`}
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

              {/* Swap X & Y Axes (heatmaps only) */}
              {isHeatmapPlot && (
                <Tooltip content="Swap X & Y Axes" position="left">
                  <button
                    onClick={handleSwapAxes}
                    className={`relative p-1.5 rounded transition-colors duration-150 ${
                      areAxesSwapped ? "bg-blue-100 text-blue-600" : "hover:bg-gray-200"
                    }`}
                    title="Swap X & Y Axes"
                    disabled={isApplyingFilters}
                  >
                    <ArrowLeftRight
                      size={16}
                      className={areAxesSwapped ? "text-blue-600" : "text-gray-600"}
                    />
                  </button>
                </Tooltip>
              )}

              {/* LineCut (Heatmaps only) */}
              {isHeatmapPlot && (
                <Tooltip content="LineCut Tool" position="left">
                  <button
                    onClick={toggleLineCutMode}
                    className={`relative p-1.5 rounded transition-colors duration-150 ${
                      isLineCutActive
                        ? "bg-blue-100 text-blue-600 border border-blue-600"
                        : "hover:bg-gray-200"
                    }`}
                    title="Generate line slices (X/Y keys)"
                    disabled={isApplyingFilters}
                  >
                    <Split
                      size={16}
                      className={isLineCutActive ? "text-blue-600" : "text-gray-600"}
                    />
                    {isLineCutActive && (
                      <span className="absolute -top-1 -right-1 flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
                      </span>
                    )}
                  </button>
                </Tooltip>
              )}

              {/* Background Correction (LinePlots and Heatmaps) */}
              <Tooltip content="Background Correction" position="left">
                <button
                  onClick={handleBGCorrToggle}
                  className={`relative p-1.5 rounded transition-colors duration-150 ${
                    isBGCorrActive
                      ? "bg-blue-100 text-blue-600 border border-blue-600"
                      : "hover:bg-gray-200"
                  }`}
                  title="BG Correction (interactive)"
                  disabled={isApplyingFilters}
                >
                  <Crosshair
                    size={16}
                    className={isBGCorrActive ? "text-blue-600" : "text-gray-600"}
                  />
                  {isBGCorrActive && (
                    <span className="absolute -top-1 -right-1 flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
                    </span>
                  )}
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
        plotJson={basePlotJson}
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
        onRequestBGCorr={(mode) => {
          handleFiltersModalClose();
          setIsBGCorrActive(true);
          setBgCorrPoints([]);
          setBgCorrMode(mode as any);
          setIs3DMode(false);
          // Focus the plot container so user can immediately interact
          setTimeout(() => {
            plotContainerRef.current?.focus();
          }, 50);

          if (!isMaximized) setIsMaximized(true);

          const msg = isHeatmapPlot
            ? `Heatmap BG Corr active (${mode}). Click plot to select points.`
            : `BG Corr active (${mode}): Click points on the plot.`;
          showToast(msg, "info");
        }}
      />
    </>
  );
};

export default PlotWrapper;

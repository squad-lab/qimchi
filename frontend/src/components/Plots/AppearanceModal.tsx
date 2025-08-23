import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  X,
  RotateCcw,
  // Undo,
  // Redo,
  Download,
  Upload,
  Minus,
  Circle,
  TrendingUp,
  Square,
  Diamond,
  Plus,
  Triangle,
  RedoDot,
  UndoDot,
  ChartLine,
  ChartSpline,
  ChartNoAxesCombined,
  Hourglass,
  Info,
} from "lucide-react";
import { Rnd } from "react-rnd";

// Local imports
import { useToast } from "../../hooks/useToast";
import type { PlotAppearanceSettings } from "../../components/types";
import {
  formatTitleWithUUID,
  getPlotTypeIcon,
  IconDropdown,
  LogChartIcon,
} from "./UtilComponents";
import Tooltip from "../Tooltip";

interface AppearanceModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: PlotAppearanceSettings;
  onChange: (settings: PlotAppearanceSettings) => void;
  plotType?: string;
  plotTitle?: string;
}

// Options based on the Python backend
const LINE_MODE_OPTS = [
  { label: "Lines", value: "lines", icon: Minus },
  { label: "Markers", value: "markers", icon: Circle },
  { label: "Lines + Markers", value: "lines+markers", icon: TrendingUp },
];

const LINE_COLOR_OPTS = [
  "#6acc64",
  "#4878d0",
  "#ee854a",
  "#d65f5f",
  "#956cb4",
  "#8c613c",
  "#dc7ec0",
  "#797979",
  "#d5bb67",
  "#82c6e2",
];

const LINE_DASH_OPTS = [
  { label: "Solid", value: "solid", icon: "━━━━" },
  { label: "Dash", value: "dash", icon: "━ ━" },
  { label: "Dot", value: "dot", icon: "• • •" },
  { label: "Long Dash", value: "longdash", icon: "━━ ━━" },
  { label: "Dash Dot", value: "dashdot", icon: "━ • ━" },
  { label: "Long Dash Dot", value: "longdashdot", icon: "━━ • ━━" },
];

const LINE_SHAPE_OPTS = [
  { label: "Linear", value: "linear", icon: ChartLine },
  { label: "Spline", value: "spline", icon: ChartSpline },
  { label: "Step", value: "hv", icon: ChartNoAxesCombined },
  { label: "Step Before", value: "hvh", icon: UndoDot },
  { label: "Step After", value: "vhv", icon: RedoDot },
];

// Custom Icons/Symbols for markers
const TriangleDown = () => (
  <Triangle
    size={14}
    className="text-gray-500 min-w-[14px]"
    style={{ transform: "rotate(180deg)" }}
  />
);

const TriangleLeft = () => (
  <Triangle
    size={14}
    className="text-gray-500 min-w-[14px]"
    style={{ transform: "rotate(90deg)" }}
  />
);

const TriangleRight = () => (
  <Triangle
    size={14}
    className="text-gray-500 min-w-[14px]"
    style={{ transform: "rotate(-90deg)" }}
  />
);

const DiamondFilled = () => (
  <Diamond
    size={14}
    className="text-gray-500 min-w-[14px] fill-current"
    style={{ transform: "scaleX(0.6)" }}
  />
);

const DiamondTallOpen = () => (
  <Diamond
    size={14}
    className="text-gray-500 min-w-[14px]"
    style={{ transform: "scaleX(0.6)" }}
  />
);

const DiamondFilledWide = () => (
  <Diamond
    size={14}
    className="text-gray-500 min-w-[14px] fill-current"
    style={{ transform: "scaleY(0.6)" }}
  />
);

const DiamondWideOpen = () => (
  <Diamond
    size={14}
    className="text-gray-500 min-w-[14px]"
    style={{ transform: "scaleY(0.6)" }}
  />
);

const HourglassFilled = () => (
  <Hourglass size={14} className="text-gray-500 min-w-[14px] fill-current" />
);

const MARKER_SYMBOL_OPTS = [
  { label: "Circle", value: "circle", icon: Circle },
  { label: "Square", value: "square", icon: Square },
  { label: "Cross", value: "cross", icon: Plus },
  { label: "X", value: "x", icon: X },
  { label: "Triangle-Up", value: "triangle-up", icon: Triangle },
  { label: "Triangle-Down", value: "triangle-down", icon: TriangleDown },
  { label: "Triangle-Left", value: "triangle-left", icon: TriangleLeft },
  { label: "Triangle-Right", value: "triangle-right", icon: TriangleRight },
  { label: "Diamond", value: "diamond", icon: Diamond },
  { label: "Diamond-Tall", value: "diamond-tall", icon: DiamondFilled },
  {
    label: "Diamond-Tall-Open",
    value: "diamond-tall-open",
    icon: DiamondTallOpen,
  },
  { label: "Diamond-Wide", value: "diamond-wide", icon: DiamondFilledWide },
  {
    label: "Diamond-Wide-Open",
    value: "diamond-wide-open",
    icon: DiamondWideOpen,
  },
  { label: "Hourglass", value: "hourglass", icon: HourglassFilled },
  { label: "Hourglass-Open", value: "hourglass-open", icon: Hourglass },
];

const AXIS_TYPE_OPTS = [
  { label: "Linear", value: "linear", icon: ChartLine },
  { label: "Log", value: "log", icon: LogChartIcon },
];

const GRID_DASH_OPTS = [
  { label: "Solid", value: "solid", icon: "━━━━" },
  { label: "Dash", value: "dash", icon: "━ ━" },
  { label: "Dot", value: "dot", icon: "• • •" },
  { label: "Long Dash", value: "longdash", icon: "━━ ━━" },
  { label: "Dash Dot", value: "dashdot", icon: "━ • ━" },
  { label: "Long Dash Dot", value: "longdashdot", icon: "━━ • ━━" },
];

// Plotly colorscales for heatmaps
const COLORSCALE_OPTS = [
  { label: "Viridis", value: "viridis" },
  { label: "Plasma", value: "plasma" },
  { label: "Inferno", value: "inferno" },
  { label: "Magma", value: "magma" },
  { label: "Cividis", value: "cividis" },
  { label: "Blues", value: "blues" },
  { label: "Greens", value: "greens" },
  { label: "Greys", value: "greys" },
  { label: "Oranges", value: "oranges" },
  { label: "Purples", value: "purples" },
  { label: "Reds", value: "reds" },
  { label: "YlOrRd", value: "ylorrd" },
  { label: "YlOrBr", value: "ylorbr" },
  { label: "YlGnBu", value: "ylgnbu" },
  { label: "YlGn", value: "ylgn" },
  { label: "Burg", value: "burg" },
  { label: "BuGn", value: "bugn" },
  { label: "BuPu", value: "bupu" },
  { label: "GnBu", value: "gnbu" },
  { label: "OrRd", value: "orrd" },
  { label: "PuBuGn", value: "pubugn" },
  { label: "PuBu", value: "pubu" },
  { label: "PuRd", value: "purd" },
  { label: "RdPu", value: "rdpu" },
  { label: "Spectral", value: "spectral" },
  { label: "Coolwarm", value: "coolwarm" },
  { label: "Balance", value: "balance" },
  { label: "RdYlBu", value: "rdylbu" },
  { label: "RdYlGn", value: "rdylgn" },
  { label: "RdBu", value: "rdbu" },
  { label: "PiYG", value: "piyg" },
  { label: "PRGn", value: "prgn" },
  { label: "BrBG", value: "brbg" },
  { label: "PuOr", value: "puor" },
  { label: "RdGy", value: "rdgy" },
  { label: "Turbo", value: "turbo" },
  { label: "Hot", value: "hot" },
  { label: "Jet", value: "jet" },
  { label: "Rainbow", value: "rainbow" },
  { label: "Sinebow", value: "sinebow" },
];

// Default settings based on Python backend
const DEFAULT_SETTINGS: PlotAppearanceSettings = {
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

// Simple global z-index manager so modals can stack above each other.
// Stores a counter on window to persist across components.
const getNextGlobalModalZ = (): number => {
  if (typeof window === "undefined") return 1000;
  const w = window as unknown as { __qimchi_modal_z?: number };
  if (!w.__qimchi_modal_z) w.__qimchi_modal_z = 1000;
  w.__qimchi_modal_z = (w.__qimchi_modal_z || 1000) + 1;
  return w.__qimchi_modal_z;
};

const AppearanceModal: React.FC<AppearanceModalProps> = ({
  isOpen,
  onClose,
  settings,
  onChange,
  plotType = "line",
  plotTitle,
}) => {
  const [localSettings, setLocalSettings] =
    useState<PlotAppearanceSettings>(settings);
  const [activeTab, setActiveTab] = useState<
    "style" | "x-axis" | "y-axis" | "heatmap"
  >(plotType === "heatmap" ? "heatmap" : "style");
  // const [history, setHistory] = useState<PlotAppearanceSettings[]>([settings]);
  // const [historyIndex, setHistoryIndex] = useState(0);
  // const [isUndoRedoAction, setIsUndoRedoAction] = useState(false);

  // Debounce ref to prevent flickering when updating appearance settings
  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    setLocalSettings(settings);
    // setHistory([settings]);
    // setHistoryIndex(0);
    // setIsUndoRedoAction(false); // Reset undo/redo flag when settings change externally
  }, [settings]);

  // Only reset active tab when plot type changes
  useEffect(() => {
    setActiveTab(plotType === "heatmap" ? "heatmap" : "style");
  }, [plotType]);

  // Cleanup debounce timeout on unmount
  useEffect(() => {
    return () => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
    };
  }, []);

  // Debounced onChange to prevent flickering during rapid setting changes
  const debouncedOnChange = useCallback(
    (newSettings: PlotAppearanceSettings) => {
      // Clear existing timeout
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }

      // Set new timeout with shorter delay for more responsive UI
      debounceTimeoutRef.current = setTimeout(() => {
        onChange(newSettings);
      }, 50); // Reduced from 150ms to 50ms for more responsive appearance updates
    },
    [onChange]
  );

  // Simple direct history update
  // const addToHistory = useCallback(
  //   (newSettings: PlotAppearanceSettings) => {
  //     // Only add if not an undo/redo action and settings are different
  //     if (!isUndoRedoAction) {
  //       setHistory((currentHistory) => {
  //         const currentSettings = currentHistory[historyIndex];
  //         if (JSON.stringify(newSettings) !== JSON.stringify(currentSettings)) {
  //           // Add immediately to history
  //           const newHistory = currentHistory.slice(0, historyIndex + 1);
  //           newHistory.push(newSettings);
  //           setHistoryIndex(newHistory.length - 1);
  //           return newHistory;
  //         }
  //         return currentHistory; // No change
  //       });
  //     }
  //   },
  //   [isUndoRedoAction, historyIndex]
  // );

  // Helper function to determine which tab to navigate to based on settings differences
  // const getRelevantTab = (
  //   oldSettings: PlotAppearanceSettings,
  //   newSettings: PlotAppearanceSettings
  // ): "line" | "marker" | "axes" | "heatmap" => {
  //   // For heatmap plots, prioritize heatmap settings
  //   if (plotType === "heatmap") {
  //     if (JSON.stringify(oldSettings.hmap) !== JSON.stringify(newSettings.hmap)) {
  //       return "heatmap";
  //     }
  //     if (
  //       JSON.stringify(oldSettings.x) !== JSON.stringify(newSettings.x) ||
  //       JSON.stringify(oldSettings.y) !== JSON.stringify(newSettings.y)
  //     ) {
  //       return "axes";
  //     }
  //     return "heatmap";
  //   }

  //   // For line plots, check in order of priority
  //   if (JSON.stringify(oldSettings.line) !== JSON.stringify(newSettings.line)) {
  //     return "line";
  //   }
  //   if (JSON.stringify(oldSettings.marker) !== JSON.stringify(newSettings.marker)) {
  //     return "marker";
  //   }
  //   if (
  //     JSON.stringify(oldSettings.x) !== JSON.stringify(newSettings.x) ||
  //     JSON.stringify(oldSettings.y) !== JSON.stringify(newSettings.y)
  //   ) {
  //     return "axes";
  //   }

  //   // Default to current active tab if no differences found
  //   return activeTab;
  // };

  const handleReset = () => {
    const newSettings = { ...DEFAULT_SETTINGS };
    updateSettingsWithHistory(newSettings);
  };

  // const handleUndo = () => {
  //   if (historyIndex > 0) {
  //     setIsUndoRedoAction(true);
  //     const newIndex = historyIndex - 1;
  //     const previousSettings = history[newIndex];
  //     const currentSettings = history[historyIndex];

  //     // Navigate to relevant tab based on what changed
  //     const relevantTab = getRelevantTab(currentSettings, previousSettings);
  //     setActiveTab(relevantTab);

  //     setHistoryIndex(newIndex);
  //     setLocalSettings(previousSettings);
  //     onChange(previousSettings);

  //     // Reset the flag after a brief delay to allow the onChange to complete
  //     setTimeout(() => setIsUndoRedoAction(false), 50);
  //   }
  // };

  // const handleRedo = () => {
  //   if (historyIndex < history.length - 1) {
  //     setIsUndoRedoAction(true);
  //     const newIndex = historyIndex + 1;
  //     const nextSettings = history[newIndex];
  //     const currentSettings = history[historyIndex];

  //     // Navigate to relevant tab based on what changed
  //     const relevantTab = getRelevantTab(currentSettings, nextSettings);
  //     setActiveTab(relevantTab);

  //     setHistoryIndex(newIndex);
  //     setLocalSettings(nextSettings);
  //     onChange(nextSettings);

  //     // Reset the flag after a brief delay to allow the onChange to complete
  //     setTimeout(() => setIsUndoRedoAction(false), 50);
  //   }
  // };

  const handleExport = () => {
    const exportData = {
      plotType,
      plotTitle: plotTitle || "Plot", // Add full title to export
      settings: localSettings,
      timestamp: new Date().toISOString(),
    };

    const dataStr = JSON.stringify(exportData, null, 2);
    const dataUri =
      "data:application/json;charset=utf-8," + encodeURIComponent(dataStr);

    // Use full title or UUID for filename
    const sanitizeFilename = (str: string) =>
      str.replace(/[^a-z0-9-_]/gi, "_").substring(0, 50);

    const titleForFilename = plotTitle ? sanitizeFilename(plotTitle) : "plot";
    const exportFileDefaultName = `${
      new Date().toISOString().split("T")[0]
    }-${plotType}-${titleForFilename}-theme.json`;

    const linkElement = document.createElement("a");
    linkElement.setAttribute("href", dataUri);
    linkElement.setAttribute("download", exportFileDefaultName);
    linkElement.click();
  };

  const { showToast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  // z-index state for stacking multiple open modals
  const [zIndexLocal, setZIndexLocal] = useState<number | undefined>(undefined);
  const zRef = useRef<number | undefined>(undefined);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      const next = getNextGlobalModalZ();
      zRef.current = next;
      setZIndexLocal(next);
    }
  }, [isOpen]);

  // Apply z-index to the DOM node via ref to avoid inline JSX styles (linter rule)
  useEffect(() => {
    if (wrapperRef.current && zIndexLocal !== undefined) {
      wrapperRef.current.style.zIndex = String(zIndexLocal);
    }
  }, [zIndexLocal]);

  const bringToFront = () => {
    const next = getNextGlobalModalZ();
    zRef.current = next;
    setZIndexLocal(next);
  };

  const mergeWithDefaults = (
    imported: Partial<PlotAppearanceSettings>
  ): PlotAppearanceSettings => {
    return {
      hmap: {
        colorscale:
          imported.hmap?.colorscale || DEFAULT_SETTINGS.hmap!.colorscale,
        rangecolor:
          imported.hmap?.rangecolor !== undefined
            ? imported.hmap.rangecolor
            : DEFAULT_SETTINGS.hmap!.rangecolor,
      },
      line: {
        ...DEFAULT_SETTINGS.line,
        ...imported.line,
      },
      marker: {
        ...DEFAULT_SETTINGS.marker,
        ...imported.marker,
      },
      x: {
        maj: {
          ...DEFAULT_SETTINGS.x.maj,
          ...imported.x?.maj,
        },
        min: {
          ...DEFAULT_SETTINGS.x.min,
          ...imported.x?.min,
        },
      },
      y: {
        maj: {
          ...DEFAULT_SETTINGS.y.maj,
          ...imported.y?.maj,
        },
        min: {
          ...DEFAULT_SETTINGS.y.min,
          ...imported.y?.min,
        },
      },
    };
  };

  const handleImportFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        const importedData = JSON.parse(content);

        if (!importedData.settings) {
          showToast("Invalid theme file: missing settings", "error");
          return;
        }

        const mergedSettings = mergeWithDefaults(importedData.settings);
        updateSettingsWithHistory(mergedSettings);

        const sourcePlot = importedData.plotTitle
          ? ` from "${importedData.plotTitle}"`
          : "";
        showToast(`Theme imported successfully${sourcePlot}`, "success");
      } catch (error) {
        console.error("Error importing theme:", error);
        showToast(
          "Error parsing theme file. Please check the file format.",
          "error"
        );
      }
    };
    reader.readAsText(file);
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type === "application/json") {
      handleImportFile(file);
    } else if (file) {
      showToast("Please select a JSON file", "error");
    }
    // Reset the input so the same file can be selected again
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files);
    const jsonFile = files.find(
      (file) => file.type === "application/json" || file.name.endsWith(".json")
    );

    if (jsonFile) {
      handleImportFile(jsonFile);
    } else {
      showToast("Please drop a JSON theme file", "error");
    }
  };

  const updateSettingsWithHistory = (newSettings: PlotAppearanceSettings) => {
    setLocalSettings(newSettings);
    onChange(newSettings);

    // Add to history immediately (not debounced like regular updates)
    // const newHistory = history.slice(0, historyIndex + 1);
    // newHistory.push(newSettings);
    // setHistory(newHistory);
    // setHistoryIndex(newHistory.length - 1);
  };

  const updateSetting = (path: string[], value: unknown) => {
    setLocalSettings((prev) => {
      const newSettings = { ...prev };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let current: any = newSettings;

      for (let i = 0; i < path.length - 1; i++) {
        // Ensure the property exists before trying to spread it
        if (!current[path[i]]) {
          current[path[i]] = {};
        } else {
          current[path[i]] = { ...current[path[i]] };
        }
        current = current[path[i]];
      }

      current[path[path.length - 1]] = value;

      // Apply changes with debouncing to prevent flickering
      debouncedOnChange(newSettings);

      // Add to history with debouncing
      // addToHistory(newSettings);

      return newSettings;
    });
  };

  if (!isOpen) return null;

  return (
    <div ref={wrapperRef} className="fixed inset-0 pointer-events-none">
      <Rnd
        default={{
          // Bottom left
          x: 22,
          y: window.innerHeight - 578,
          width: 384,
          height: 550,
        }}
        enableResizing={false}
        dragHandleClassName="drag-handle"
        bounds="parent"
        style={{ pointerEvents: "auto" }}
        onMouseDown={() => bringToFront()}
        onPointerDown={() => bringToFront()}
      >
        <div
          className={`bg-gray-100 rounded-lg shadow-2xl border-2 w-full h-full overflow-hidden flex flex-col transition-colors ${
            isDragging ? "border-blue-500 bg-blue-50" : "border-gray-300"
          }`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onMouseDown={(e) => {
            // Prevent parent pointer layer from stealing focus
            e.stopPropagation();
            bringToFront();
          }}
        >
          {/* Header */}
          <div className="flex items-center justify-between p-2 bg-gray-200 border-b-2 border-gray-300 drag-handle cursor-move flex-shrink-0">
            <div className="flex items-center gap-2">
              {getPlotTypeIcon(plotType)}
              <h2 className="text-base font-semibold text-gray-800">
                {formatTitleWithUUID(plotTitle || "Plot")}
              </h2>
            </div>
            <div className="flex items-center gap-1">
              {/* Debug info (temporary) */}
              {/* <span className="text-xs text-gray-500 mr-2">
                {historyIndex + 1}/{history.length}
              </span>
              <button
                onClick={handleUndo}
                disabled={historyIndex === 0}
                className="p-1.5 rounded hover:bg-gray-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title={`Undo${historyIndex === 0 ? ' (no history)' : ''}`}
                aria-label="Undo"
              >
                <Undo size={16} />
              </button>
              <button
                onClick={handleRedo}
                disabled={historyIndex === history.length - 1}
                className="p-1.5 rounded hover:bg-gray-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title={`Redo${historyIndex === history.length - 1 ? ' (no future)' : ''}`}
                aria-label="Redo"
              >
                <Redo size={16} />
              </button> */}
              <Tooltip content="Reset to defaults">
                <button
                  onClick={handleReset}
                  className="p-1.5 rounded hover:bg-gray-300 transition-colors"
                  aria-label="Reset to defaults"
                >
                  <RotateCcw size={16} />
                </button>
              </Tooltip>
              <Tooltip content="Export theme">
                <button
                  onClick={handleExport}
                  className="p-1.5 rounded hover:bg-gray-300 transition-colors"
                  aria-label="Export theme"
                >
                  <Upload size={16} />
                </button>
              </Tooltip>
              <Tooltip content="Import theme">
                <button
                  onClick={handleImportClick}
                  className="p-1.5 rounded hover:bg-gray-300 transition-colors"
                  aria-label="Import theme"
                >
                  <Download size={16} />
                </button>
              </Tooltip>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json"
                onChange={handleFileInputChange}
                style={{ display: "none" }}
                aria-label="Import theme file"
              />
              <Tooltip content="Close modal">
                <button
                  onClick={onClose}
                  className="p-1.5 rounded hover:bg-red-100 transition-colors duration-150"
                  aria-label="Close modal"
                >
                  <X size={16} />
                </button>
              </Tooltip>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex border-b-2 border-gray-300 bg-gray-50 flex-shrink-0">
            {plotType === "heatmap"
              ? // Heatmap-specific tabs
                [
                  { key: "heatmap", label: "Colormap" },
                  { key: "x-axis", label: "X-Axis" },
                  { key: "y-axis", label: "Y-Axis" },
                ].map((tab) => (
                  <button
                    key={tab.key}
                    onClick={() =>
                      setActiveTab(
                        tab.key as "style" | "x-axis" | "y-axis" | "heatmap"
                      )
                    }
                    className={`px-4 py-2 text-sm font-medium transition-colors ${
                      activeTab === tab.key
                        ? "text-blue-600 border-b-2 border-blue-600"
                        : "text-gray-600 hover:text-gray-800"
                    }`}
                  >
                    {tab.label}
                  </button>
                ))
              : // Line plot tabs
                [
                  { key: "style", label: "Style" },
                  { key: "x-axis", label: "X-Axis" },
                  { key: "y-axis", label: "Y-Axis" },
                ].map((tab) => (
                  <button
                    key={tab.key}
                    onClick={() =>
                      setActiveTab(
                        tab.key as "style" | "x-axis" | "y-axis" | "heatmap"
                      )
                    }
                    className={`px-4 py-2 text-sm font-medium transition-colors ${
                      activeTab === tab.key
                        ? "text-blue-600 border-b-2 border-blue-600"
                        : "text-gray-600 hover:text-gray-800"
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
          </div>

          {/* Content */}
          <div className="flex-1 p-3 overflow-y-auto">
            {activeTab === "style" && (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    Mode
                  </label>
                  <IconDropdown
                    value={localSettings.line.mode}
                    onChange={(value) => updateSetting(["line", "mode"], value)}
                    options={LINE_MODE_OPTS}
                    className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    title="Line mode"
                    aria-label="Line mode"
                  />
                </div>

                {/* Line Settings - Show when mode includes "lines" */}
                {(localSettings.line.mode === "lines" ||
                  localSettings.line.mode === "lines+markers") && (
                  <>
                    <div className="border-t border-gray-200 pt-4">
                      <h4 className="text-md font-medium text-gray-800 mb-3">
                        Line Settings
                      </h4>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1.5">
                        Color
                      </label>
                      <div className="flex gap-2 items-center">
                        <input
                          type="color"
                          value={localSettings.line.color}
                          onChange={(e) =>
                            updateSetting(["line", "color"], e.target.value)
                          }
                          className="w-12 h-10 border border-gray-300 rounded cursor-pointer"
                          title="Line color"
                          aria-label="Line color"
                        />
                        <div className="flex flex-wrap gap-1 flex-1">
                          {LINE_COLOR_OPTS.map((color) => (
                            <button
                              key={color}
                              onClick={() =>
                                updateSetting(["line", "color"], color)
                              }
                              className="w-6 h-6 rounded border border-gray-300 hover:scale-110 transition-transform"
                              style={{ backgroundColor: color }}
                              title={`Select color ${color}`}
                              aria-label={`Select color ${color}`}
                            />
                          ))}
                        </div>
                      </div>
                    </div>

                    <div>
                      <label className="flex items-center justify-between text-sm font-medium text-gray-700 mb-1.5">
                        Width
                        <span className="text-xs text-gray-500">
                          {localSettings.line.width}px
                        </span>
                      </label>
                      <input
                        type="range"
                        min="1"
                        max="10"
                        step="0.5"
                        value={localSettings.line.width}
                        onChange={(e) =>
                          updateSetting(
                            ["line", "width"],
                            parseFloat(e.target.value)
                          )
                        }
                        className="w-full"
                        title="Line width"
                        aria-label="Line width"
                      />
                    </div>

                    <div>
                      <label className="flex items-center justify-between text-sm font-medium text-gray-700 mb-1.5">
                        Opacity
                        <span className="text-xs text-gray-500">
                          {localSettings.line.opacity}
                        </span>
                      </label>
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.1"
                        value={localSettings.line.opacity}
                        onChange={(e) =>
                          updateSetting(
                            ["line", "opacity"],
                            parseFloat(e.target.value)
                          )
                        }
                        className="w-full"
                        title="Line opacity"
                        aria-label="Line opacity"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1.5">
                        Dash Style
                      </label>
                      <IconDropdown
                        value={localSettings.line.dash}
                        onChange={(value) =>
                          updateSetting(["line", "dash"], value)
                        }
                        options={LINE_DASH_OPTS}
                        className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        title="Line dash style"
                        aria-label="Line dash style"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1.5">
                        Shape
                      </label>
                      <IconDropdown
                        value={localSettings.line.shape}
                        onChange={(value) =>
                          updateSetting(["line", "shape"], value)
                        }
                        options={LINE_SHAPE_OPTS}
                        className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        title="Line shape"
                        aria-label="Line shape"
                      />
                    </div>

                    <div>
                      <label className="flex items-center justify-between text-sm font-medium text-gray-700 mb-1.5">
                        Smoothing
                        <span className="text-xs text-gray-500">
                          {localSettings.line.smoothing}
                        </span>
                      </label>
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.1"
                        value={localSettings.line.smoothing}
                        onChange={(e) =>
                          updateSetting(
                            ["line", "smoothing"],
                            parseFloat(e.target.value)
                          )
                        }
                        className="w-full"
                        title="Line smoothing (for spline shapes)"
                        aria-label="Line smoothing"
                      />
                    </div>
                  </>
                )}

                {/* Marker Settings - Show when mode includes "markers" */}
                {(localSettings.line.mode === "markers" ||
                  localSettings.line.mode === "lines+markers") && (
                  <>
                    <div className="border-t border-gray-200 pt-4">
                      <h4 className="text-md font-medium text-gray-800 mb-3">
                        Marker Settings
                      </h4>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1.5">
                        Symbol
                      </label>
                      <IconDropdown
                        value={localSettings.marker.symbol}
                        onChange={(value) =>
                          updateSetting(["marker", "symbol"], value)
                        }
                        options={MARKER_SYMBOL_OPTS}
                        className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        title="Marker symbol"
                        aria-label="Marker symbol"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1.5">
                        Color
                      </label>
                      <div className="flex gap-2 items-center">
                        <input
                          type="color"
                          value={localSettings.marker.color}
                          onChange={(e) =>
                            updateSetting(["marker", "color"], e.target.value)
                          }
                          className="w-12 h-10 border border-gray-300 rounded cursor-pointer"
                          title="Marker color"
                          aria-label="Marker color"
                        />
                        <div className="flex flex-wrap gap-1 flex-1">
                          {LINE_COLOR_OPTS.map((color) => (
                            <button
                              key={color}
                              onClick={() =>
                                updateSetting(["marker", "color"], color)
                              }
                              className="w-6 h-6 rounded border border-gray-300 hover:scale-110 transition-transform"
                              style={{ backgroundColor: color }}
                              title={`Select marker color ${color}`}
                              aria-label={`Select marker color ${color}`}
                            />
                          ))}
                        </div>
                      </div>
                    </div>

                    <div>
                      <label className="flex items-center justify-between text-sm font-medium text-gray-700 mb-1.5">
                        Size
                        <span className="text-xs text-gray-500">
                          {localSettings.marker.size}px
                        </span>
                      </label>
                      <input
                        type="range"
                        min="2"
                        max="20"
                        step="1"
                        value={localSettings.marker.size}
                        onChange={(e) =>
                          updateSetting(
                            ["marker", "size"],
                            parseInt(e.target.value)
                          )
                        }
                        className="w-full"
                        title="Marker size"
                        aria-label="Marker size"
                      />
                    </div>

                    <div>
                      <label className="flex items-center justify-between text-sm font-medium text-gray-700 mb-1.5">
                        Opacity
                        <span className="text-xs text-gray-500">
                          {localSettings.marker.opacity}
                        </span>
                      </label>
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.1"
                        value={localSettings.marker.opacity}
                        onChange={(e) =>
                          updateSetting(
                            ["marker", "opacity"],
                            parseFloat(e.target.value)
                          )
                        }
                        className="w-full"
                        title="Marker opacity"
                        aria-label="Marker opacity"
                      />
                    </div>
                  </>
                )}
              </div>
            )}

            {activeTab === "heatmap" && (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    Colorscale
                  </label>
                  <select
                    value={localSettings.hmap?.colorscale || "viridis"}
                    onChange={(e) =>
                      updateSetting(["hmap", "colorscale"], e.target.value)
                    }
                    className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    title="Heatmap colorscale"
                    aria-label="Heatmap colorscale"
                  >
                    {/* TODOLATER: Can we show a preview of the colorscales ? */}
                    {COLORSCALE_OPTS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-sm font-medium text-gray-700">
                      Color Range
                    </label>
                    <Tooltip content="Leave empty for automatic range, or set min and max values">
                      <span className="inline-flex items-center gap-1 text-xs text-gray-600">
                        <Info size={16} className="text-blue-500" />
                      </span>
                    </Tooltip>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1.5">
                        Min
                      </label>
                      <input
                        type="number"
                        step="any"
                        placeholder="Auto"
                        value={localSettings.hmap?.rangecolor?.[0] ?? ""}
                        onChange={(e) => {
                          const value =
                            e.target.value === ""
                              ? null
                              : parseFloat(e.target.value);
                          const currentRange = localSettings.hmap
                            ?.rangecolor || [null, null];
                          updateSetting(
                            ["hmap", "rangecolor"],
                            [value, currentRange[1]]
                          );
                        }}
                        className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        title="Minimum color range value"
                        aria-label="Minimum color range value"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1.5">
                        Max
                      </label>
                      <input
                        type="number"
                        step="any"
                        placeholder="Auto"
                        value={localSettings.hmap?.rangecolor?.[1] ?? ""}
                        onChange={(e) => {
                          const value =
                            e.target.value === ""
                              ? null
                              : parseFloat(e.target.value);
                          const currentRange = localSettings.hmap
                            ?.rangecolor || [null, null];
                          updateSetting(
                            ["hmap", "rangecolor"],
                            [currentRange[0], value]
                          );
                        }}
                        className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        title="Maximum color range value"
                        aria-label="Maximum color range value"
                      />
                    </div>
                  </div>
                  {localSettings.hmap?.rangecolor && (
                    <button
                      onClick={() =>
                        updateSetting(["hmap", "rangecolor"], null)
                      }
                      className="mt-2 w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium text-blue-600 bg-blue-50 border border-blue-200 rounded hover:bg-blue-100 hover:text-blue-800 transition-colors"
                    >
                      <RotateCcw size={16} className="text-blue-500" />
                      Reset to automatic range
                    </button>
                  )}
                </div>
              </div>
            )}

            {activeTab === "x-axis" && (
              <div className="space-y-6">
                {/* Major Grid & Ticks */}
                <div>
                  <h3 className="text-lg font-medium text-gray-800 mb-4">
                    Major Grid & Ticks
                  </h3>

                  {/* Show Major Grid Toggle */}
                  <div className="mb-4">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium text-gray-700">
                        Show Major Grid
                      </label>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          checked={localSettings.x.maj.showgrid}
                          onChange={(e) =>
                            updateSetting(
                              ["x", "maj", "showgrid"],
                              e.target.checked
                            )
                          }
                          className="sr-only peer"
                          title="Show X-axis major grid"
                          aria-label="Show X-axis major grid"
                        />
                        <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                      </label>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1.5">
                        Axis Type
                      </label>
                      <IconDropdown
                        value={localSettings.x.maj.type}
                        onChange={(value) =>
                          updateSetting(["x", "maj", "type"], value)
                        }
                        options={AXIS_TYPE_OPTS}
                        className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        title="X-axis type"
                        aria-label="X-axis type"
                      />
                    </div>

                    {/* Major Grid Settings - only show when grid is enabled */}
                    {localSettings.x.maj.showgrid && (
                      <>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1.5">
                            Grid Color
                          </label>
                          <input
                            type="color"
                            value={localSettings.x.maj.gridcolor}
                            onChange={(e) =>
                              updateSetting(
                                ["x", "maj", "gridcolor"],
                                e.target.value
                              )
                            }
                            className="w-12 h-10 border border-gray-300 rounded cursor-pointer"
                            title="X-axis major grid color"
                            aria-label="X-axis major grid color"
                          />
                        </div>

                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1.5">
                            Grid Dash Style
                          </label>
                          <IconDropdown
                            value={localSettings.x.maj.griddash}
                            onChange={(value) =>
                              updateSetting(["x", "maj", "griddash"], value)
                            }
                            options={GRID_DASH_OPTS}
                            className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            title="X-axis major grid dash style"
                            aria-label="X-axis major grid dash style"
                          />
                        </div>

                        {plotType !== "heatmap" && (
                          <div>
                            <label className="flex items-center justify-between text-sm font-medium text-gray-700 mb-1.5">
                              Grid Width
                              <span className="text-xs text-gray-500">
                                {localSettings.x.maj.gridwidth}px
                              </span>
                            </label>
                            <input
                              type="range"
                              min="1"
                              max="5"
                              step="0.5"
                              value={localSettings.x.maj.gridwidth}
                              onChange={(e) =>
                                updateSetting(
                                  ["x", "maj", "gridwidth"],
                                  parseFloat(e.target.value)
                                )
                              }
                              className="w-full"
                              title="X-axis major grid width"
                              aria-label="X-axis major grid width"
                            />
                          </div>
                        )}
                      </>
                    )}

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1.5">
                        Number of Ticks
                      </label>
                      <input
                        type="number"
                        min="2"
                        max="20"
                        value={localSettings.x.maj.nticks}
                        onChange={(e) =>
                          updateSetting(
                            ["x", "maj", "nticks"],
                            parseInt(e.target.value)
                          )
                        }
                        className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        title="Number of X-axis major ticks"
                        aria-label="Number of X-axis major ticks"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1.5">
                        Tick Color
                      </label>
                      <input
                        type="color"
                        value={localSettings.x.maj.tickcolor}
                        onChange={(e) =>
                          updateSetting(
                            ["x", "maj", "tickcolor"],
                            e.target.value
                          )
                        }
                        className="w-12 h-10 border border-gray-300 rounded cursor-pointer"
                        title="X-axis major tick color"
                        aria-label="X-axis major tick color"
                      />
                    </div>

                    <div>
                      <label className="flex items-center justify-between text-sm font-medium text-gray-700 mb-1.5">
                        Tick Width
                        <span className="text-xs text-gray-500">
                          {localSettings.x.maj.tickwidth}px
                        </span>
                      </label>
                      <input
                        type="range"
                        min="1"
                        max="5"
                        step="0.5"
                        value={localSettings.x.maj.tickwidth}
                        onChange={(e) =>
                          updateSetting(
                            ["x", "maj", "tickwidth"],
                            parseFloat(e.target.value)
                          )
                        }
                        className="w-full"
                        title="X-axis major tick width"
                        aria-label="X-axis major tick width"
                      />
                    </div>

                    <div>
                      <label className="flex items-center justify-between text-sm font-medium text-gray-700 mb-1.5">
                        Tick Length
                        <span className="text-xs text-gray-500">
                          {localSettings.x.maj.ticklen}px
                        </span>
                      </label>
                      <input
                        type="range"
                        min="2"
                        max="15"
                        step="1"
                        value={localSettings.x.maj.ticklen}
                        onChange={(e) =>
                          updateSetting(
                            ["x", "maj", "ticklen"],
                            parseInt(e.target.value)
                          )
                        }
                        className="w-full"
                        title="X-axis major tick length"
                        aria-label="X-axis major tick length"
                      />
                    </div>

                    <div>
                      <label className="flex items-center justify-between text-sm font-medium text-gray-700 mb-1.5">
                        Tick Angle
                        <span className="text-xs text-gray-500">
                          {localSettings.x.maj.tickangle}°
                        </span>
                      </label>
                      <input
                        type="range"
                        min="-90"
                        max="90"
                        step="15"
                        value={localSettings.x.maj.tickangle}
                        onChange={(e) =>
                          updateSetting(
                            ["x", "maj", "tickangle"],
                            parseInt(e.target.value)
                          )
                        }
                        className="w-full"
                        title="X-axis major tick angle"
                        aria-label="X-axis major tick angle"
                      />
                    </div>
                  </div>
                </div>

                {/* Separator */}
                <div className="border-t border-gray-200 my-6"></div>

                {/* Minor Grid & Ticks */}
                <div>
                  <h3 className="text-lg font-medium text-gray-800 mb-4">
                    Minor Grid & Ticks
                  </h3>

                  {/* Show Minor Grid Toggle */}
                  <div className="mb-4">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium text-gray-700">
                        Show Minor Grid
                      </label>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          checked={localSettings.x.min.showgrid}
                          onChange={(e) =>
                            updateSetting(
                              ["x", "min", "showgrid"],
                              e.target.checked
                            )
                          }
                          className="sr-only peer"
                          title="Show X-axis minor grid"
                          aria-label="Show X-axis minor grid"
                        />
                        <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                      </label>
                    </div>
                  </div>

                  <div className="space-y-4">
                    {/* Minor Grid Settings - only show when grid is enabled */}
                    {localSettings.x.min.showgrid && (
                      <>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1.5">
                            Grid Color
                          </label>
                          <input
                            type="color"
                            value={localSettings.x.min.gridcolor}
                            onChange={(e) =>
                              updateSetting(
                                ["x", "min", "gridcolor"],
                                e.target.value
                              )
                            }
                            className="w-12 h-10 border border-gray-300 rounded cursor-pointer"
                            title="X-axis minor grid color"
                            aria-label="X-axis minor grid color"
                          />
                        </div>

                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1.5">
                            Grid Dash Style
                          </label>
                          <IconDropdown
                            value={localSettings.x.min.griddash}
                            onChange={(value) =>
                              updateSetting(["x", "min", "griddash"], value)
                            }
                            options={GRID_DASH_OPTS}
                            className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            title="X-axis minor grid dash style"
                            aria-label="X-axis minor grid dash style"
                          />
                        </div>

                        {plotType !== "heatmap" && (
                          <div>
                            <label className="flex items-center justify-between text-sm font-medium text-gray-700 mb-1.5">
                              Grid Width
                              <span className="text-xs text-gray-500">
                                {localSettings.x.min.gridwidth}px
                              </span>
                            </label>
                            <input
                              type="range"
                              min="1"
                              max="5"
                              step="0.5"
                              value={localSettings.x.min.gridwidth}
                              onChange={(e) =>
                                updateSetting(
                                  ["x", "min", "gridwidth"],
                                  parseFloat(e.target.value)
                                )
                              }
                              className="w-full"
                              title="X-axis minor grid width"
                              aria-label="X-axis minor grid width"
                            />
                          </div>
                        )}
                      </>
                    )}

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1.5">
                        Number of Ticks
                      </label>
                      <input
                        type="number"
                        min="2"
                        max="20"
                        value={localSettings.x.min.nticks}
                        onChange={(e) =>
                          updateSetting(
                            ["x", "min", "nticks"],
                            parseInt(e.target.value)
                          )
                        }
                        className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        title="Number of X-axis minor ticks"
                        aria-label="Number of X-axis minor ticks"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1.5">
                        Tick Color
                      </label>
                      <input
                        type="color"
                        value={localSettings.x.min.tickcolor}
                        onChange={(e) =>
                          updateSetting(
                            ["x", "min", "tickcolor"],
                            e.target.value
                          )
                        }
                        className="w-12 h-10 border border-gray-300 rounded cursor-pointer"
                        title="X-axis minor tick color"
                        aria-label="X-axis minor tick color"
                      />
                    </div>

                    <div>
                      <label className="flex items-center justify-between text-sm font-medium text-gray-700 mb-1.5">
                        Tick Width
                        <span className="text-xs text-gray-500">
                          {localSettings.x.min.tickwidth}px
                        </span>
                      </label>
                      <input
                        type="range"
                        min="1"
                        max="5"
                        step="0.5"
                        value={localSettings.x.min.tickwidth}
                        onChange={(e) =>
                          updateSetting(
                            ["x", "min", "tickwidth"],
                            parseFloat(e.target.value)
                          )
                        }
                        className="w-full"
                        title="X-axis minor tick width"
                        aria-label="X-axis minor tick width"
                      />
                    </div>

                    <div>
                      <label className="flex items-center justify-between text-sm font-medium text-gray-700 mb-1.5">
                        Tick Length
                        <span className="text-xs text-gray-500">
                          {localSettings.x.min.ticklen}px
                        </span>
                      </label>
                      <input
                        type="range"
                        min="2"
                        max="15"
                        step="1"
                        value={localSettings.x.min.ticklen}
                        onChange={(e) =>
                          updateSetting(
                            ["x", "min", "ticklen"],
                            parseInt(e.target.value)
                          )
                        }
                        className="w-full"
                        title="X-axis minor tick length"
                        aria-label="X-axis minor tick length"
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === "y-axis" && (
              <div className="space-y-6">
                {/* Major Grid & Ticks */}
                <div>
                  <h3 className="text-lg font-medium text-gray-800 mb-4">
                    Major Grid & Ticks
                  </h3>

                  {/* Show Major Grid Toggle */}
                  <div className="mb-4">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium text-gray-700">
                        Show Major Grid
                      </label>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          checked={localSettings.y.maj.showgrid}
                          onChange={(e) =>
                            updateSetting(
                              ["y", "maj", "showgrid"],
                              e.target.checked
                            )
                          }
                          className="sr-only peer"
                          title="Show Y-axis major grid"
                          aria-label="Show Y-axis major grid"
                        />
                        <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                      </label>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1.5">
                        Axis Type
                      </label>
                      <IconDropdown
                        value={localSettings.y.maj.type}
                        onChange={(value) =>
                          updateSetting(["y", "maj", "type"], value)
                        }
                        options={AXIS_TYPE_OPTS}
                        className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        title="Y-axis type"
                        aria-label="Y-axis type"
                      />
                    </div>

                    {/* Major Grid Settings - only show when grid is enabled */}
                    {localSettings.y.maj.showgrid && (
                      <>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1.5">
                            Grid Color
                          </label>
                          <input
                            type="color"
                            value={localSettings.y.maj.gridcolor}
                            onChange={(e) =>
                              updateSetting(
                                ["y", "maj", "gridcolor"],
                                e.target.value
                              )
                            }
                            className="w-12 h-10 border border-gray-300 rounded cursor-pointer"
                            title="Y-axis major grid color"
                            aria-label="Y-axis major grid color"
                          />
                        </div>

                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1.5">
                            Grid Dash Style
                          </label>
                          <IconDropdown
                            value={localSettings.y.maj.griddash}
                            onChange={(value) =>
                              updateSetting(["y", "maj", "griddash"], value)
                            }
                            options={GRID_DASH_OPTS}
                            className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            title="Y-axis major grid dash style"
                            aria-label="Y-axis major grid dash style"
                          />
                        </div>

                        {plotType !== "heatmap" && (
                          <div>
                            <label className="flex items-center justify-between text-sm font-medium text-gray-700 mb-1.5">
                              Grid Width
                              <span className="text-xs text-gray-500">
                                {localSettings.y.maj.gridwidth}px
                              </span>
                            </label>
                            <input
                              type="range"
                              min="1"
                              max="5"
                              step="0.5"
                              value={localSettings.y.maj.gridwidth}
                              onChange={(e) =>
                                updateSetting(
                                  ["y", "maj", "gridwidth"],
                                  parseFloat(e.target.value)
                                )
                              }
                              className="w-full"
                              title="Y-axis major grid width"
                              aria-label="Y-axis major grid width"
                            />
                          </div>
                        )}
                      </>
                    )}

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1.5">
                        Number of Ticks
                      </label>
                      <input
                        type="number"
                        min="2"
                        max="20"
                        value={localSettings.y.maj.nticks}
                        onChange={(e) =>
                          updateSetting(
                            ["y", "maj", "nticks"],
                            parseInt(e.target.value)
                          )
                        }
                        className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        title="Number of Y-axis major ticks"
                        aria-label="Number of Y-axis major ticks"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1.5">
                        Tick Color
                      </label>
                      <input
                        type="color"
                        value={localSettings.y.maj.tickcolor}
                        onChange={(e) =>
                          updateSetting(
                            ["y", "maj", "tickcolor"],
                            e.target.value
                          )
                        }
                        className="w-12 h-10 border border-gray-300 rounded cursor-pointer"
                        title="Y-axis major tick color"
                        aria-label="Y-axis major tick color"
                      />
                    </div>

                    <div>
                      <label className="flex items-center justify-between text-sm font-medium text-gray-700 mb-1.5">
                        Tick Width
                        <span className="text-xs text-gray-500">
                          {localSettings.y.maj.tickwidth}px
                        </span>
                      </label>
                      <input
                        type="range"
                        min="1"
                        max="5"
                        step="0.5"
                        value={localSettings.y.maj.tickwidth}
                        onChange={(e) =>
                          updateSetting(
                            ["y", "maj", "tickwidth"],
                            parseFloat(e.target.value)
                          )
                        }
                        className="w-full"
                        title="Y-axis major tick width"
                        aria-label="Y-axis major tick width"
                      />
                    </div>

                    <div>
                      <label className="flex items-center justify-between text-sm font-medium text-gray-700 mb-1.5">
                        Tick Length
                        <span className="text-xs text-gray-500">
                          {localSettings.y.maj.ticklen}px
                        </span>
                      </label>
                      <input
                        type="range"
                        min="2"
                        max="15"
                        step="1"
                        value={localSettings.y.maj.ticklen}
                        onChange={(e) =>
                          updateSetting(
                            ["y", "maj", "ticklen"],
                            parseInt(e.target.value)
                          )
                        }
                        className="w-full"
                        title="Y-axis major tick length"
                        aria-label="Y-axis major tick length"
                      />
                    </div>

                    <div>
                      <label className="flex items-center justify-between text-sm font-medium text-gray-700 mb-1.5">
                        Tick Angle
                        <span className="text-xs text-gray-500">
                          {localSettings.y.maj.tickangle}°
                        </span>
                      </label>
                      <input
                        type="range"
                        min="-90"
                        max="90"
                        step="15"
                        value={localSettings.y.maj.tickangle}
                        onChange={(e) =>
                          updateSetting(
                            ["y", "maj", "tickangle"],
                            parseInt(e.target.value)
                          )
                        }
                        className="w-full"
                        title="Y-axis major tick angle"
                        aria-label="Y-axis major tick angle"
                      />
                    </div>
                  </div>
                </div>

                {/* Separator */}
                <div className="border-t border-gray-200 my-6"></div>

                {/* Minor Grid & Ticks */}
                <div>
                  <h3 className="text-lg font-medium text-gray-800 mb-4">
                    Minor Grid & Ticks
                  </h3>

                  {/* Show Minor Grid Toggle */}
                  <div className="mb-4">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium text-gray-700">
                        Show Minor Grid
                      </label>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          checked={localSettings.y.min.showgrid}
                          onChange={(e) =>
                            updateSetting(
                              ["y", "min", "showgrid"],
                              e.target.checked
                            )
                          }
                          className="sr-only peer"
                          title="Show Y-axis minor grid"
                          aria-label="Show Y-axis minor grid"
                        />
                        <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                      </label>
                    </div>
                  </div>

                  <div className="space-y-4">
                    {/* Minor Grid Settings - only show when grid is enabled */}
                    {localSettings.y.min.showgrid && (
                      <>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1.5">
                            Grid Color
                          </label>
                          <input
                            type="color"
                            value={localSettings.y.min.gridcolor}
                            onChange={(e) =>
                              updateSetting(
                                ["y", "min", "gridcolor"],
                                e.target.value
                              )
                            }
                            className="w-12 h-10 border border-gray-300 rounded cursor-pointer"
                            title="Y-axis minor grid color"
                            aria-label="Y-axis minor grid color"
                          />
                        </div>

                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1.5">
                            Grid Dash Style
                          </label>
                          <IconDropdown
                            value={localSettings.y.min.griddash}
                            onChange={(value) =>
                              updateSetting(["y", "min", "griddash"], value)
                            }
                            options={GRID_DASH_OPTS}
                            className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            title="Y-axis minor grid dash style"
                            aria-label="Y-axis minor grid dash style"
                          />
                        </div>

                        {plotType !== "heatmap" && (
                          <div>
                            <label className="flex items-center justify-between text-sm font-medium text-gray-700 mb-1.5">
                              Grid Width
                              <span className="text-xs text-gray-500">
                                {localSettings.y.min.gridwidth}px
                              </span>
                            </label>
                            <input
                              type="range"
                              min="1"
                              max="5"
                              step="0.5"
                              value={localSettings.y.min.gridwidth}
                              onChange={(e) =>
                                updateSetting(
                                  ["y", "min", "gridwidth"],
                                  parseFloat(e.target.value)
                                )
                              }
                              className="w-full"
                              title="Y-axis minor grid width"
                              aria-label="Y-axis minor grid width"
                            />
                          </div>
                        )}
                      </>
                    )}

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1.5">
                        Number of Ticks
                      </label>
                      <input
                        type="number"
                        min="2"
                        max="20"
                        value={localSettings.y.min.nticks}
                        onChange={(e) =>
                          updateSetting(
                            ["y", "min", "nticks"],
                            parseInt(e.target.value)
                          )
                        }
                        className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        title="Number of Y-axis minor ticks"
                        aria-label="Number of Y-axis minor ticks"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1.5">
                        Tick Color
                      </label>
                      <input
                        type="color"
                        value={localSettings.y.min.tickcolor}
                        onChange={(e) =>
                          updateSetting(
                            ["y", "min", "tickcolor"],
                            e.target.value
                          )
                        }
                        className="w-12 h-10 border border-gray-300 rounded cursor-pointer"
                        title="Y-axis minor tick color"
                        aria-label="Y-axis minor tick color"
                      />
                    </div>

                    <div>
                      <label className="flex items-center justify-between text-sm font-medium text-gray-700 mb-1.5">
                        Tick Width
                        <span className="text-xs text-gray-500">
                          {localSettings.y.min.tickwidth}px
                        </span>
                      </label>
                      <input
                        type="range"
                        min="1"
                        max="5"
                        step="0.5"
                        value={localSettings.y.min.tickwidth}
                        onChange={(e) =>
                          updateSetting(
                            ["y", "min", "tickwidth"],
                            parseFloat(e.target.value)
                          )
                        }
                        className="w-full"
                        title="Y-axis minor tick width"
                        aria-label="Y-axis minor tick width"
                      />
                    </div>

                    <div>
                      <label className="flex items-center justify-between text-sm font-medium text-gray-700 mb-1.5">
                        Tick Length
                        <span className="text-xs text-gray-500">
                          {localSettings.y.min.ticklen}px
                        </span>
                      </label>
                      <input
                        type="range"
                        min="2"
                        max="15"
                        step="1"
                        value={localSettings.y.min.ticklen}
                        onChange={(e) =>
                          updateSetting(
                            ["y", "min", "ticklen"],
                            parseInt(e.target.value)
                          )
                        }
                        className="w-full"
                        title="Y-axis minor tick length"
                        aria-label="Y-axis minor tick length"
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Drag and Drop Overlay */}
          {isDragging && (
            <div className="absolute inset-0 bg-blue-100 bg-opacity-90 flex items-center justify-center z-10 border-2 border-dashed border-blue-500 rounded-lg">
              <div className="text-center">
                <Upload size={48} className="mx-auto text-blue-600 mb-2" />
                <p className="text-blue-800 font-medium">
                  Drop theme file here
                </p>
                <p className="text-blue-600 text-sm">JSON files only</p>
              </div>
            </div>
          )}
        </div>
      </Rnd>
    </div>
  );
};

export default AppearanceModal;

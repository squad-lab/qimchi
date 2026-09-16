import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  X,
  RotateCcw,
  // Undo,
  // Redo,
  Download,
  Upload,
} from "lucide-react";
import { Rnd } from "react-rnd";

// Local imports
import { useToast } from "../../hooks/useToast";
import type { PlotAppearanceSettings } from "../../components/types";
import { formatTitleWithUUID, getPlotTypeIcon } from "./UtilComponents";
import Tooltip from "../Tooltip";
import { AxisSection, ColormapSection, LineStyleSection } from "./AppearanceSections";
import { FACTORY_APPEARANCE_SETTINGS, mergeAppearanceDefaults } from "./appearanceDefaults";

interface AppearanceModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: PlotAppearanceSettings;
  onChange: (settings: PlotAppearanceSettings) => void;
  plotType?: string;
  plotTitle?: string;
  plotJson?: any;
}

// Simple global z-index manager so modals can stack above each other.
// Stores a counter on window to persist across components.
const getNextGlobalModalZ = (): number => {
  if (typeof window === "undefined") return 2000;
  const w = window as unknown as { __qimchi_modal_z?: number };
  if (!w.__qimchi_modal_z) w.__qimchi_modal_z = 2000;
  w.__qimchi_modal_z = (w.__qimchi_modal_z || 2000) + 1;
  return w.__qimchi_modal_z;
};

const AppearanceModal: React.FC<AppearanceModalProps> = ({
  isOpen,
  onClose,
  settings,
  onChange,
  plotType = "line", // Fallback if detecting fails
  plotTitle,
  plotJson,
}) => {
  const [localSettings, setLocalSettings] = useState<PlotAppearanceSettings>(settings);
  const [activeTab, setActiveTab] = useState<"style" | "x-axis" | "y-axis" | "heatmap">(
    plotType === "heatmap" ? "heatmap" : "style",
  );
  // const [history, setHistory] = useState<PlotAppearanceSettings[]>([settings]);
  // const [historyIndex, setHistoryIndex] = useState(0);
  // const [isUndoRedoAction, setIsUndoRedoAction] = useState(false);

  // Debounce ref to prevent flickering when updating appearance settings
  const debounceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    [onChange],
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
    updateSettingsWithHistory(FACTORY_APPEARANCE_SETTINGS);
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
    const dataUri = "data:application/json;charset=utf-8," + encodeURIComponent(dataStr);

    // Use full title or UUID for filename
    const sanitizeFilename = (str: string) => str.replace(/[^a-z0-9-_]/gi, "_").substring(0, 50);

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

  const mergeWithDefaults = (imported: Partial<PlotAppearanceSettings>): PlotAppearanceSettings =>
    mergeAppearanceDefaults(FACTORY_APPEARANCE_SETTINGS, imported);

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

        const sourcePlot = importedData.plotTitle ? ` from "${importedData.plotTitle}"` : "";
        showToast(`Theme imported successfully${sourcePlot}`, "success");
      } catch (error) {
        console.error("Error importing theme:", error);
        showToast("Error parsing theme file. Please check the file format.", "error");
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
      (file) => file.type === "application/json" || file.name.endsWith(".json"),
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
        e
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
        >
          {/* Header */}
          <div className="flex items-center justify-between p-2 bg-gray-200 border-b-2 border-gray-300 drag-handle cursor-move shrink-0">
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
                  className="p-1.5 rounded hover:bg-gray-300 transition-colors"
                  aria-label="Close modal"
                >
                  <X size={16} className="text-red-600" />
                </button>
              </Tooltip>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex border-b-2 border-gray-300 bg-gray-50 shrink-0">
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
                      setActiveTab(tab.key as "style" | "x-axis" | "y-axis" | "heatmap")
                    }
                    className={`px-4 py-2 text-sm font-medium transition-colors ${
                      activeTab === tab.key
                        ? "text-blue-600 border-b-2 border-blue-600 bg-white shadow-inner"
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
                      setActiveTab(tab.key as "style" | "x-axis" | "y-axis" | "heatmap")
                    }
                    className={`px-4 py-2 text-sm font-medium transition-colors ${
                      activeTab === tab.key
                        ? "text-blue-600 border-b-2 border-blue-600 bg-white shadow-inner"
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
              <LineStyleSection settings={localSettings} updateSetting={updateSetting} />
            )}

            {activeTab === "heatmap" && (
              <ColormapSection
                settings={localSettings}
                updateSetting={updateSetting}
                plotJson={plotJson}
              />
            )}

            {activeTab === "x-axis" && (
              <AxisSection
                axis="x"
                plotType={plotType}
                settings={localSettings}
                updateSetting={updateSetting}
              />
            )}

            {activeTab === "y-axis" && (
              <AxisSection
                axis="y"
                plotType={plotType}
                settings={localSettings}
                updateSetting={updateSetting}
              />
            )}
          </div>

          {/* Drag and Drop Overlay */}
          {isDragging && (
            <div className="absolute inset-0 bg-blue-100 bg-opacity-90 flex items-center justify-center z-10 border-2 border-dashed border-blue-500 rounded-lg">
              <div className="text-center">
                <Upload size={48} className="mx-auto text-blue-600 mb-2" />
                <p className="text-blue-800 font-medium">Drop theme file here</p>
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

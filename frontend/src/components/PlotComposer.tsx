import { forwardRef, useState, useEffect, useImperativeHandle, useCallback } from "react";
import { X, Play, Eye, EyeOff, Trash2, Grid, ChartLine, ListMusic } from "lucide-react";

// Local imports
import Tooltip from "./Tooltip";
import SectionRibbon, { ribbonButtonClass } from "./SectionRibbon";
import { useShortcut } from "../hooks/useGlobalShortcuts";
import { useToast } from "../hooks/useToast";

export interface PlotField {
  id: string;
  source: string;
  name: string;
  type: "independent" | "dependent";
}

type PlotType = "LinePlot" | "HeatMap";

export interface PlotComposerConfig {
  fpath: string; // Single dataset path
  indeps: string[];
  deps: string[];
  plotType: PlotType;
  source?: "memory" | "disk";
  preferredSource?: "memory" | "disk";
}

export interface ComposerSelectionSnapshot {
  plotType: PlotType;
  indeps: string[];
  deps: string[];
  hasRequiredAxes: boolean;
  hasAnySelections: boolean;
  fieldSources: string[];
}

interface PlotComposerProps {
  onCreatePlot?: (snapshot: ComposerSelectionSnapshot) => void;
  selectionContextLabel?: string;
}

export interface PlotComposerHandle {
  setComposerPlotType: (type: PlotType) => void;
  createPlotFromComposer: () => void;
  clearComposer: () => void;
  autofillFromField: (field: PlotField) => void;
  hasComposerSelections: () => boolean;
  getComposerSelectionNames: () => ComposerSelectionSnapshot;
}

const PlotComposer = forwardRef<PlotComposerHandle, PlotComposerProps>(
  ({ onCreatePlot, selectionContextLabel }: PlotComposerProps, ref) => {
    const [xFields, setXFields] = useState<PlotField[]>([]);
    const [yFields, setYFields] = useState<PlotField[]>([]);
    const [zFields, setZFields] = useState<PlotField[]>([]);
    const [plotType, setPlotType] = useState<PlotType>("LinePlot");
    const [isPlotTypeDropdownOpen, setIsPlotTypeDropdownOpen] = useState(false);
    const [dragOverField, setDragOverField] = useState<"x" | "y" | "z" | null>(null);
    const [isExpanded, setIsExpanded] = useState(true);

    useShortcut("toggle-composer", () => setIsExpanded((expanded) => !expanded));
    const [draggedFieldType, setDraggedFieldType] = useState<"independent" | "dependent" | null>(
      null,
    );
    const [invalidDropField, setInvalidDropField] = useState<"x" | "y" | "z" | null>(null);

    const { showToast } = useToast();

    // Helper function to get icon for plot type
    const getPlotTypeIcon = (type: PlotType) => {
      switch (type) {
        case "LinePlot":
          return <ChartLine size={16} />;
        case "HeatMap":
          return <Grid size={16} />;
        default:
          return null;
      }
    };

    // Close dropdown when clicking outside
    useEffect(() => {
      const handleClickOutside = () => {
        if (isPlotTypeDropdownOpen) {
          setIsPlotTypeDropdownOpen(false);
        }
      };

      if (isPlotTypeDropdownOpen) {
        document.addEventListener("click", handleClickOutside);
      }

      return () => {
        document.removeEventListener("click", handleClickOutside);
      };
    }, [isPlotTypeDropdownOpen]);

    // Clear Z fields when switching to LinePlot
    useEffect(() => {
      if (plotType === "LinePlot" && zFields.length > 0) {
        setZFields([]);
      }
    }, [plotType, zFields.length]);

    // Example usage of toast in other parts of the component:
    // showToast("Success message", "success");
    // showToast("Error message", "error");
    // showToast("Warning message", "warning");
    // showToast("Info message", "info");

    const handleDragOver = (e: React.DragEvent, field: "x" | "y" | "z") => {
      e.preventDefault();
      e.stopPropagation();

      // Check if the dragged item is a plot field (single or multiple)
      if (
        e.dataTransfer.types.includes("application/plot-field") ||
        e.dataTransfer.types.includes("application/plot-fields")
      ) {
        // Try to determine the field type from the dragged data
        let fieldType: "independent" | "dependent" | null = null;

        try {
          const multipleData = e.dataTransfer.getData("application/plot-fields");
          const singleData = e.dataTransfer.getData("application/plot-field");

          if (multipleData) {
            const fields = JSON.parse(multipleData);
            if (fields.length > 0) {
              fieldType = fields[0].type;
            }
          } else if (singleData) {
            const fieldData = JSON.parse(singleData);
            fieldType = fieldData.type;
          }
        } catch {
          // If we can't parse the data, we'll allow the drop and validate later
        }

        // Enhanced validation based on new restrictions
        const isValidDrop = validateDrop(fieldType, field);

        if (isValidDrop) {
          setDragOverField(field);
          setInvalidDropField(null);
        } else {
          setDragOverField(null);
          setInvalidDropField(field);
        }

        setDraggedFieldType(fieldType);
      }
    };

    const getDropValidationError = useCallback(
      (fieldType: "independent" | "dependent" | null, field: "x" | "y" | "z"): string | null => {
        if (!fieldType) return null;

        // Universal restrictions:
        // - X can always have at most 1 item (independent or dependent)
        if (field === "x" && xFields.length >= 1) {
          return "X-axis can only accept one field";
        }

        // Z-axis is only enabled for HeatMap
        if (field === "z" && plotType !== "HeatMap") {
          return "Z-axis is only available for HeatMap plots";
        }

        // Plot-type specific restrictions
        if (plotType === "LinePlot") {
          // LinePlot: x can be indep/dep (1 max), y can be dep (multiple)
          if (field === "y" && fieldType === "independent") {
            return "LinePlot Y-axis only accepts dependent variables";
          }
        } else if (plotType === "HeatMap") {
          // HeatMap: x can be indep/dep (1 max), y can be indep/dep (multiple), z can be dep (multiple)
          if (field === "z" && fieldType === "independent") {
            return "HeatMap Z-axis only accepts dependent variables";
          }
        }

        return null;
      },
      [plotType, xFields.length],
    );

    // Enhanced validation function
    const validateDrop = (
      fieldType: "independent" | "dependent" | null,
      field: "x" | "y" | "z",
    ): boolean => {
      return !getDropValidationError(fieldType, field);
    };

    // Check if Z dropzone should be disabled
    const isZDropzoneDisabled = () => {
      // Z is only enabled for HeatMap
      return plotType !== "HeatMap";
    };

    const handleDragLeave = (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const target = e.currentTarget as HTMLElement;
      const relatedTarget = e.relatedTarget as HTMLElement;

      if (!target.contains(relatedTarget)) {
        setDragOverField(null);
        setInvalidDropField(null);
        setDraggedFieldType(null);
      }
    };

    const handleDrop = (e: React.DragEvent, field: "x" | "y" | "z") => {
      e.preventDefault();
      e.stopPropagation();
      setDragOverField(null);
      setInvalidDropField(null);
      setDraggedFieldType(null);

      try {
        // Try multiple items first
        let plotFields: PlotField[] = [];

        const multipleData = e.dataTransfer.getData("application/plot-fields");
        if (multipleData) {
          plotFields = JSON.parse(multipleData);
        } else {
          // Fall back to single item
          const singleData = e.dataTransfer.getData("application/plot-field");
          if (singleData) {
            plotFields = [JSON.parse(singleData)];
          }
        }

        if (plotFields.length === 0) return;

        // Enhanced validation
        const invalidFields = plotFields.filter((plotField) => {
          // Universal restrictions
          // - X can always have at most 1 item (independent or dependent)
          if (field === "x" && xFields.length >= 1) return true;

          // Z-axis is only enabled for HeatMap
          if (field === "z" && plotType !== "HeatMap") return true;

          // Plot-type specific restrictions
          if (plotType === "LinePlot") {
            // LinePlot: x can be indep/dep (1 max), y can be dep (multiple)
            if (field === "y" && plotField.type === "independent") return true;
          } else if (plotType === "HeatMap") {
            // HeatMap: x can be indep/dep (1 max), y can be indep/dep (multiple), z can be dep (multiple)
            if (field === "z" && plotField.type === "independent") return true;
          }

          return false;
        });

        if (invalidFields.length > 0) {
          // Show appropriate error message
          const fieldType = invalidFields[0].type;
          const errorMessage = getDropValidationError(fieldType, field);

          if (errorMessage) {
            showToast(errorMessage, "error", 4000);
          }
          return;
        }

        // Add the fields to the appropriate array
        switch (field) {
          case "x":
            // X can always have at most 1 item for all plot types
            setXFields(plotFields);
            break;
          case "y":
            setYFields((prev) => {
              const filtered = prev.filter((f) => !plotFields.some((pf) => pf.id === f.id));
              return [...filtered, ...plotFields];
            });
            break;
          case "z":
            setZFields((prev) => {
              const filtered = prev.filter((f) => !plotFields.some((pf) => pf.id === f.id));
              // Z-axis is only enabled for HeatMap (multiple fields allowed)
              return [...filtered, ...plotFields];
            });
            break;
        }
      } catch {
        showToast("Failed to handle dropped plot field", "error");
        // console.error("Error handling dropped plot field:", error);
      }
    };

    const removeField = (fieldId: string, from: "x" | "y" | "z") => {
      switch (from) {
        case "x":
          setXFields((prev) => prev.filter((f) => f.id !== fieldId));
          break;
        case "y":
          setYFields((prev) => prev.filter((f) => f.id !== fieldId));
          break;
        case "z":
          setZFields((prev) => prev.filter((f) => f.id !== fieldId));
          break;
      }
    };

    const clearFields = (field: "x" | "y" | "z") => {
      switch (field) {
        case "x":
          setXFields([]);
          break;
        case "y":
          setYFields([]);
          break;
        case "z":
          setZFields([]);
          break;
      }
    };

    const clearAllFields = useCallback(() => {
      setXFields([]);
      setYFields([]);
      setZFields([]);
    }, []);

    const getNextAutofillTarget = useCallback((): "x" | "y" | "z" | null => {
      if (xFields.length === 0) return "x";
      if (yFields.length === 0) return "y";
      if (plotType === "HeatMap" && zFields.length === 0) return "z";
      return null;
    }, [plotType, xFields.length, yFields.length, zFields.length]);

    const handleAutofillField = useCallback(
      (plotField: PlotField) => {
        const target = getNextAutofillTarget();
        if (!target) {
          showToast("Composer has no empty axis slot", "warning");
          return;
        }

        const errorMessage = getDropValidationError(plotField.type, target);
        if (errorMessage) {
          showToast(errorMessage, "error", 4000);
          return;
        }

        if (target === "x") {
          setXFields([plotField]);
        } else if (target === "y") {
          setYFields((prev) => {
            if (prev.some((field) => field.id === plotField.id)) {
              return prev;
            }
            return [...prev, plotField];
          });
        } else {
          setZFields((prev) => {
            if (prev.some((field) => field.id === plotField.id)) {
              return prev;
            }
            return [...prev, plotField];
          });
        }

        showToast(`Added ${plotField.name} to ${target.toUpperCase()}-axis`, "success", 2500);
      },
      [getDropValidationError, getNextAutofillTarget, showToast],
    );

    const getComposerSelectionNames = useCallback((): ComposerSelectionSnapshot => {
      const allFields = [...xFields, ...yFields, ...zFields];
      const fieldSources = Array.from(new Set(allFields.map((field) => field.source)));

      const indeps =
        plotType === "HeatMap"
          ? [...xFields, ...yFields].map((field) => field.name)
          : xFields.map((field) => field.name);

      const deps =
        plotType === "HeatMap"
          ? zFields.map((field) => field.name)
          : yFields.map((field) => field.name);

      return {
        plotType,
        indeps,
        deps,
        hasRequiredAxes: xFields.length > 0 && yFields.length > 0,
        hasAnySelections: allFields.length > 0,
        fieldSources,
      };
    }, [plotType, xFields, yFields, zFields]);

    // Handle plot creation by delegating eligibility to Viewer.
    const handleCreatePlot = useCallback(() => {
      const snapshot = getComposerSelectionNames();

      if (!snapshot.hasRequiredAxes) {
        showToast("Select required X and Y fields before plotting.", "warning", 3000);
        return;
      }

      onCreatePlot?.(snapshot);
    }, [getComposerSelectionNames, onCreatePlot, showToast]);

    useImperativeHandle(
      ref,
      () => ({
        setComposerPlotType: (type: PlotType) => setPlotType(type),
        createPlotFromComposer: () => handleCreatePlot(),
        clearComposer: () => clearAllFields(),
        autofillFromField: (field: PlotField) => handleAutofillField(field),
        hasComposerSelections: () => xFields.length > 0 || yFields.length > 0 || zFields.length > 0,
        getComposerSelectionNames,
      }),
      [
        clearAllFields,
        getComposerSelectionNames,
        handleAutofillField,
        handleCreatePlot,
        xFields.length,
        yFields.length,
        zFields.length,
      ],
    );

    const canCreatePlot = xFields.length > 0 && yFields.length > 0;

    const renderDropZone = (
      field: "x" | "y" | "z",
      fields: PlotField[],
      label: string,
      color: string,
      bgColor: string,
    ) => {
      const isActive = dragOverField === field;
      const isInvalid = invalidDropField === field;
      const isDisabled = field === "z" && isZDropzoneDisabled();

      const getColorClasses = (color: string) => {
        const colorMap = {
          blue: {
            border: "border-blue-300 hover:border-blue-400",
            borderActive: "border-blue-500 bg-blue-50",
            borderInvalid: "border-red-500 bg-red-50",
            text: "text-blue-600",
            textMuted: "text-blue-400",
            textHover: "text-blue-500 hover:text-blue-700",
          },
          red: {
            border: "border-red-300 hover:border-red-400",
            borderActive: "border-red-500 bg-red-50",
            borderInvalid: "border-red-500 bg-red-50",
            text: "text-red-600",
            textMuted: "text-red-400",
            textHover: "text-red-500 hover:text-red-700",
          },
          green: {
            border: "border-green-300 hover:border-green-400",
            borderActive: "border-green-500 bg-green-50",
            borderInvalid: "border-red-500 bg-red-50",
            text: "text-green-600",
            textMuted: "text-green-400",
            textHover: "text-green-500 hover:text-green-700",
          },
        };
        return colorMap[color as keyof typeof colorMap] || colorMap.blue;
      };

      const colorClasses = getColorClasses(color);

      const getBorderClass = () => {
        if (isDisabled) return "border-gray-200 bg-gray-100";
        if (isInvalid) return colorClasses.borderInvalid;
        if (isActive) return colorClasses.borderActive;
        return colorClasses.border;
      };

      const getInvalidMessage = () => {
        if (!isInvalid || !draggedFieldType) return null;

        // Universal restriction: X can only have 1 item
        if (field === "x" && xFields.length >= 1) {
          return "X-axis can only have one field";
        }

        // Z-axis only enabled for HeatMap
        if (field === "z" && plotType !== "HeatMap") {
          return "Z-axis is only available for HeatMap plots";
        }

        if (plotType === "LinePlot") {
          if (field === "y" && draggedFieldType === "independent") {
            return "LinePlot Y-axis only accepts dependent variables";
          }
        } else if (plotType === "HeatMap") {
          if (field === "z" && draggedFieldType === "independent") {
            return "HeatMap Z-axis only accepts dependent variables";
          }
        }

        return null;
      };

      const invalidMessage = getInvalidMessage();

      return (
        <div className="flex-1">
          {isDisabled ? (
            <div
              className={`
            flex h-full min-h-16 flex-col p-2 border-2 border-dashed rounded-lg transition-all
            ${getBorderClass()}
            opacity-50 cursor-not-allowed
          `}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="font-semibold text-gray-400">{label}:</span>
              </div>
              <div className="flex flex-1 items-center justify-center text-sm text-gray-400 text-center">
                {plotType === "LinePlot" ? "Only available for HeatMap" : "Disabled"}
              </div>
            </div>
          ) : isInvalid && invalidMessage ? (
            <Tooltip content={invalidMessage} position="top">
              <div
                className={`
                flex h-full min-h-16 flex-col p-2 border-2 border-dashed rounded-lg transition-all
                ${getBorderClass()}
                ${fields.length === 0 ? "bg-gray-50" : bgColor}
                cursor-not-allowed opacity-75
              `}
                onDragOver={(e) => handleDragOver(e, field)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => e.preventDefault()}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className={`font-semibold ${colorClasses.text}`}>{label}:</span>
                  {fields.length > 0 && (
                    <button
                      onClick={() => clearFields(field)}
                      className={`text-xs ${colorClasses.textHover}`}
                      title={`Clear all ${label} fields`}
                    >
                      Clear
                    </button>
                  )}
                </div>

                {fields.length === 0 ? (
                  <div
                    className={`flex flex-1 items-center justify-center text-sm ${colorClasses.textMuted} text-center`}
                  >
                    {field === "x"
                      ? "Drag any field here (max 1)"
                      : field === "y"
                        ? plotType === "LinePlot"
                          ? "Drag dependents here"
                          : "Drag any field here"
                        : "Drag dependents here"}
                  </div>
                ) : (
                  <div className="flex flex-1 flex-wrap content-start gap-2">
                    {fields.map((plotField) => {
                      // Extract the source ID from the plotField ID (format: basketItemId-fieldName)
                      const sourceId = plotField.id.substring(0, plotField.id.lastIndexOf("-"));

                      return (
                        <div
                          key={plotField.id}
                          className={`
                          flex items-center space-x-2 px-3 py-1 rounded-lg text-sm
                          ${
                            plotField.type === "independent"
                              ? "bg-blue-100 text-blue-900"
                              : "bg-red-100 text-red-900"
                          }
                        `}
                        >
                          <Tooltip content={`Source: ${sourceId}`} position="top">
                            <span className="truncate max-w-32">{plotField.name}</span>
                          </Tooltip>
                          <Tooltip content="Remove field" position="top">
                            <button
                              onClick={() => removeField(plotField.id, field)}
                              className="text-gray-500 hover:text-red-600"
                              aria-label={`Remove ${plotField.name} from ${field}-axis`}
                            >
                              <X size={12} />
                            </button>
                          </Tooltip>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </Tooltip>
          ) : (
            <div
              className={`
              flex h-full min-h-16 flex-col p-2 border-2 border-dashed rounded-lg transition-all
              ${getBorderClass()}
              ${fields.length === 0 ? "bg-gray-50" : bgColor}
            `}
              onDragOver={(e) => handleDragOver(e, field)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, field)}
            >
              <div className="flex items-center justify-between mb-2">
                <span className={`font-semibold ${colorClasses.text}`}>{label}:</span>
                {fields.length > 0 && (
                  <button
                    onClick={() => clearFields(field)}
                    className={`text-xs ${colorClasses.textHover}`}
                    title={`Clear all ${label} fields`}
                  >
                    Clear
                  </button>
                )}
              </div>

              {fields.length === 0 ? (
                <div
                  className={`flex flex-1 items-center justify-center text-sm ${colorClasses.textMuted} text-center`}
                >
                  {field === "x"
                    ? "Drag any field here (max 1)"
                    : field === "y"
                      ? plotType === "LinePlot"
                        ? "Drag dependents here"
                        : "Drag any field here"
                      : "Drag dependents here"}
                </div>
              ) : (
                <div className="flex flex-1 flex-wrap content-start gap-2">
                  {fields.map((plotField) => {
                    // Extract the source ID from the plotField ID (format: basketItemId-fieldName)
                    const sourceId = plotField.id.substring(0, plotField.id.lastIndexOf("-"));

                    return (
                      <div
                        key={plotField.id}
                        className={`
                        flex items-center space-x-2 px-3 py-1 rounded-lg text-sm
                        ${
                          plotField.type === "independent"
                            ? "bg-blue-100 text-blue-900"
                            : "bg-red-100 text-red-900"
                        }
                      `}
                      >
                        <Tooltip content={`Source: ${sourceId}`} position="top">
                          <span className="truncate max-w-32">{plotField.name}</span>
                        </Tooltip>
                        <Tooltip content="Remove field" position="top">
                          <button
                            onClick={() => removeField(plotField.id, field)}
                            className="text-gray-500 hover:text-red-600"
                            aria-label={`Remove ${plotField.name} from ${field}-axis`}
                          >
                            <X size={12} />
                          </button>
                        </Tooltip>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      );
    };

    return (
      <div
        className={`bg-white border border-gray-300 rounded-lg shadow-sm ${
          isExpanded ? "flex items-stretch" : ""
        }`}
      >
        {isExpanded && (
          <div className="flex min-w-0 flex-1 flex-col p-2">
            {selectionContextLabel && (
              <div className="mb-2 flex">
                <span className="truncate rounded border border-gray-200 bg-gray-50 px-2 py-0.5 text-[11px] text-gray-600">
                  {selectionContextLabel}
                </span>
              </div>
            )}
            {/* X, Y, Z Axes - Side by side layout */}
            <div className="flex min-h-0 flex-1 gap-3">
              {/* X Axis */}
              {renderDropZone("x", xFields, "X-Axis", "blue", "bg-blue-50")}

              {/* Y Axis */}
              {renderDropZone("y", yFields, "Y-Axis", "red", "bg-red-50")}

              {/* Z Axis (optional) */}
              {renderDropZone("z", zFields, "Z-Axis", "green", "bg-green-50")}
            </div>
          </div>
        )}
        <SectionRibbon
          label="Composer"
          Icon={ListMusic}
          orientation={isExpanded ? "vertical" : "horizontal"}
        >
          {/* Plot type: icon-only in the ribbon, dropdown opens to the left */}
          <div className="relative">
            <Tooltip content={`Plot type: ${plotType}`} position="left">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setIsPlotTypeDropdownOpen(!isPlotTypeDropdownOpen);
                }}
                className={ribbonButtonClass}
                aria-label={`Plot type: ${plotType}`}
              >
                {getPlotTypeIcon(plotType)}
              </button>
            </Tooltip>

            {isPlotTypeDropdownOpen && (
              <div className="absolute right-full top-0 mr-1 w-36 bg-white border border-gray-300 rounded-lg shadow-lg z-20">
                <div className="py-1">
                  {(["HeatMap", "LinePlot"] as PlotType[]).map((type) => (
                    <button
                      key={type}
                      onClick={(e) => {
                        e.stopPropagation();
                        setPlotType(type);
                        setIsPlotTypeDropdownOpen(false);
                      }}
                      className={`w-full flex items-center space-x-2 px-3 py-2 text-sm transition-colors ${
                        plotType === type
                          ? "bg-blue-100 text-blue-900"
                          : "hover:bg-gray-100 text-gray-700"
                      }`}
                    >
                      {getPlotTypeIcon(type)}
                      <span>{type}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <Tooltip content="Plot" position="left">
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleCreatePlot();
              }}
              disabled={!canCreatePlot}
              className={`flex h-7 w-7 items-center justify-center rounded transition-colors ${
                canCreatePlot
                  ? "bg-blue-600 text-white hover:bg-blue-700"
                  : "bg-gray-300 text-gray-500 cursor-not-allowed"
              }`}
              aria-label="Plot"
            >
              <Play size={16} />
            </button>
          </Tooltip>

          <Tooltip content="Clear all axes (Alt+Shift+C)" position="left">
            <button
              onClick={(e) => {
                e.stopPropagation();
                clearAllFields();
              }}
              disabled={xFields.length === 0 && yFields.length === 0 && zFields.length === 0}
              className={`${ribbonButtonClass} text-red-600 hover:text-red-800`}
              aria-label="Clear all axes"
            >
              <Trash2 size={16} />
            </button>
          </Tooltip>

          <Tooltip
            content={`${isExpanded ? "Collapse composer" : "Expand composer"} (Alt+C)`}
            position="left"
          >
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className={ribbonButtonClass}
              aria-label={isExpanded ? "Collapse composer" : "Expand composer"}
            >
              {isExpanded ? (
                <EyeOff size={16} className="text-red-600" />
              ) : (
                <Eye size={16} className="text-green-600" />
              )}
            </button>
          </Tooltip>
        </SectionRibbon>
      </div>
    );
  },
);

PlotComposer.displayName = "PlotComposer";

export default PlotComposer;

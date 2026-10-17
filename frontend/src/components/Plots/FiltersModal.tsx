import React, { useState, useEffect, useRef } from "react";
import {
  X,
  RotateCcw,
  Download,
  Upload,
  Sliders,
  Gauge,
  ChartSpline,
  Rotate3D,
  ChartColumn,
  ChartGantt,
  SlidersHorizontal,
  ChartLine,
  Contrast,
  FlipHorizontal,
  Info,
  MoveHorizontal,
  Ruler,
  AlertTriangle,
  ListOrdered,
  Crosshair,
  Zap,
  Bookmark,
} from "lucide-react";
import { createPortal } from "react-dom";
import { Rnd } from "react-rnd";
import { fitToWindow, useKeepRndInWindow } from "../../utils/keepInWindow";

// Local imports
import "./FiltersModal.css";
import { useToast } from "../../hooks/useToast";
import NumericInput from "../NumericInput";
import type { FilterSettings, AppliedFilter, SliderConfig } from "../../components/interfaces";
import {
  sliderIndexOf,
  sliderSteps,
  sliderText,
  sliderValueAt,
  visibleSliders,
} from "../../utils/sliders";
import { ApplyButton, formatTitleWithUUID, getPlotTypeIcon, LogChartIcon } from "./UtilComponents";
import Tooltip from "../Tooltip";
import RadialDial from "./RadialDial";
import AppliedFilterOrder from "./AppliedFilterOrder";
import { FILTER_LABELS } from "../../utils/filterNames";
import TexMath from "../TexMath";
import { AppliedPreset, SavedPresets } from "./FilterPresets";
import { presetSummary } from "../../utils/filterPresets";
import type { FilterPreset } from "../../services/libraryAPI";
import { useFilterPresetsStore } from "../../stores/filterPresetsStore";
import { useLibraryStore } from "../../stores/libraryStore";

type BGCorrPoint = {
  x: number;
  y: number;
  z?: number;
  row_idx?: number;
  col_idx?: number;
};

interface FiltersModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Apply filters and optionally update their preset link. */
  onApplyFilters: (
    filters: AppliedFilter[],
    sliders?: Record<string, SliderConfig>,
    link?: { presetId: number | null },
  ) => void;
  /** Preset linked to the current filters. */
  presetId?: number | null;
  /** Set or clear the current preset link. */
  onPresetLinkChange?: (presetId: number | null) => void;
  plotType?: string;
  plotTitle?: string;
  currentFilters: AppliedFilter[];
  currentSliders?: Record<string, SliderConfig>;
  availableSliders?: Record<string, SliderConfig>;
  onRequestBGCorr?: (mode: string) => void;
  /** Whether x contains measured data instead of an ordered sweep. */
  xAxisIsMeasured?: boolean;
}

// Keep in step with _NEEDS_A_SWEPT_X in backend/api/filters.py.
const NEEDS_A_SWEPT_X: Record<string, string> = {
  diff: "Differentiation needs the step between swept X values.",
  savgol: "Savitzky–Golay smoothing needs evenly spaced swept X values.",
  sma: "Moving average needs points ordered along a swept X axis.",
  polyfit: "Polynomial fit needs a swept X axis.",
};

// Filter categories and their available filters
const FILTER_CATEGORIES = {
  "1d": [
    "diff",
    "savgol",
    "sma",
    "normalize",
    "log_scale",
    "transform",
    "polyfit",
    "bg_corr_constant",
    "bg_corr_linear",
  ],
  "2d": [
    "flip",
    "diff_x",
    "diff_y",
    "savgol",
    "normalize",
    "gamma_corr",
    "log_corr",
    "sig_corr",
    "rescale_intensity",
    "bg_corr_constant",
    "bg_corr_row_mean",
    "bg_corr_col_mean",
    "bg_corr_plane",
    "log_scale",
    "transform",
    "r_in_correction",
    "rotate",
  ],
};

// Filter definitions with icons and descriptions
const FILTER_DEFINITIONS = {
  diff: {
    name: FILTER_LABELS.diff,
    icon: ChartGantt,
    description: "Calculate the derivative of the data",
  },
  diff_y: {
    name: FILTER_LABELS.diff_y,
    icon: ChartColumn,
    description: "Differentiate along X-axis",
  },
  diff_x: {
    name: FILTER_LABELS.diff_x,
    icon: ChartGantt,
    description: "Differentiate along Y-axis",
  },
  log_scale: {
    name: FILTER_LABELS.log_scale,
    icon: LogChartIcon,
    description: "Apply logarithmic scaling to axis",
  },
  savgol: {
    name: FILTER_LABELS.savgol,
    icon: ChartSpline,
    description: "Smooth data using Savitzky-Golay filter",
  },
  sma: {
    name: FILTER_LABELS.sma,
    icon: ChartSpline,
    description: "Smooth data using simple moving average",
  },
  normalize: {
    name: FILTER_LABELS.normalize,
    icon: SlidersHorizontal,
    description: "Normalize data along specified axis",
  },
  polyfit: {
    name: FILTER_LABELS.polyfit,
    icon: ChartLine,
    description: "Fit a polynomial to the line plot",
  },
  transform: {
    name: FILTER_LABELS.transform,
    icon: Ruler,
    description: "Scale or invert Y/Z data with smart unit handling",
  },
  r_in_correction: {
    name: FILTER_LABELS.r_in_correction,
    icon: Zap,
    description: "Correct bias for the voltage drop across an inline resistance",
  },
  rotate: {
    name: FILTER_LABELS.rotate,
    icon: Rotate3D,
    description: "Rotate heatmap by specified angle. Use mouse/arrow keys to adjust angle.",
  },
  flip: {
    name: FILTER_LABELS.flip,
    icon: FlipHorizontal,
    description: "Invert the color scale by multiplying Z-axis data by -1",
  },
  gamma_corr: {
    name: FILTER_LABELS.gamma_corr,
    icon: Contrast,
    description: "Apply gamma correction to enhance contrast",
  },
  log_corr: {
    name: FILTER_LABELS.log_corr,
    icon: LogChartIcon,
    description: "Apply logarithmic correction",
  },
  sig_corr: {
    name: FILTER_LABELS.sig_corr,
    icon: Gauge,
    description: "Apply sigmoid correction for enhanced dynamic range",
  },
  rescale_intensity: {
    name: FILTER_LABELS.rescale_intensity,
    icon: Sliders,
    description: "Rescale intensity values to full range",
  },
  bg_corr_constant: {
    name: FILTER_LABELS.bg_corr_constant,
    icon: Crosshair,
    description: "Subtract a constant offset baseline",
  },
  bg_corr_linear: {
    name: FILTER_LABELS.bg_corr_linear,
    icon: Crosshair,
    description: "Subtract a linear baseline",
  },
  bg_corr_row_mean: {
    name: FILTER_LABELS.bg_corr_row_mean,
    icon: Crosshair,
    description: "Subtract the mean of a selected row",
  },
  bg_corr_col_mean: {
    name: FILTER_LABELS.bg_corr_col_mean,
    icon: Crosshair,
    description: "Subtract the mean of a selected column",
  },
  bg_corr_plane: {
    name: FILTER_LABELS.bg_corr_plane,
    icon: Crosshair,
    description: "Subtract a plane defined by 3 points",
  },
};

// Typeset the R_in label; other labels are plain text.
const filterTitle = (key: string): React.ReactNode =>
  key === "r_in_correction" ? (
    <>
      <TexMath tex="R_\mathrm{in}" fallback="R_in" /> Correction
    </>
  ) : (
    FILTER_DEFINITIONS[key as keyof typeof FILTER_DEFINITIONS].name
  );

// Default filter options
const DEFAULT_FILTER_OPTIONS = {
  log_scale: {
    enabled: false,
  },
  savgol: {
    enabled: false,
    window: 5,
    polyorder: 2,
    axis: 0,
    deriv: 0,
    delta: 1.0,
    mode: "interp",
    cval: 0.0,
  },
  sma: {
    enabled: false,
    window: 5,
  },
  normalize: {
    enabled: false,
    axis: "z",
  },
  gamma_corr: {
    enabled: false,
    gamma: 2.0,
    gain: 2.0,
  },
  log_corr: {
    enabled: false,
    gain: 1.0,
    inv: false,
  },
  sig_corr: {
    enabled: false,
    cutoff: 0.5,
    gain: 10.0,
  },
  rescale_intensity: {
    enabled: false,
    in_range: "image",
  },

  polyfit: {
    enabled: false,
    deg: 2,
    window: [0, 1],
  },
  transform: {
    enabled: false,
    operation: "multiply",
    factor: 1,
    factor_unit: "",
    result_unit: "",
    result_label: "",
  },
  rotate: {
    enabled: false,
    angle: 0,
  },
  r_in_correction: {
    enabled: false,
    r_in: 0,
    r_in_unit: "kΩ",
    bias_axis: "x",
  },
  bg_corr_constant: {
    enabled: false,
    mode: "constant",
    points: [],
  },
  bg_corr_linear: {
    enabled: false,
    mode: "linear",
    points: [],
  },
  bg_corr_row_mean: {
    enabled: false,
    mode: "row_mean",
    points: [],
  },
  bg_corr_col_mean: {
    enabled: false,
    mode: "col_mean",
    points: [],
  },
  bg_corr_plane: {
    enabled: false,
    mode: "plane",
    points: [],
  },
};

const settingsFromAppliedFilters = (
  currentFilters: AppliedFilter[],
  previous: FilterSettings = {},
): { settings: FilterSettings; order: string[] } => {
  const settings: FilterSettings = {};
  for (const [key, config] of Object.entries(previous)) {
    (settings as Record<string, unknown>)[key] =
      config && typeof config === "object"
        ? { ...(config as Record<string, unknown>), enabled: false }
        : false;
  }

  const order: string[] = [];
  for (const filter of currentFilters) {
    order.push(filter.name);
    if (typeof filter.options === "object" && filter.options !== null) {
      const existing = settings[filter.name as keyof FilterSettings];
      (settings as Record<string, unknown>)[filter.name] = {
        ...(existing && typeof existing === "object" ? existing : {}),
        enabled: true,
        ...filter.options,
      };
    } else {
      (settings as Record<string, unknown>)[filter.name] = true;
    }
  }
  return { settings, order };
};

// z-index manager shared across modals
const getNextGlobalModalZ = (): number => {
  if (typeof window === "undefined") return 2000;
  const w = window as unknown as { __qimchi_modal_z?: number };
  if (!w.__qimchi_modal_z) w.__qimchi_modal_z = 2000;
  w.__qimchi_modal_z = (w.__qimchi_modal_z || 2000) + 1;
  return w.__qimchi_modal_z;
};

const FiltersModal: React.FC<FiltersModalProps> = ({
  isOpen,
  onClose,
  onApplyFilters,
  presetId = null,
  onPresetLinkChange,
  plotType = "line",
  plotTitle,
  currentFilters,
  currentSliders = {},
  availableSliders = {},
  onRequestBGCorr,
  xAxisIsMeasured = false,
}) => {
  const initialFilters = useRef(settingsFromAppliedFilters(currentFilters));
  const [localFilterSettings, setLocalFilterSettings] = useState<FilterSettings>(
    initialFilters.current.settings,
  );
  const [filterOrder, setFilterOrder] = useState<string[]>(initialFilters.current.order);

  // Slider state
  const [localSliders, setLocalSliders] = useState<Record<string, SliderConfig>>(currentSliders);

  // Sync localSliders with currentSliders when they change from parent
  useEffect(() => {
    setLocalSliders(currentSliders);
  }, [currentSliders]);

  // Get filter keys relevant to plotType, plus sliders if available
  const filterKeys = Object.keys(FILTER_DEFINITIONS).filter((key) => {
    if (plotType === "heatmap") {
      return FILTER_CATEGORIES["2d"].includes(key);
    }
    return FILTER_CATEGORIES["1d"].includes(key);
  });

  // Add sliders as a tab if there are any available - put it at the top
  const hasSliders = Object.keys(availableSliders).length > 0;
  const allTabs = [...(hasSliders ? ["sliders"] : []), "applied", "presets", ...filterKeys];

  const dbAvailable = useLibraryStore((state) => state.dbAvailable);
  const presets = useFilterPresetsStore((state) => state.presets);
  const presetsError = useFilterPresetsStore((state) => state.error);
  const linkedPreset = presets?.find((preset) => preset.id === presetId) ?? null;
  const presetsUnavailable = dbAvailable
    ? null
    : "Presets are saved in the library database, which is unavailable this session.";

  const unavailableReason = (key: string): string | null =>
    xAxisIsMeasured && NEEDS_A_SWEPT_X[key]
      ? `Unavailable for this plot. ${NEEDS_A_SWEPT_X[key]} Here, X is measured data.`
      : null;

  const [activeTab, setActiveTab] = useState<string>(
    hasSliders ? "sliders" : filterKeys[0] || "diff",
  );
  const [isDragging, setIsDragging] = useState(false);

  // Debounce ref to prevent excessive API calls
  const debounceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Separate debounce ref for sliders (shorter delay for better responsiveness)
  const sliderDebounceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { showToast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // z-index state for stacking multiple open modals
  const [zIndexLocal, setZIndexLocal] = useState<number | undefined>(undefined);
  const zRef = useRef<number | undefined>(undefined);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const rndRef = useRef<Rnd>(null);
  useKeepRndInWindow(rndRef, isOpen, 300, 240);

  useEffect(() => {
    if (isOpen) {
      const next = getNextGlobalModalZ();
      zRef.current = next;
      setZIndexLocal(next);
    }
  }, [isOpen]);

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

  // Sync parent state only while closed. While open, local edits may be newer
  // than an in-flight request's response.
  useEffect(() => {
    if (isOpen) return;
    setLocalFilterSettings((prevSettings) => {
      const synced = settingsFromAppliedFilters(currentFilters, prevSettings);
      setFilterOrder(synced.order);
      return synced.settings;
    });
  }, [currentFilters, isOpen]);

  useEffect(() => {
    if (isOpen) {
      setLocalSliders(visibleSliders(availableSliders, currentSliders));
    }
  }, [isOpen, currentSliders, availableSliders]);

  const updateFilterSetting = (filterKey: string, setting: string, value: unknown) => {
    setLocalFilterSettings((prev) => {
      const newSettings = { ...prev };
      const existing = newSettings[filterKey as keyof FilterSettings];
      if (!existing || typeof existing !== "object") {
        const defaultOptions =
          DEFAULT_FILTER_OPTIONS[filterKey as keyof typeof DEFAULT_FILTER_OPTIONS];
        (newSettings as Record<string, unknown>)[filterKey] = {
          ...defaultOptions,
          enabled: false, // Start disabled when creating new config
        };
      } else {
        (newSettings as Record<string, unknown>)[filterKey] = { ...existing };
      }
      const filterConfig = (newSettings as Record<string, Record<string, unknown>>)[filterKey];
      if (filterConfig && typeof filterConfig === "object") {
        filterConfig[setting] = value;
      }

      // Toggling enabled is applied by the toggle handler.
      if (setting !== "enabled") {
        const filter = newSettings[filterKey as keyof FilterSettings];
        const isEnabled =
          typeof filter === "boolean"
            ? filter
            : filter && typeof filter === "object" && "enabled" in filter
              ? Boolean((filter as Record<string, unknown>).enabled)
              : false;

        if (isEnabled) {
          // Use debounced application with the updated settings
          setTimeout(() => {
            debouncedApplyFilters(newSettings);
          }, 0);
        }
      }

      return newSettings;
    });
  };

  const toggleFilter = (filterKey: string) => {
    const wasEnabled = isFilterEnabled(filterKey);

    // Build the new filter list immediately based on current state and toggle action
    const appliedFilters: AppliedFilter[] = [];

    // Keep configured filters in the list so they can be switched back on there.
    let newOrder: string[];
    if (!wasEnabled) {
      newOrder = filterOrder.includes(filterKey) ? filterOrder : [...filterOrder, filterKey];
    } else {
      newOrder = filterOrder;
    }

    // Build applied filters based on new order
    newOrder.forEach((fKey) => {
      // For the filter being toggled, we know its new state
      // For other filters, check their current state
      const shouldInclude = fKey === filterKey ? !wasEnabled : isFilterEnabled(fKey);

      if (shouldInclude) {
        const filterConfig = localFilterSettings[fKey as keyof FilterSettings];

        if (typeof filterConfig === "boolean" && filterConfig) {
          appliedFilters.push({
            name: fKey,
            options: {},
          });
        } else if (filterConfig && typeof filterConfig === "object" && "enabled" in filterConfig) {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { enabled, ...options } = filterConfig as Record<string, unknown>;
          appliedFilters.push({
            name: fKey,
            options,
          });
        } else if (fKey === filterKey && !wasEnabled) {
          // Handle the case where we're enabling a filter that wasn't configured yet
          // First check if we have existing settings for this filter (even if disabled)
          const existingConfig = localFilterSettings[fKey as keyof FilterSettings];
          if (existingConfig && typeof existingConfig === "object" && "enabled" in existingConfig) {
            // Use existing configuration, just re-enabling it
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { enabled, ...options } = existingConfig as Record<string, unknown>;
            appliedFilters.push({
              name: fKey,
              options,
            });
          } else {
            // No existing config, use defaults
            const defaultOptions =
              DEFAULT_FILTER_OPTIONS[fKey as keyof typeof DEFAULT_FILTER_OPTIONS];
            if (defaultOptions) {
              // eslint-disable-next-line @typescript-eslint/no-unused-vars
              const { enabled, ...options } = defaultOptions;
              appliedFilters.push({
                name: fKey,
                options,
              });
            } else {
              appliedFilters.push({
                name: fKey,
                options: {},
              });
            }
          }
        }
      }
    });

    onApplyFilters(appliedFilters);

    setLocalFilterSettings((prev) => {
      const newSettings = { ...prev };
      const filterConfig = newSettings[filterKey as keyof FilterSettings];

      if (filterConfig && typeof filterConfig === "object" && "enabled" in filterConfig) {
        (newSettings as Record<string, unknown>)[filterKey] = {
          ...(filterConfig as Record<string, unknown>),
          enabled: !(filterConfig as Record<string, unknown>).enabled,
        };
      } else if (typeof filterConfig === "boolean") {
        (newSettings as Record<string, unknown>)[filterKey] = !filterConfig;
      } else {
        // Preserve existing options when enabling the filter.
        const defaultOptions =
          DEFAULT_FILTER_OPTIONS[filterKey as keyof typeof DEFAULT_FILTER_OPTIONS];
        (newSettings as Record<string, unknown>)[filterKey] = {
          ...defaultOptions,
          enabled: !wasEnabled,
        };
      }

      return newSettings;
    });

    // Update filter order
    setFilterOrder(newOrder);
  };

  // Apply filters directly from user actions, not a state-watching effect.

  const isFilterEnabled = (filterKey: string): boolean => {
    const filter = localFilterSettings[filterKey as keyof FilterSettings];
    const enabled =
      typeof filter === "boolean"
        ? filter
        : filter && typeof filter === "object" && "enabled" in filter
          ? Boolean((filter as Record<string, unknown>).enabled)
          : false;

    return enabled;
  };

  // Debounced filter application to prevent excessive API calls
  const debouncedApplyFilters = (updatedSettings: FilterSettings) => {
    // Clear existing timeout
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
    }

    // Set new timeout
    debounceTimeoutRef.current = setTimeout(() => {
      const appliedFilters: AppliedFilter[] = [];

      // Build applied filters based on current filter order and updated settings
      filterOrder.forEach((fKey) => {
        const filterConfig = updatedSettings[fKey as keyof FilterSettings];
        const filterEnabled =
          typeof filterConfig === "boolean"
            ? filterConfig
            : filterConfig && typeof filterConfig === "object" && "enabled" in filterConfig
              ? Boolean((filterConfig as Record<string, unknown>).enabled)
              : false;

        if (filterEnabled) {
          if (typeof filterConfig === "boolean" && filterConfig) {
            appliedFilters.push({
              name: fKey,
              options: {},
            });
          } else if (
            filterConfig &&
            typeof filterConfig === "object" &&
            "enabled" in filterConfig
          ) {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { enabled, ...options } = filterConfig as Record<string, unknown>;
            appliedFilters.push({
              name: fKey,
              options,
            });
          }
        }
      });

      // For filter-only changes, don't pass sliders to avoid triggering slider path
      onApplyFilters(appliedFilters);
    }, 100); // Balanced debounce - responsive but not too rapid
  };

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
      if (sliderDebounceTimeoutRef.current) {
        clearTimeout(sliderDebounceTimeoutRef.current);
      }
    };
  }, []);

  const handleReset = () => {
    const resetSettings: FilterSettings = {};
    setLocalFilterSettings(resetSettings);
    setFilterOrder([]);
    // Don't reset sliders - they have their own reset functionality
    onApplyFilters([], localSliders); // Apply empty filters but keep current sliders
    // NOTE: Don't show toast here - PlotWrapper will show appropriate message
  };

  // Slider utility functions
  const updateSliderValue = (key: string, value: number) => {
    const updatedSliders = {
      ...localSliders,
      [key]: {
        ...localSliders[key],
        value: value,
      },
    };
    setLocalSliders(updatedSliders);

    // Apply changes with light debouncing for sliders to prevent excessive API calls
    // while maintaining good responsiveness
    if (sliderDebounceTimeoutRef.current) {
      clearTimeout(sliderDebounceTimeoutRef.current);
    }

    sliderDebounceTimeoutRef.current = setTimeout(() => {
      const appliedFilters = buildAppliedFilters();
      onApplyFilters(appliedFilters, updatedSliders);
    }, 50);
  };

  const resetSlider = (key: string) => {
    if (availableSliders[key]) {
      const updatedSliders = {
        ...localSliders,
        [key]: {
          ...localSliders[key],
          value: availableSliders[key].min,
        },
      };
      setLocalSliders(updatedSliders);

      const appliedFilters = buildAppliedFilters();
      onApplyFilters(appliedFilters, updatedSliders);
    }
  };

  const resetAllSliders = () => {
    const resetSliders: Record<string, SliderConfig> = {};
    Object.keys(localSliders).forEach((key) => {
      if (availableSliders[key]) {
        resetSliders[key] = {
          ...localSliders[key],
          value: availableSliders[key].min,
        };
      }
    });
    setLocalSliders(resetSliders);

    const appliedFilters = buildAppliedFilters();
    onApplyFilters(appliedFilters, resetSliders);
  };

  // Helper function to build applied filters from current state
  const buildAppliedFilters = (order: string[] = filterOrder): AppliedFilter[] => {
    const appliedFilters: AppliedFilter[] = [];

    order.forEach((fKey) => {
      const filterConfig = localFilterSettings[fKey as keyof FilterSettings];
      const filterEnabled =
        typeof filterConfig === "boolean"
          ? filterConfig
          : filterConfig && typeof filterConfig === "object" && "enabled" in filterConfig
            ? Boolean((filterConfig as Record<string, unknown>).enabled)
            : false;

      if (filterEnabled) {
        if (typeof filterConfig === "boolean" && filterConfig) {
          appliedFilters.push({
            name: fKey,
            options: {},
          });
        } else if (filterConfig && typeof filterConfig === "object" && "enabled" in filterConfig) {
          const options = Object.fromEntries(
            Object.entries(filterConfig as Record<string, unknown>).filter(
              ([key]) => key !== "enabled",
            ),
          ) as Record<string, string | number | boolean | Record<string, unknown>>;
          appliedFilters.push({
            name: fKey,
            options,
          });
        }
      }
    });

    return appliedFilters;
  };

  const appliedOrder = filterOrder.filter((key) => isFilterEnabled(key));

  const removeFilter = (filterKey: string) => {
    const nextOrder = filterOrder.filter((key) => key !== filterKey);
    const nextSettings = { ...localFilterSettings };
    const filterConfig = nextSettings[filterKey as keyof FilterSettings];
    (nextSettings as Record<string, unknown>)[filterKey] =
      filterConfig && typeof filterConfig === "object"
        ? { ...(filterConfig as Record<string, unknown>), enabled: false }
        : false;
    setLocalFilterSettings(nextSettings);
    setFilterOrder(nextOrder);
    onApplyFilters(buildAppliedFilters(nextOrder));
  };

  useEffect(() => {
    if (isOpen && dbAvailable) void useFilterPresetsStore.getState().load();
  }, [isOpen, dbAvailable]);

  // Clear links to presets removed from another panel.
  useEffect(() => {
    if (presets && presetId !== null && !presets.some((preset) => preset.id === presetId)) {
      onPresetLinkChange?.(null);
    }
  }, [presets, presetId, onPresetLinkChange]);

  const presetUnusableReason = (preset: FilterPreset): string | null => {
    const missing = preset.filters.filter((filter) => !filterKeys.includes(filter.name));
    if (missing.length === 0) return null;
    const kind = plotType === "heatmap" ? "heat maps" : "line plots";
    return `${presetSummary(missing)} ${missing.length === 1 ? "isn't" : "aren't"} available for ${kind}.`;
  };

  const applyPreset = (preset: FilterPreset) => {
    const filters: AppliedFilter[] = preset.filters.map((filter) => ({
      name: filter.name,
      options: filter.options ?? {},
    }));
    const { settings, order } = settingsFromAppliedFilters(filters, localFilterSettings);
    setLocalFilterSettings(settings);
    setFilterOrder(order);
    onApplyFilters(filters, localSliders, { presetId: preset.id });
    showToast(`Applied \u201c${preset.name}\u201d`, "success");
  };

  const saveNewPreset = async (name: string): Promise<string | null> => {
    const result = await useFilterPresetsStore.getState().create(name, buildAppliedFilters());
    if (!result.preset) return result.error;
    onPresetLinkChange?.(result.preset.id);
    showToast(`Saved \u201c${result.preset.name}\u201d`, "success");
    return null;
  };

  const replacePresetFilters = async (target: FilterPreset): Promise<string | null> => {
    const result = await useFilterPresetsStore
      .getState()
      .update(target.id, { filters: buildAppliedFilters() }, "The preset could not be saved.");
    if (!result.preset) return result.error;
    onPresetLinkChange?.(result.preset.id);
    showToast(`Updated \u201c${result.preset.name}\u201d`, "success");
    return null;
  };

  const renamePreset = async (target: FilterPreset, name: string): Promise<string | null> => {
    if (name === target.name) return null;
    const result = await useFilterPresetsStore
      .getState()
      .update(target.id, { name }, "The preset could not be renamed.");
    return result.preset ? null : result.error;
  };

  const removePreset = (target: FilterPreset) => useFilterPresetsStore.getState().remove(target.id);

  // Reorder enabled filters without discarding settings for disabled filters.
  const reorderFilters = (order: string[]) => {
    const next = [...order, ...filterOrder.filter((key) => !order.includes(key))];
    setFilterOrder(next);
    onApplyFilters(buildAppliedFilters(next));
  };

  const handleExport = () => {
    const exportData = {
      plotType,
      plotTitle: plotTitle || "Plot",
      filterSettings: localFilterSettings,
      currentFilters,
      timestamp: new Date().toISOString(),
    };

    const dataStr = JSON.stringify(exportData, null, 2);
    const dataUri = "data:application/json;charset=utf-8," + encodeURIComponent(dataStr);

    const sanitizeFilename = (str: string) => str.replace(/[^a-z0-9-_]/gi, "_").substring(0, 50);
    const titleForFilename = plotTitle ? sanitizeFilename(plotTitle) : "plot";
    const exportFileDefaultName = `${
      new Date().toISOString().split("T")[0]
    }-${plotType}-${titleForFilename}-filters.json`;

    const linkElement = document.createElement("a");
    linkElement.setAttribute("href", dataUri);
    linkElement.setAttribute("download", exportFileDefaultName);
    linkElement.click();
  };

  const handleImportFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        const importedData = JSON.parse(content);

        if (!importedData.filterSettings) {
          showToast("Invalid filter file: missing filterSettings", "error");
          return;
        }

        setLocalFilterSettings(importedData.filterSettings);

        // Update filter order based on imported settings
        const enabledFilters: string[] = [];
        Object.entries(importedData.filterSettings).forEach(([key, config]) => {
          if (typeof config === "boolean" && config) {
            enabledFilters.push(key);
          } else if (
            config &&
            typeof config === "object" &&
            "enabled" in config &&
            Boolean((config as Record<string, unknown>).enabled)
          ) {
            enabledFilters.push(key);
          }
        });
        setFilterOrder(enabledFilters);

        // Apply the imported filters
        const appliedFilters: AppliedFilter[] = [];
        enabledFilters.forEach((filterKey) => {
          const filterConfig = importedData.filterSettings[filterKey];

          if (typeof filterConfig === "boolean" && filterConfig) {
            appliedFilters.push({
              name: filterKey,
              options: {},
            });
          } else if (
            filterConfig &&
            typeof filterConfig === "object" &&
            "enabled" in filterConfig
          ) {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { enabled, ...options } = filterConfig as Record<string, unknown>;
            appliedFilters.push({
              name: filterKey,
              options,
            });
          }
        });
        onApplyFilters(appliedFilters, localSliders);

        const sourcePlot = importedData.plotTitle ? ` from "${importedData.plotTitle}"` : "";
        showToast(`Filters imported successfully${sourcePlot}`, "success");
      } catch (error) {
        console.error("Error importing filters:", error);
        showToast("Error parsing filter file. Please check the file format.", "error");
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
      showToast("Please drop a JSON filter file", "error");
    }
  };

  if (!isOpen) return null;

  // Render in <body> to avoid clipping or transforms inherited from the plot tile.
  return createPortal(
    <div ref={wrapperRef} className="fixed inset-0 pointer-events-none">
      <Rnd
        ref={rndRef}
        default={fitToWindow(
          {
            // Open in the bottom-right corner.
            x: window.innerWidth - 620,
            y: window.innerHeight - 578,
            width: 600,
            height: 550,
          },
          300,
          240,
        )}
        enableResizing={false}
        dragHandleClassName="drag-handle"
        bounds="parent"
        style={{ pointerEvents: "auto" }}
        onMouseDown={() => bringToFront()}
        onPointerDown={() => bringToFront()}
      >
        <div
          data-tour="filters-panel"
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
                {formatTitleWithUUID(plotTitle || "Plot", 25)}
              </h2>
            </div>
            <div className="flex items-center gap-1">
              <Tooltip content="Reset filters (not sliders)" position="bottom">
                <button
                  onClick={handleReset}
                  className="p-1.5 rounded hover:bg-gray-300 transition-colors"
                  title="Reset filters (not sliders)"
                  aria-label="Reset filters (not sliders)"
                >
                  <RotateCcw size={16} />
                </button>
              </Tooltip>
              <Tooltip content="Export filters" position="bottom">
                <button
                  onClick={handleExport}
                  className="p-1.5 rounded hover:bg-gray-300 transition-colors"
                  title="Export filters"
                  aria-label="Export filters"
                >
                  <Upload size={16} />
                </button>
              </Tooltip>
              <Tooltip content="Import filters" position="bottom">
                <button
                  onClick={handleImportClick}
                  className="p-1.5 rounded hover:bg-gray-300 transition-colors"
                  title="Import filters"
                  aria-label="Import filters"
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
                aria-label="Import filter file"
              />
              <Tooltip content="Close modal" position="bottom">
                <button
                  onClick={onClose}
                  className="p-1.5 rounded hover:bg-gray-300 transition-colors"
                  title="Close modal"
                  aria-label="Close modal"
                >
                  <X size={16} className="text-red-600" />
                </button>
              </Tooltip>
            </div>
          </div>

          {/* Two-column layout */}
          <div className="flex flex-1 min-h-0">
            {/* Left Column - Filter List */}
            <div className="w-2/5 border-r-2 border-gray-300 bg-gray-50 flex flex-col">
              <div className="flex-1 overflow-y-auto" role="tablist">
                {allTabs.map((key) => {
                  if (key === "applied") {
                    return (
                      <button
                        key={key}
                        onClick={() => setActiveTab(key)}
                        // Use the section-tab style rather than the individual-filter style.
                        className={`w-full px-3 py-2.5 text-sm font-medium transition-colors flex items-center gap-2 border-b-2 border-gray-300 ${
                          activeTab === key
                            ? "text-blue-600 bg-blue-50 border-l-4 border-l-blue-600 shadow-inner dark:text-blue-300 dark:border-l-blue-400"
                            : "qimchi-dark-hover-plain text-blue-700 hover:text-blue-800 hover:bg-blue-50 bg-linear-to-r from-blue-50 to-sky-50 border-l-2 border-l-blue-300 dark:from-blue-950/50 dark:to-sky-950/30 dark:text-blue-300 dark:hover:text-blue-200 dark:border-l-blue-700"
                        }`}
                        aria-controls={`tab-panel-${key}`}
                        role="tab"
                      >
                        <ListOrdered
                          size={18}
                          className={
                            appliedOrder.length > 0
                              ? "text-blue-600 dark:text-blue-300"
                              : "text-blue-400 dark:text-blue-500"
                          }
                        />
                        <span className="text-left flex-1 font-semibold">Applied</span>
                        {appliedOrder.length > 0 && (
                          <span className="rounded-full bg-blue-600 px-1.5 text-[0.625rem] font-bold text-white">
                            {appliedOrder.length}
                          </span>
                        )}
                      </button>
                    );
                  }

                  if (key === "presets") {
                    return (
                      <button
                        key={key}
                        onClick={() => setActiveTab(key)}
                        className={`w-full px-3 py-2.5 text-sm font-medium transition-colors flex items-center gap-2 border-b-2 border-gray-300 ${
                          activeTab === key
                            ? "text-blue-600 bg-blue-50 border-l-4 border-l-blue-600 shadow-inner dark:text-blue-300 dark:border-l-blue-400"
                            : "qimchi-dark-hover-plain text-blue-700 hover:text-blue-800 hover:bg-blue-50 bg-linear-to-r from-blue-50 to-sky-50 border-l-2 border-l-blue-300 dark:from-blue-950/50 dark:to-sky-950/30 dark:text-blue-300 dark:hover:text-blue-200 dark:border-l-blue-700"
                        }`}
                        aria-controls={`tab-panel-${key}`}
                        role="tab"
                      >
                        <Bookmark size={18} className="text-blue-600 dark:text-blue-300" />
                        <span className="text-left flex-1 font-semibold">Saved Presets</span>
                        {presets && presets.length > 0 && (
                          <span className="rounded-full bg-blue-600 px-1.5 text-[0.625rem] font-bold text-white">
                            {presets.length}
                          </span>
                        )}
                      </button>
                    );
                  }

                  if (key === "sliders") {
                    // Special handling for sliders tab
                    const hasActiveSliders = Object.keys(localSliders).length > 0;
                    return (
                      <button
                        key={key}
                        onClick={() => setActiveTab(key)}
                        className={`w-full px-3 py-2.5 text-sm font-medium transition-colors flex items-center gap-2 border-b border-gray-200 ${
                          activeTab === key
                            ? "text-blue-600 bg-blue-50 border-l-4 border-l-blue-600 shadow-inner dark:text-blue-300 dark:border-l-blue-400"
                            : "qimchi-dark-hover-plain text-purple-700 hover:text-purple-800 hover:bg-purple-50 bg-linear-to-r from-purple-50 to-indigo-50 border-l-2 border-l-purple-300 dark:from-purple-950/50 dark:to-indigo-950/30 dark:text-purple-300 dark:hover:text-purple-200 dark:border-l-purple-700"
                        }`}
                        aria-controls={`tab-panel-${key}`}
                        role="tab"
                      >
                        <MoveHorizontal
                          size={18}
                          className={
                            hasActiveSliders
                              ? "text-purple-600 dark:text-purple-300"
                              : "text-purple-400 dark:text-purple-500"
                          }
                        />
                        <span className="text-left flex-1 font-semibold">Sliders</span>
                        {hasActiveSliders && (
                          <div className="w-2 h-2 bg-purple-500 rounded-full animate-pulse"></div>
                        )}
                      </button>
                    );
                  }

                  // Regular filter tabs
                  const filterDef = FILTER_DEFINITIONS[key as keyof typeof FILTER_DEFINITIONS];
                  const IconComponent = filterDef.icon;
                  const isEnabled = isFilterEnabled(key);
                  const reason = unavailableReason(key);
                  const tab = (
                    <button
                      key={key}
                      onClick={() => !reason && setActiveTab(key)}
                      // Keep pointer events so the disabled reason can appear.
                      title={reason ? undefined : filterDef.name}
                      className={`w-full px-3 py-2.5 text-sm font-medium transition-colors flex items-center gap-2 border-b border-gray-200 ${
                        reason
                          ? "text-gray-400 cursor-not-allowed bg-gray-50"
                          : activeTab === key
                            ? "text-blue-600 bg-white border-l-3 border-l-blue-600 shadow-inner"
                            : "text-gray-600 hover:text-gray-800 hover:bg-gray-100"
                      }`}
                      aria-controls={`tab-panel-${key}`}
                      aria-disabled={!!reason}
                      role="tab"
                    >
                      <IconComponent
                        size={18}
                        className={
                          reason ? "text-gray-300" : isEnabled ? "text-green-600" : "text-gray-400"
                        }
                      />
                      <span className="text-left flex-1">{filterTitle(key)}</span>
                      {isEnabled && !reason && (
                        // One-based position in the applied filter order.
                        <span
                          className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-green-600 text-[0.625rem] font-bold text-white"
                          aria-label={`Applied ${appliedOrder.indexOf(key) + 1} of ${appliedOrder.length}`}
                        >
                          {appliedOrder.indexOf(key) + 1}
                        </span>
                      )}
                    </button>
                  );

                  return reason ? (
                    <Tooltip key={key} content={reason} position="right">
                      {tab}
                    </Tooltip>
                  ) : (
                    tab
                  );
                })}
              </div>
            </div>

            {/* Right Column - Options Pane */}
            <div
              className="flex-1 p-3 overflow-y-auto bg-white"
              id={`tab-panel-${activeTab}`}
              role="tabpanel"
            >
              {(() => {
                // Special handling for sliders tab
                if (activeTab === "applied") {
                  return (
                    <div className="h-full flex flex-col">
                      <div className="mb-3 flex items-center gap-2">
                        <ListOrdered size={22} className="text-gray-600" />
                        <h3 className="text-lg font-semibold text-gray-800">Applied</h3>
                      </div>
                      {filterOrder.length > 0 ? (
                        <>
                          <p className="mb-3 text-xs text-gray-500">
                            Filters run from top to bottom. Toggle, drag, or use the arrows to
                            manage them.
                          </p>
                          <AppliedFilterOrder
                            order={filterOrder}
                            isEnabled={isFilterEnabled}
                            onToggle={toggleFilter}
                            onReorder={reorderFilters}
                            onRemove={removeFilter}
                          />
                          <div className="mt-4 border-t border-gray-200 pt-4">
                            <AppliedPreset
                              filters={buildAppliedFilters()}
                              linked={linkedPreset}
                              disabledReason={presetsUnavailable}
                              onSaveNew={saveNewPreset}
                              onUpdate={replacePresetFilters}
                              onRevert={applyPreset}
                              onUnlink={() => onPresetLinkChange?.(null)}
                            />
                          </div>
                        </>
                      ) : (
                        <p className="text-sm text-gray-500">
                          No filters applied. Choose a filter or apply a saved preset.
                        </p>
                      )}
                    </div>
                  );
                }

                if (activeTab === "presets") {
                  return (
                    <div className="h-full flex flex-col">
                      <div className="mb-3 flex items-center gap-2">
                        <Bookmark size={22} className="text-gray-600" />
                        <h3 className="text-lg font-semibold text-gray-800">Saved Presets</h3>
                      </div>
                      <p className="mb-3 text-xs text-gray-500">
                        Applying a preset replaces this plot&apos;s filters.
                      </p>
                      <SavedPresets
                        presets={presets}
                        filters={buildAppliedFilters()}
                        linkedId={presetId}
                        error={presetsUnavailable ?? presetsError}
                        unusableReason={presetUnusableReason}
                        onApply={applyPreset}
                        onSaveNew={saveNewPreset}
                        onReplace={replacePresetFilters}
                        onRename={renamePreset}
                        onDelete={removePreset}
                      />
                    </div>
                  );
                }

                if (activeTab === "sliders") {
                  const sliderKeys = Object.keys(localSliders);

                  return (
                    <div className="h-full flex flex-col">
                      {/* Sliders header */}
                      <div className="mb-4">
                        <div className="flex items-center gap-2 mb-3">
                          <MoveHorizontal size={22} className="text-gray-600" />
                          <div className="flex justify-between items-center w-full">
                            <h3 className="text-lg font-semibold text-gray-800">Data Sliders</h3>
                            <Tooltip
                              content="Drag to navigate through extra data dimensions."
                              position="left"
                            >
                              <Info size={16} className="text-gray-400 cursor-help" />
                            </Tooltip>
                          </div>
                        </div>

                        {sliderKeys.length > 0 && (
                          <div className="flex gap-2">
                            <button
                              onClick={resetAllSliders}
                              className="px-3 py-1.5 text-xs bg-gray-100 hover:bg-gray-200 rounded-md transition-colors flex items-center gap-1"
                            >
                              <RotateCcw size={12} />
                              Reset All
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Sliders content */}
                      <div className="flex-1 overflow-y-auto">
                        {sliderKeys.length === 0 ? (
                          <div className="text-center py-8">
                            <SlidersHorizontal size={48} className="text-gray-300 mx-auto mb-4" />
                            <p className="text-gray-500">
                              No data sliders available for this plot.
                            </p>
                            <p className="text-sm text-gray-400 mt-1">
                              Sliders appear when your data has extra dimensions not used in the
                              plot axes.
                            </p>
                          </div>
                        ) : (
                          <div className="space-y-4">
                            {sliderKeys.map((key) => {
                              const slider = localSliders[key];
                              const available = availableSliders[key] || slider;

                              return (
                                <div key={key} className="bg-gray-50 p-3 rounded-lg space-y-3">
                                  <div className="flex items-center justify-between">
                                    <label className="text-sm font-medium text-gray-700">
                                      {key}
                                    </label>
                                    <div className="flex items-center space-x-2">
                                      <span className="text-sm text-gray-500 font-mono bg-white px-2 py-1 rounded">
                                        {sliderText(available, slider.value)}
                                      </span>
                                      <button
                                        onClick={() => resetSlider(key)}
                                        title={`Reset ${key} slider`}
                                        className="p-1 text-gray-400 hover:text-red-500 transition-colors rounded hover:bg-gray-200"
                                      >
                                        <RotateCcw size={12} />
                                      </button>
                                    </div>
                                  </div>

                                  <div className="space-y-2">
                                    <input
                                      type="range"
                                      title={`${key} slider value: ${sliderText(available, slider.value)}`}
                                      min={0}
                                      max={sliderSteps(available)}
                                      step={1}
                                      value={sliderIndexOf(available, slider.value)}
                                      onChange={(e) =>
                                        updateSliderValue(
                                          key,
                                          sliderValueAt(available, Number(e.target.value)),
                                        )
                                      }
                                      className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500"
                                      style={{
                                        background: `linear-gradient(to right, #3b82f6 0%, #3b82f6 ${
                                          ((slider.value - available.min) /
                                            (available.max - available.min)) *
                                          100
                                        }%, #e5e7eb ${
                                          ((slider.value - available.min) /
                                            (available.max - available.min)) *
                                          100
                                        }%, #e5e7eb 100%)`,
                                      }}
                                    />

                                    <div className="flex justify-between text-xs text-gray-400">
                                      <span>{sliderText(available, available.min)}</span>
                                      <span>{sliderText(available, available.max)}</span>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                }

                // Regular filter handling
                const isEnabled = isFilterEnabled(activeTab);
                const storedFilterConfig = localFilterSettings[activeTab as keyof FilterSettings];

                // Ensure we always have a configuration object for rendering options
                const filterConfig =
                  storedFilterConfig && typeof storedFilterConfig === "object"
                    ? storedFilterConfig
                    : DEFAULT_FILTER_OPTIONS[activeTab as keyof typeof DEFAULT_FILTER_OPTIONS] || {
                        enabled: false,
                      };
                const selectedPoints = (filterConfig as { points?: BGCorrPoint[] }).points ?? [];

                return (
                  <div className="h-full flex flex-col">
                    {/* Filter header with title and apply button */}
                    <div className="mb-4">
                      <div className="flex items-center gap-2 mb-3">
                        {(() => {
                          const filterDef =
                            FILTER_DEFINITIONS[activeTab as keyof typeof FILTER_DEFINITIONS];
                          const IconComponent = filterDef.icon;
                          return <IconComponent size={22} className="text-gray-600" />;
                        })()}

                        {/* Tooltip with description */}
                        <div className="flex justify-between items-center w-full">
                          <h3 className="text-lg font-semibold text-gray-800">
                            {filterTitle(activeTab)}
                          </h3>
                          <Tooltip
                            // TODOLATER: Looks a bit weird covering the title
                            position="left"
                            content={
                              FILTER_DEFINITIONS[activeTab as keyof typeof FILTER_DEFINITIONS]
                                .description
                            }
                          >
                            <Info
                              size={16}
                              className="text-gray-400 hover:text-gray-600 cursor-help"
                            />
                          </Tooltip>
                        </div>
                      </div>
                      <ApplyButton isEnabled={isEnabled} onToggle={() => toggleFilter(activeTab)} />
                    </div>

                    {/* Filter options */}
                    <div className="flex-1 space-y-4 border-t border-gray-200 pt-4">
                      {/* Render filter-specific options as before, but only for the active filter */}
                      {/* Savitzky-Golay specific options */}
                      {activeTab === "savgol" && (
                        <>
                          <div>
                            <label className="flex items-center justify-between text-sm font-medium text-gray-700 mb-1.5">
                              Window Size
                              <span className="text-xs text-gray-500">
                                {String((filterConfig as Record<string, unknown>).window)}
                              </span>
                            </label>
                            <input
                              type="range"
                              min="3"
                              max="21"
                              step="2"
                              value={(filterConfig as Record<string, unknown>).window as number}
                              onChange={(e) =>
                                updateFilterSetting(activeTab, "window", parseInt(e.target.value))
                              }
                              className="w-full"
                              aria-label="Savitzky-Golay window size"
                              title="Savitzky-Golay window size"
                            />
                          </div>
                          <div>
                            <label className="flex items-center justify-between text-sm font-medium text-gray-700 mb-1.5">
                              Polynomial Order
                              <span className="text-xs text-gray-500">
                                {String((filterConfig as Record<string, unknown>).polyorder)}
                              </span>
                            </label>
                            <input
                              type="range"
                              min="1"
                              max="5"
                              value={(filterConfig as Record<string, unknown>).polyorder as number}
                              onChange={(e) =>
                                updateFilterSetting(
                                  activeTab,
                                  "polyorder",
                                  parseInt(e.target.value),
                                )
                              }
                              className="w-full"
                              aria-label="Savitzky-Golay polynomial order"
                              title="Savitzky-Golay polynomial order"
                            />
                          </div>
                          {plotType === "heatmap" && (
                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-1">
                                Axis
                              </label>
                              <select
                                value={(filterConfig as Record<string, unknown>).axis as number}
                                onChange={(e) =>
                                  updateFilterSetting(activeTab, "axis", parseInt(e.target.value))
                                }
                                className="w-full p-2 border border-gray-300 rounded"
                                aria-label="Savitzky-Golay axis"
                                title="Savitzky-Golay axis"
                              >
                                <option value={0}>X-axis</option>
                                <option value={1}>Y-axis</option>
                                <option value={2}>Both axes</option>
                              </select>
                            </div>
                          )}
                          <div>
                            <label className="flex items-center justify-between text-sm font-medium text-gray-700 mb-1.5">
                              Derivative Order
                              <span className="text-xs text-gray-500">
                                {String((filterConfig as Record<string, unknown>).deriv)}
                              </span>
                            </label>
                            <input
                              type="range"
                              min="0"
                              max="3"
                              value={(filterConfig as Record<string, unknown>).deriv as number}
                              onChange={(e) =>
                                updateFilterSetting(activeTab, "deriv", parseInt(e.target.value))
                              }
                              className="w-full"
                              aria-label="Savitzky-Golay derivative order"
                              title="Savitzky-Golay derivative order"
                            />
                          </div>
                          <div>
                            <label className="flex items-center justify-between text-sm font-medium text-gray-700 mb-1.5">
                              Delta
                              <span className="text-xs text-gray-500">
                                {String((filterConfig as Record<string, unknown>).delta)}
                              </span>
                            </label>
                            <input
                              type="range"
                              min="0.1"
                              max="5.0"
                              step="0.1"
                              value={(filterConfig as Record<string, unknown>).delta as number}
                              onChange={(e) =>
                                updateFilterSetting(activeTab, "delta", parseFloat(e.target.value))
                              }
                              className="w-full"
                              aria-label="Savitzky-Golay delta spacing"
                              title="Savitzky-Golay delta spacing"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                              Mode
                            </label>
                            <select
                              value={(filterConfig as Record<string, unknown>).mode as string}
                              onChange={(e) =>
                                updateFilterSetting(activeTab, "mode", e.target.value)
                              }
                              className="w-full p-2 border border-gray-300 rounded"
                              aria-label="Savitzky-Golay boundary mode"
                              title="Savitzky-Golay boundary mode"
                            >
                              <option value="interp">Interpolate</option>
                              <option value="mirror">Mirror</option>
                              <option value="constant">Constant</option>
                              <option value="wrap">Wrap</option>
                              <option value="nearest">Nearest</option>
                            </select>
                          </div>
                          <div>
                            <label className="flex items-center justify-between text-sm font-medium text-gray-700 mb-1.5">
                              Constant Value (cval)
                              <span className="text-xs text-gray-500">
                                {String((filterConfig as Record<string, unknown>).cval)}
                              </span>
                            </label>
                            <input
                              type="range"
                              min="-10"
                              max="10"
                              step="0.1"
                              value={(filterConfig as Record<string, unknown>).cval as number}
                              onChange={(e) =>
                                updateFilterSetting(activeTab, "cval", parseFloat(e.target.value))
                              }
                              className="w-full"
                              aria-label="Savitzky-Golay constant value"
                              title="Savitzky-Golay constant value used when mode is 'constant'"
                            />
                          </div>
                        </>
                      )}
                      {/* Simple Moving Average options */}
                      {activeTab === "sma" && (
                        <div>
                          <label className="flex items-center justify-between text-sm font-medium text-gray-700 mb-1.5">
                            Window Size
                            <span className="text-xs text-gray-500">
                              {String((filterConfig as Record<string, unknown>).window)}
                            </span>
                          </label>
                          <input
                            type="range"
                            min="2"
                            max="20"
                            value={(filterConfig as Record<string, unknown>).window as number}
                            onChange={(e) =>
                              updateFilterSetting(activeTab, "window", parseInt(e.target.value))
                            }
                            className="w-full"
                            aria-label="Simple moving average window size"
                            title="Simple moving average window size"
                          />

                          {/* Warning about edge effects */}
                          <div className="mt-3 p-2 bg-yellow-50 border border-yellow-200 rounded-md">
                            <div className="flex items-start gap-2">
                              <AlertTriangle
                                size={16}
                                className="text-yellow-600 mt-0.5 shrink-0"
                              />
                              <div className="text-xs text-yellow-800">
                                <strong>WARNING:</strong> Output length is same as the input length
                                because of{" "}
                                <code className="bg-yellow-100 px-1 rounded text-xs">
                                  mode='same'
                                </code>{" "}
                                in{" "}
                                <code className="bg-yellow-100 px-1 rounded text-xs">
                                  np.convolve()
                                </code>
                                . Beware of the edge effects.
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                      {/* Normalize options */}
                      {activeTab === "normalize" && (
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            Normalize Axis
                          </label>
                          <select
                            value={(filterConfig as Record<string, unknown>).axis as string}
                            onChange={(e) => updateFilterSetting(activeTab, "axis", e.target.value)}
                            className="w-full p-2 border border-gray-300 rounded"
                            aria-label="Normalize axis"
                            title="Normalize axis"
                          >
                            <option value="x">X-axis</option>
                            <option value="y">Y-axis</option>
                            <option value="z">Z-axis</option>
                          </select>
                        </div>
                      )}
                      {/* Gamma Correction options */}
                      {activeTab === "gamma_corr" && (
                        <>
                          <div>
                            <label className="flex items-center justify-between text-sm font-medium text-gray-700 mb-1.5">
                              Gamma
                              <span className="text-xs text-gray-500">
                                {String((filterConfig as Record<string, unknown>).gamma)}
                              </span>
                            </label>
                            <input
                              type="range"
                              min="0.1"
                              max="5"
                              step="0.1"
                              value={(filterConfig as Record<string, unknown>).gamma as number}
                              onChange={(e) =>
                                updateFilterSetting(activeTab, "gamma", parseFloat(e.target.value))
                              }
                              className="w-full"
                              aria-label="Gamma correction gamma value"
                              title="Gamma correction gamma value"
                            />
                          </div>
                          <div>
                            <label className="flex items-center justify-between text-sm font-medium text-gray-700 mb-1.5">
                              Gain
                              <span className="text-xs text-gray-500">
                                {String((filterConfig as Record<string, unknown>).gain)}
                              </span>
                            </label>
                            <input
                              type="range"
                              min="0.1"
                              max="10"
                              step="0.1"
                              value={(filterConfig as Record<string, unknown>).gain as number}
                              onChange={(e) =>
                                updateFilterSetting(activeTab, "gain", parseFloat(e.target.value))
                              }
                              className="w-full"
                              aria-label="Gamma correction gain value"
                              title="Gamma correction gain value"
                            />
                          </div>
                        </>
                      )}
                      {/* Log Correction options */}
                      {activeTab === "log_corr" && (
                        <>
                          <div>
                            <label className="flex items-center justify-between text-sm font-medium text-gray-700 mb-1.5">
                              Gain
                              <span className="text-xs text-gray-500">
                                {String((filterConfig as Record<string, unknown>).gain)}
                              </span>
                            </label>
                            <input
                              type="range"
                              min="0.1"
                              max="10"
                              step="0.1"
                              value={(filterConfig as Record<string, unknown>).gain as number}
                              onChange={(e) =>
                                updateFilterSetting(activeTab, "gain", parseFloat(e.target.value))
                              }
                              className="w-full"
                              aria-label="Log correction gain value"
                              title="Log correction gain value"
                            />
                          </div>
                          <div className="flex items-center">
                            <input
                              type="checkbox"
                              checked={(filterConfig as Record<string, unknown>).inv as boolean}
                              onChange={(e) =>
                                updateFilterSetting(activeTab, "inv", e.target.checked)
                              }
                              className="mr-2"
                              aria-label="Log correction invert"
                            />
                            <label className="text-sm text-gray-700">Invert</label>
                          </div>
                        </>
                      )}
                      {/* Sigmoid Correction options */}
                      {activeTab === "sig_corr" && (
                        <>
                          <div>
                            <label className="flex items-center justify-between text-sm font-medium text-gray-700 mb-1.5">
                              Cutoff
                              <span className="text-xs text-gray-500">
                                {String((filterConfig as Record<string, unknown>).cutoff)}
                              </span>
                            </label>
                            <input
                              type="range"
                              min="0.1"
                              max="1"
                              step="0.05"
                              value={(filterConfig as Record<string, unknown>).cutoff as number}
                              onChange={(e) =>
                                updateFilterSetting(activeTab, "cutoff", parseFloat(e.target.value))
                              }
                              className="w-full"
                              aria-label="Sigmoid correction cutoff value"
                              title="Sigmoid correction cutoff value"
                            />
                          </div>
                          <div>
                            <label className="flex items-center justify-between text-sm font-medium text-gray-700 mb-1.5">
                              Gain
                              <span className="text-xs text-gray-500">
                                {String((filterConfig as Record<string, unknown>).gain)}
                              </span>
                            </label>
                            <input
                              type="range"
                              min="1"
                              max="20"
                              step="0.5"
                              value={(filterConfig as Record<string, unknown>).gain as number}
                              onChange={(e) =>
                                updateFilterSetting(activeTab, "gain", parseFloat(e.target.value))
                              }
                              className="w-full"
                              aria-label="Sigmoid correction gain value"
                              title="Sigmoid correction gain value"
                            />
                          </div>
                        </>
                      )}

                      {/* Polynomial Fit options */}
                      {activeTab === "transform" && (
                        <div className="space-y-4">
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                              Operation
                            </label>
                            <select
                              value={(filterConfig as Record<string, unknown>).operation as string}
                              onChange={(e) =>
                                updateFilterSetting(activeTab, "operation", e.target.value)
                              }
                              className="w-full p-2 border border-gray-300 rounded"
                              aria-label="Scale operation"
                              title="Scale operation"
                            >
                              <option value="multiply">Multiply</option>
                              <option value="inverse">Inverse (1/value)</option>
                              <option value="g0">Divide by e² / h (G₀)</option>
                              <option value="2g0">Divide by 2e² / h (2G₀)</option>
                              <option value="r0">Divide by h / e² (R₀)</option>
                            </select>
                          </div>

                          {(filterConfig as Record<string, unknown>).operation === "multiply" && (
                            <>
                              <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                  Scalar
                                </label>
                                <NumericInput
                                  value={(filterConfig as Record<string, unknown>).factor as number}
                                  onChange={(factor) =>
                                    updateFilterSetting(activeTab, "factor", factor)
                                  }
                                  className="w-full p-2 border border-gray-300 rounded"
                                  aria-label="Scale scalar"
                                  title="Scale scalar"
                                />
                              </div>
                              <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                  Scalar Unit (optional)
                                </label>
                                <input
                                  type="text"
                                  value={
                                    (filterConfig as Record<string, unknown>).factor_unit as string
                                  }
                                  onChange={(e) =>
                                    updateFilterSetting(activeTab, "factor_unit", e.target.value)
                                  }
                                  placeholder="e.g. V, mA, Ω"
                                  className="w-full p-2 border border-gray-300 rounded"
                                  aria-label="Scale scalar unit"
                                />
                              </div>
                            </>
                          )}

                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                              Result Unit (optional override)
                            </label>
                            <input
                              type="text"
                              value={
                                (filterConfig as Record<string, unknown>).result_unit as string
                              }
                              onChange={(e) =>
                                updateFilterSetting(activeTab, "result_unit", e.target.value)
                              }
                              placeholder="Leave blank to infer"
                              className="w-full p-2 border border-gray-300 rounded"
                              aria-label="Result unit override"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                              Result Label (optional)
                            </label>
                            <input
                              type="text"
                              value={
                                (filterConfig as Record<string, unknown>).result_label as string
                              }
                              onChange={(e) =>
                                updateFilterSetting(activeTab, "result_label", e.target.value)
                              }
                              placeholder="Leave blank to retain the label"
                              className="w-full p-2 border border-gray-300 rounded"
                              aria-label="Result label override"
                            />
                          </div>
                        </div>
                      )}

                      {activeTab === "polyfit" && (
                        <div>
                          <label className="flex items-center justify-between text-sm font-medium text-gray-700 mb-1.5">
                            Polynomial Degree
                            <span className="text-xs text-gray-500">
                              {String((filterConfig as Record<string, unknown>).deg)}
                            </span>
                          </label>
                          <input
                            type="range"
                            min="1"
                            max="10"
                            value={(filterConfig as Record<string, unknown>).deg as number}
                            onChange={(e) =>
                              updateFilterSetting(activeTab, "deg", parseInt(e.target.value))
                            }
                            className="w-full"
                            aria-label="Polynomial fit degree"
                            title="Polynomial fit degree"
                          />
                        </div>
                      )}
                      {/* Rotate options */}
                      {activeTab === "rotate" && (
                        <div>
                          <label className="flex items-center justify-between text-sm font-medium text-gray-700 mb-1.5">
                            Angle
                            <span className="text-xs text-gray-500">
                              {String((filterConfig as Record<string, unknown>).angle)}°
                            </span>
                          </label>
                          <div className="flex justify-center m-2">
                            <RadialDial
                              value={(filterConfig as Record<string, unknown>).angle as number}
                              onChange={(value) => updateFilterSetting(activeTab, "angle", value)}
                              min={-180}
                              max={180}
                              step={1}
                              size={200}
                              ticks={15}
                              className="rounded-lg"
                            />
                          </div>
                        </div>
                      )}

                      {activeTab === "r_in_correction" && (
                        <div className="space-y-4">
                          <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
                            <div className="text-center text-gray-800">
                              <TexMath
                                tex="V_\mathrm{S} = V_\mathrm{b} - I \, R_\mathrm{in}"
                                fallback="V_S = V_b − I × R_in"
                                display
                              />
                            </div>
                            <p className="mt-2 text-xs leading-relaxed text-gray-600">
                              Subtracts the voltage dropped across the inline resistance from the
                              applied bias V<sub>b</sub>, taking the heat map&apos;s values as the
                              measured current I. The bias axis then shows the voltage across the
                              sample, V<sub>S</sub>.
                            </p>
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                              Inline resistance R<sub>in</sub>
                            </label>
                            <div className="flex gap-2">
                              <NumericInput
                                value={(filterConfig as Record<string, unknown>).r_in as number}
                                onChange={(value) => updateFilterSetting(activeTab, "r_in", value)}
                                className="min-w-0 flex-1 p-2 border border-gray-300 rounded"
                                aria-label="Inline resistance"
                                title="Inline resistance"
                              />
                              <select
                                value={
                                  (filterConfig as Record<string, unknown>).r_in_unit as string
                                }
                                onChange={(e) =>
                                  updateFilterSetting(activeTab, "r_in_unit", e.target.value)
                                }
                                className="p-2 border border-gray-300 rounded"
                                aria-label="Inline resistance unit"
                                title="Inline resistance unit"
                              >
                                <option value="Ω">Ω</option>
                                <option value="kΩ">kΩ</option>
                                <option value="MΩ">MΩ</option>
                                <option value="GΩ">GΩ</option>
                              </select>
                            </div>
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                              Bias axis
                            </label>
                            <select
                              value={(filterConfig as Record<string, unknown>).bias_axis as string}
                              onChange={(e) =>
                                updateFilterSetting(activeTab, "bias_axis", e.target.value)
                              }
                              className="w-full p-2 border border-gray-300 rounded"
                              aria-label="Bias axis"
                              title="Bias axis"
                            >
                              <option value="x">X axis</option>
                              <option value="y">Y axis</option>
                            </select>
                          </div>
                        </div>
                      )}

                      {/* Background Correction options */}
                      {activeTab.startsWith("bg_corr_") && (
                        <div className="space-y-4">
                          <button
                            onClick={() => onRequestBGCorr?.(activeTab.replace("bg_corr_", ""))}
                            className="w-full bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-2.5 py-2 rounded-md border border-blue-600 shadow-sm transition-colors inline-flex items-center justify-center gap-2"
                          >
                            <Crosshair size={14} />
                            Pick Points on Plot
                          </button>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                              Correction Mode
                            </label>
                            <div className="text-sm font-mono bg-gray-100 px-2 py-1 rounded inline-block uppercase text-blue-600 font-bold">
                              {activeTab.replace("bg_corr_", "")}
                            </div>
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                              Selected Points
                            </label>
                            <div className="space-y-1 max-h-40 overflow-y-auto border border-gray-100 rounded-lg p-2 bg-gray-50">
                              {selectedPoints.length === 0 ? (
                                <span className="text-sm text-gray-400 italic">
                                  No points selected
                                </span>
                              ) : (
                                selectedPoints.map((p, i: number) => (
                                  <div
                                    key={i}
                                    className="text-xs font-mono bg-white border border-gray-200 p-2 rounded flex justify-between items-center shadow-sm"
                                  >
                                    <div className="flex items-center gap-2">
                                      <span className="font-bold text-gray-500">P{i + 1}:</span>
                                      <span className="text-blue-700">
                                        ({p.x.toFixed(2)}, {p.y.toFixed(2)}
                                        {p.z !== undefined && `, Z:${p.z.toFixed(2)}`})
                                      </span>
                                    </div>
                                    {p.row_idx !== undefined && (
                                      <span className="text-[0.625rem] text-gray-400">
                                        [{p.row_idx},{p.col_idx}]
                                      </span>
                                    )}
                                  </div>
                                ))
                              )}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>

          {/* Drag and Drop Overlay */}
          {isDragging && (
            <div className="absolute inset-0 bg-blue-100 bg-opacity-90 flex items-center justify-center z-10 border-2 border-dashed border-blue-500 rounded-lg">
              <div className="text-center">
                <Upload size={48} className="mx-auto text-blue-600 mb-2" />
                <p className="text-blue-800 font-medium">Drop filter file here</p>
                <p className="text-blue-600 text-sm">JSON files only</p>
              </div>
            </div>
          )}
        </div>
      </Rnd>
    </div>,
    document.body,
  );
};

export default FiltersModal;

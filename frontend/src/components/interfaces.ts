/**
 * Centralized shared interfaces for components
 **/

import type { PlotMarker } from "../utils/plotMarkers";

export interface FilterSettings {
  // 1D and 2D filters
  flip?: boolean;
  diff?: boolean;
  diff_x?: boolean;
  diff_y?: boolean;
  savgol?: {
    enabled: boolean;
    window: number;
    polyorder: number;
    axis?: number;
    deriv?: number;
    mode?: string;
    cval?: number;
    delta?: number;
  };
  sma?: {
    enabled: boolean;
    window: number;
  };
  normalize?: {
    enabled: boolean;
    axis: string; // "x", "y", "z"
  };
  gamma_corr?: {
    enabled: boolean;
    gamma: number;
    gain: number;
  };
  log_corr?: {
    enabled: boolean;
    gain: number;
    inv: boolean;
  };
  sig_corr?: {
    enabled: boolean;
    cutoff: number;
    gain: number;
  };
  rescale_intensity?: {
    enabled: boolean;
    in_range: string;
  };
  log_scale?: {
    enabled: boolean;
    axis: string; // "x", "y", "z"
  };
  polyfit?: {
    enabled: boolean;
    deg: number;
    window: [number, number];
  };
  transform?: {
    enabled: boolean;
    operation: "inverse" | "multiply" | "g0" | "2g0" | "r0";
    factor: number;
    factor_unit: string;
    result_unit: string;
    result_label: string;
  };
  rotate?: {
    enabled: boolean;
    angle: number;
  };
  r_in_correction?: {
    enabled: boolean;
    /** Inline resistance in `r_in_unit`. */
    r_in: number;
    r_in_unit: "Ω" | "kΩ" | "MΩ" | "GΩ";
    bias_axis: "x" | "y";
  };
}

export interface AppliedFilter {
  name: string;
  options?: unknown;
}

export interface FilterDefinition {
  key: string;
  name: string;
  category: string;
  description?: string;
}

// Plot interactions
export interface PlotPosition {
  x: number;
  y: number;
}

export interface PlotSize {
  width: number;
  height: number;
}

export interface PlotState {
  id: string;
  position: PlotPosition;
  size: PlotSize;
  isMaximized: boolean;
  isDragging: boolean;
  zIndex: number;
}

// Persistent plot state stored in plotStore (appearance, filters, sliders)
export interface PlotPersistentState {
  id: string;
  /** Saved before settings existed: the whole appearance. Read once, then replaced. */
  appearance_settings?: unknown;
  /** The plot's appearance as its differences from the user's defaults. */
  appearance_overrides?: Record<string, unknown>;
  applied_filters?: AppliedFilter[];
  /** Preset linked to the applied filters. */
  filter_preset_id?: number;
  slider_settings?: Record<string, SliderConfig>;
  axes_swapped?: boolean;
  /** LineCut marker sets keyed by axis variables and units. */
  linecut_markers?: Record<string, PlotMarker[]>;
}

// Plot configuration used across hooks/components
export interface SliderConfig {
  min: number;
  max: number;
  step: number;
  value: number;
  /** Labels indexed by `value` when a dimension has no numeric coordinates. */
  labels?: string[];
}

/** Endpoints and optional sample count for a heat-map line cut. */
export interface LineCut {
  start: Record<string, number>;
  end: Record<string, number>;
  points?: number;
}

export interface PlotConfiguration {
  id: string;
  fpath: string; // Single dataset path
  indeps: string[];
  deps: string[];
  plotType: "LinePlot" | "HeatMap";
  /** Optional line cut through the two independent axes. */
  cut?: LineCut;
  filters_order?: string[];
  filters_opts?: Record<string, unknown>;
  /** Preset link copied into a new plot. */
  filter_preset_id?: number;
  slider?: Record<string, SliderConfig>;
  appearance_settings?: unknown;
  source?: "memory" | "disk";
  preferredSource?: "memory" | "disk";
  /** Creation source. Custom plots are replicated to new measurements. */
  origin?: "auto" | "custom";
  /** Keep this plot on its current measurement during Next/Prev. */
  pinned?: boolean;
}

// Theme interface
export interface PlotTheme {
  name: string;
  colors: {
    primary: string[];
    background: string;
    paper: string;
    text: string;
    /** Figure heading. Brighter than body text so the title still leads. */
    titleText: string;
    grid: string;
    /** Minor grid and ticks: always dimmer than the major ones. */
    gridMinor: string;
    tick: string;
    tickMinor: string;
    zeroline: string;
  };
  font: {
    family: string;
    size: number;
  };
}
export interface AttrData {
  "Measurement ID"?: string;
  Timestamp?: string;
  Cryostat?: string;
  "Wafer ID"?: string;
  "Device Type"?: string;
  "Sample Name"?: string;
  "Experiment Name"?: string;
  measurement_id?: string;
  timestamp?: string;
  cryostat?: string;
  wafer_id?: string;
  device_type?: string;
  sample_name?: string;
  experiment_name?: string;
  independents?: string[];
  dependents?: string[];
  /**
   * Per-dependent list of the independents it actually varies over, in
   * coordinate order.
   */
  variable_independents?: Record<string, string[]>;
  [key: string]: string | string[] | number | boolean | Record<string, string[]> | undefined;
}

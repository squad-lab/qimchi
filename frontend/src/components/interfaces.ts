/**
 * Centralized shared interfaces for components
 **/

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
  rotate?: {
    enabled: boolean;
    angle: number;
  };
}

export interface AppliedFilter {
  name: string;
  options?: unknown;
}

export interface FilterRequest {
  plot_json: unknown;
  filters_order: string[];
  filters_opts: Record<string, unknown>;
  num_axes: number;
}

export interface FilterResponse {
  filtered_plot_json: unknown;
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
  appearance_settings?: unknown;
  applied_filters?: AppliedFilter[];
  slider_settings?: Record<string, SliderConfig>;
  axes_swapped?: boolean;
}

// Plot configuration used across hooks/components
export interface SliderConfig {
  min: number;
  max: number;
  step: number;
  value: number;
}

export interface PlotConfiguration {
  id: string;
  fpath: string; // Single dataset path
  indeps: string[];
  deps: string[];
  plotType: "LinePlot" | "HeatMap";
  filters_order?: string[];
  filters_opts?: Record<string, unknown>;
  slider?: Record<string, SliderConfig>;
  appearance_settings?: unknown;
  source?: "memory" | "disk";
  preferredSource?: "memory" | "disk";
}

// Theme interface
export interface PlotTheme {
  name: string;
  colors: {
    primary: string[];
    background: string;
    paper: string;
    text: string;
    grid: string;
    zeroline: string;
  };
  font: {
    family: string;
    size: number;
  };
}
export interface AttrData {
  measurement_id?: string;
  timestamp?: string;
  cryostat?: string;
  wafer_id?: string;
  device_type?: string;
  sample_name?: string;
  experiment_name?: string;
  independents?: string[];
  dependents?: string[];
}

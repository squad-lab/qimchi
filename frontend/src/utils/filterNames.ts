// Filter keys are the backend's identifiers and are persisted in saved plot
// state, so they stay as-is. Note the diff keys name the array axis that is
// differentiated over, which is the opposite of the plot axis a user sees.
export const FILTER_LABELS: Record<string, string> = {
  diff: "Differentiate",
  diff_y: "Diff along X",
  diff_x: "Diff along Y",
  log_scale: "Log Scale",
  savgol: "Savitzky-Golay",
  sma: "Moving Average",
  normalize: "Normalize",
  gamma_corr: "Gamma Correction",
  log_corr: "Log Correction",
  sig_corr: "Sigmoid Correction",
  rescale_intensity: "Rescale Intensity",
  polyfit: "Polynomial Fit",
  transform: "Scale",
  rotate: "Rotate Heatmap",
  flip: "Flip Heatmap",
  bg_corr_constant: "BG Correction (Constant)",
  bg_corr_linear: "BG Correction (Linear)",
  bg_corr_row_mean: "BG Correction (Row Mean)",
  bg_corr_col_mean: "BG Correction (Col Mean)",
  bg_corr_plane: "BG Correction (Plane)",
};

/** The name a user sees for a filter key; unknown keys are made readable. */
export function filterLabel(key: string): string {
  if (FILTER_LABELS[key]) return FILTER_LABELS[key];
  const words = key.replace(/_/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

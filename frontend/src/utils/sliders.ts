import type { SliderConfig } from "../components/interfaces";

/** Format a slider index as its label when labels are available. */
export const sliderText = (config: SliderConfig, value: number): string =>
  config.labels?.[Math.round(value)] ?? value.toFixed(6);

/** Merge backend slider definitions with valid values from the current plot state. */
export const visibleSliders = (
  available: Record<string, SliderConfig>,
  current: Record<string, SliderConfig>,
): Record<string, SliderConfig> =>
  Object.fromEntries(
    Object.entries(available).map(([key, config]) => [
      key,
      { ...config, value: current[key]?.value ?? config.min },
    ]),
  );

/**
 * How many steps a slider has.
 */
export const sliderSteps = (config: SliderConfig): number =>
  config.step > 0 && config.max > config.min
    ? Math.max(1, Math.round((config.max - config.min) / config.step))
    : 0;

/** The value at a step of the slider; the last step is exactly the maximum. */
export const sliderValueAt = (config: SliderConfig, index: number): number => {
  const steps = sliderSteps(config);
  if (steps === 0) return config.min;
  if (index >= steps) return config.max;
  return config.min + (Math.max(0, index) * (config.max - config.min)) / steps;
};

/** The step nearest to a value. */
export const sliderIndexOf = (config: SliderConfig, value: number): number => {
  const steps = sliderSteps(config);
  if (steps === 0) return 0;
  const index = Math.round(((value - config.min) / (config.max - config.min)) * steps);
  return Math.min(steps, Math.max(0, index));
};

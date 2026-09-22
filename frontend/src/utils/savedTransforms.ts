import { usePlotStore } from "../stores/plotStore";
import type { PlotConfiguration, PlotPersistentState } from "../components/interfaces";

const savedStates = (): Record<string, PlotPersistentState> => usePlotStore.getState().plotStates;

/** Restore saved filters and sliders to a plot config. */
export const withSavedTransforms = (config: PlotConfiguration): PlotConfiguration => {
  const saved = savedStates()[config.id];
  if (!saved) return config;

  const filters = saved.applied_filters;
  const next = { ...config };
  // Preserve an explicitly cleared filter list.
  if (filters !== undefined) {
    next.filters_order = filters.map((filter) => filter.name);
    next.filters_opts = filters.reduce<Record<string, unknown>>((acc, filter) => {
      acc[filter.name] = filter.options ?? {};
      return acc;
    }, {});
  }
  if (saved.slider_settings !== undefined) {
    next.slider = saved.slider_settings;
  }
  return next;
};

import type { PlotAppearanceSettings } from "../types";

// Built-in plot appearance. The user's saved defaults and each plot's own
// changes are stored as differences from values like these.
export const FACTORY_APPEARANCE_SETTINGS: PlotAppearanceSettings = {
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

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * Overlay `overrides` on `defaults`, keeping the defaults' shape: an override
 * of the wrong type, or for a key the defaults do not have, is ignored.
 */
export const mergeAppearanceDefaults = (
  defaults: PlotAppearanceSettings,
  overrides: unknown,
): PlotAppearanceSettings => {
  const merge = (def: unknown, value: unknown): unknown => {
    if (isObject(def)) {
      const out: Json = { ...def };
      for (const key of Object.keys(def)) {
        out[key] = merge(def[key], isObject(value) ? value[key] : undefined);
      }
      return out;
    }
    if (value === undefined) return def;
    // A nullable leaf (the heatmap colour range) accepts null or a value.
    if (def === null) return value === null || Array.isArray(value) ? value : def;
    if (Array.isArray(def)) return Array.isArray(value) ? value : def;
    return typeof value === typeof def ? value : def;
  };
  return merge(defaults, overrides) as PlotAppearanceSettings;
};

const sameValue = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The parts of `settings` that differ from `defaults`, as a nested partial. */
export const appearanceOverrides = (
  settings: PlotAppearanceSettings,
  defaults: PlotAppearanceSettings,
): Json => {
  const diff = (value: unknown, def: unknown): unknown => {
    if (isObject(value) && isObject(def)) {
      const out: Json = {};
      for (const key of Object.keys(value)) {
        const child = diff(value[key], def[key]);
        if (child !== undefined) out[key] = child;
      }
      return Object.keys(out).length ? out : undefined;
    }
    return sameValue(value, def) ? undefined : value;
  };
  return (diff(settings, defaults) as Json | undefined) ?? {};
};

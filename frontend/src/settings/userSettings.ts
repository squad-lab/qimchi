import type { PlotAppearanceSettings } from "../components/types";
import {
  FACTORY_APPEARANCE_SETTINGS,
  mergeAppearanceDefaults,
} from "../components/Plots/appearanceDefaults";

export type ThemePreference = "system" | "light" | "dark";
export type PlotWidthPercent = 33 | 50 | 66 | 100;
export type ExplorerSort = "name" | "timestamp" | "size" | "chrono";
export type ExportFormat = "png" | "svg";
export type ExportVariant = "light" | "dark";

export const PLOT_WIDTHS: PlotWidthPercent[] = [33, 50, 66, 100];
export const ZOOM_STEPS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2] as const;

export interface UserSettings {
  general: {
    theme: ThemePreference;
    zoom: number;
    plotWidth: PlotWidthPercent;
  };
  plots: {
    squarify: boolean;
  };
  explorer: {
    sortBy: ExplorerSort;
  };
  live: {
    autoAddToBasket: boolean;
  };
  export: {
    formats: ExportFormat[];
    variants: ExportVariant[];
    // null keeps the exporter's built-in resolution.
    scale: number | null;
    // null saves desktop exports to ~/Downloads.
    folder: string | null;
  };
  desktop: {
    checkForUpdates: boolean;
    previewReleases: boolean;
  };
  appearance: {
    heatmap: PlotAppearanceSettings;
    line: PlotAppearanceSettings;
  };
}

export const FACTORY_SETTINGS: UserSettings = {
  general: { theme: "system", zoom: 1, plotWidth: 50 },
  plots: { squarify: false },
  explorer: { sortBy: "timestamp" },
  live: { autoAddToBasket: true },
  export: { formats: ["png", "svg"], variants: ["light", "dark"], scale: null, folder: null },
  desktop: { checkForUpdates: true, previewReleases: false },
  appearance: { heatmap: FACTORY_APPEARANCE_SETTINGS, line: FACTORY_APPEARANCE_SETTINGS },
};

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  value !== null && typeof value === "object" && !Array.isArray(value);

// Leaves that are null by default accept a value of this type instead.
const NULLABLE_LEAF_TYPES: Record<string, string> = {
  "export.scale": "number",
  "export.folder": "string",
};

const ENUM_LEAVES: Record<string, readonly unknown[]> = {
  "general.theme": ["system", "light", "dark"],
  "general.plotWidth": PLOT_WIDTHS,
  "explorer.sortBy": ["name", "timestamp", "size", "chrono"],
};

/** The effective settings: stored values over the defaults, ignoring anything malformed. */
export const resolveSettings = (stored: unknown): UserSettings => {
  const resolve = (def: unknown, value: unknown, path: string): unknown => {
    if (path === "appearance.heatmap" || path === "appearance.line") {
      return mergeAppearanceDefaults(def as PlotAppearanceSettings, value);
    }
    if (isObject(def)) {
      const out: Json = {};
      for (const key of Object.keys(def)) {
        const childPath = path ? `${path}.${key}` : key;
        out[key] = resolve(def[key], isObject(value) ? value[key] : undefined, childPath);
      }
      return out;
    }
    if (value === undefined) return def;
    if (ENUM_LEAVES[path]) return ENUM_LEAVES[path].includes(value) ? value : def;
    if (def === null) {
      return value === null || typeof value === NULLABLE_LEAF_TYPES[path] ? value : def;
    }
    if (Array.isArray(def)) {
      return Array.isArray(value) && value.length > 0 ? value : def;
    }
    return typeof value === typeof def ? value : def;
  };
  return resolve(FACTORY_SETTINGS, stored, "") as UserSettings;
};

const sameValue = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const factoryValueAt = (path: string[]): unknown =>
  path.reduce<unknown>((node, key) => (isObject(node) ? node[key] : undefined), FACTORY_SETTINGS);

/**
 * A patch that sets `value` at `path`. Leaves equal to the default become
 * null, which removes them from the stored document instead of pinning them.
 */
export const patchFor = (path: string[], value: unknown): Json => {
  const leaves = (node: unknown, def: unknown): unknown => {
    if (isObject(node) && isObject(def)) {
      const out: Json = {};
      for (const key of Object.keys(node)) out[key] = leaves(node[key], def[key]);
      return out;
    }
    return sameValue(node, def) ? null : node;
  };
  let patch: unknown = leaves(value, factoryValueAt(path));
  for (let i = path.length - 1; i >= 0; i--) patch = { [path[i]]: patch };
  return patch as Json;
};

/** Apply a patch to a stored document the way the backend does (null removes). */
export const applyPatch = (stored: Json, patch: Json): Json => {
  const out: Json = { ...stored };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      delete out[key];
    } else if (isObject(value)) {
      const nested = applyPatch(isObject(out[key]) ? (out[key] as Json) : {}, value);
      if (Object.keys(nested).length) out[key] = nested;
      else delete out[key];
    } else {
      out[key] = value;
    }
  }
  return out;
};

export const resolveTheme = (preference: ThemePreference): "light" | "dark" => {
  if (preference !== "system") return preference;
  return typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
};

export const appearanceDefaultsFor = (
  settings: UserSettings,
  plotType: string,
): PlotAppearanceSettings =>
  plotType === "heatmap" ? settings.appearance.heatmap : settings.appearance.line;

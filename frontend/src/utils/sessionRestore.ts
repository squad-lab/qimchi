/** Preserve Basket and Viewer state across reloads, but not new app launches. */
export const SESSION_KEYS = {
  basket: "qimchi-session-basket",
  plots: "qimchi-session-plots",
  plotWidths: "qimchi-session-plot-widths",
} as const;

export function readSessionValue<T>(key: string, fallback: T): T {
  try {
    const raw = window.sessionStorage.getItem(key);
    if (raw === null) return fallback;
    const value: unknown = JSON.parse(raw);
    if (Array.isArray(fallback) !== Array.isArray(value)) return fallback;
    if (typeof value !== typeof fallback || value === null) return fallback;
    return value as T;
  } catch {
    return fallback;
  }
}

export function writeSessionValue(key: string, value: unknown): void {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Continue without session recovery if storage is unavailable or full.
  }
}

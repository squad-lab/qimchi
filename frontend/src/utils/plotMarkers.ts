/** Marker helpers for 2D plots, using data coordinates. */

export type MarkerKind = "vline" | "hline" | "point";

export interface PlotMarker {
  id: string;
  kind: MarkerKind;
  /** Position along the x axis; unused by a horizontal line. */
  x?: number;
  /** Position along the y axis; unused by a vertical line. */
  y?: number;
}

export interface DataPoint {
  x: number;
  y: number;
}

/** Converts data coordinates to pixels within the plot area. */
export interface PixelScale {
  x: (value: number) => number;
  y: (value: number) => number;
}

export const MAX_MARKERS = 50;
/** Maximum sets per plot; discard the least recently updated set first. */
export const MAX_MARKER_SETS = 8;
/** Base hit tolerance in pixels; point markers allow two extra pixels. */
export const PICK_TOLERANCE = 6;

export const MARKER_KIND_LABELS: Record<MarkerKind, string> = {
  vline: "Vertical line",
  hline: "Horizontal line",
  point: "Point",
};

type AxisMeta = { variable?: unknown };
type UnitMeta = { unit?: unknown };
type LayoutLike = {
  meta?: { qimchi_axes?: Record<string, AxisMeta>; qimchi_units?: Record<string, UnitMeta> };
  xaxis?: { title?: unknown };
  yaxis?: { title?: unknown };
};

const titleText = (title: unknown): string => {
  if (typeof title === "string") return title;
  if (title && typeof title === "object" && "text" in title) {
    return String((title as { text?: unknown }).text ?? "");
  }
  return "";
};

/**
 * Key marker sets by both axis variables and units to keep different quantities separate.
 * Return null if either axis has no name.
 */
export function markerSetKey(layout: unknown): string | null {
  const { meta, xaxis, yaxis } = (layout ?? {}) as LayoutLike;
  const describe = (axis: "x" | "y", title: unknown): string | null => {
    const variable = meta?.qimchi_axes?.[axis]?.variable;
    const name = typeof variable === "string" && variable ? variable : titleText(title);
    if (!name) return null;
    const unit = meta?.qimchi_units?.[axis]?.unit;
    return `${name} [${typeof unit === "string" ? unit : ""}]`;
  };
  const x = describe("x", xaxis?.title);
  const y = describe("y", yaxis?.title);
  return x && y ? `${x} | ${y}` : null;
}

let counter = 0;
export const newMarkerId = (): string => `m${Date.now().toString(36)}${(counter++).toString(36)}`;

/**
 * Snap vertical lines to the nearest x sample in screen space, and points or
 * horizontal lines to the nearest curve sample. Use click coordinates when
 * `exact` is true or no usable sample exists.
 */
function snapPosition(
  kind: MarkerKind,
  at: DataPoint,
  samples: { x: number[]; y: number[] },
  scale: PixelScale,
  exact: boolean,
): { x?: number; y?: number } {
  let best = -1;
  if (!exact) {
    let bestDistance = Infinity;
    const ax = scale.x(at.x);
    const ay = scale.y(at.y);
    for (let i = 0; i < samples.x.length; i++) {
      const sx = samples.x[i];
      const sy = samples.y[i];
      if (!Number.isFinite(sx) || (kind !== "vline" && !Number.isFinite(sy))) continue;
      const dx = scale.x(sx) - ax;
      const distance = kind === "vline" ? Math.abs(dx) : Math.hypot(dx, scale.y(sy) - ay);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = i;
      }
    }
  }
  if (kind === "vline") return { x: best >= 0 ? samples.x[best] : at.x };
  if (kind === "hline") return { y: best >= 0 ? samples.y[best] : at.y };
  return best >= 0 ? { x: samples.x[best], y: samples.y[best] } : { x: at.x, y: at.y };
}

/** Create a marker at the click position, snapping to samples unless `exact` is true. */
export function placeMarker(
  kind: MarkerKind,
  at: DataPoint,
  samples: { x: number[]; y: number[] },
  scale: PixelScale,
  exact = false,
): PlotMarker {
  return { id: newMarkerId(), kind, ...snapPosition(kind, at, samples, scale, exact) };
}

export type NudgeKey = "left" | "right" | "up" | "down";

/** Move `count` steps through sorted values, stopping at the last reachable value. */
function stepThrough(values: number[], from: number, forward: boolean, count: number): number {
  const tolerance = Math.abs(values[values.length - 1] - values[0]) * 1e-9;
  // The first step from a position between values lands on the next value.
  const ahead = forward
    ? values.filter((value) => value > from + tolerance)
    : values.filter((value) => value < from - tolerance).reverse();
  return ahead.length ? ahead[Math.min(count, ahead.length) - 1] : from;
}

/**
 * Move vertical lines and points through samples sorted by x (left/right),
 * or horizontal lines through distinct y values (up/down).
 * Return null for unsupported keys; clamp movement to the available samples.
 */
export function nudgeMarker(
  marker: PlotMarker,
  key: NudgeKey,
  samples: { x: number[]; y: number[] },
  count = 1,
): PlotMarker | null {
  if (marker.kind === "hline") {
    if (key !== "up" && key !== "down") return null;
    const levels = [...new Set(samples.y.filter(Number.isFinite))].sort((a, b) => a - b);
    if (levels.length === 0) return marker;
    return { ...marker, y: stepThrough(levels, marker.y!, key === "up", count) };
  }
  if (key !== "left" && key !== "right") return null;
  const usable = samples.x
    .map((x, i) => ({ x, y: samples.y[i] }))
    .filter(({ x, y }) => Number.isFinite(x) && (marker.kind === "vline" || Number.isFinite(y)))
    .sort((a, b) => a.x - b.x);
  if (usable.length === 0) return marker;
  const xs = usable.map((sample) => sample.x);
  const x = stepThrough(xs, marker.x!, key === "right", count);
  if (marker.kind === "vline") return { ...marker, x };
  return { ...marker, x, y: usable[xs.indexOf(x)]?.y ?? marker.y };
}

const sameValue = (a: number | undefined, b: number | undefined) =>
  a === b ||
  (a !== undefined &&
    b !== undefined &&
    Math.abs(a - b) <= 1e-9 * Math.max(Math.abs(a), Math.abs(b), Number.MIN_VALUE));

/** Find another marker of the same kind at this position, allowing floating-point noise. */
export function markerAtSameSpot(
  markers: PlotMarker[],
  marker: PlotMarker,
): PlotMarker | undefined {
  return markers.find(
    (other) =>
      other.id !== marker.id &&
      other.kind === marker.kind &&
      sameValue(other.x, marker.x) &&
      sameValue(other.y, marker.y),
  );
}

/** Return the ID of a marker within hit tolerance, preferring points over lines. */
export function markerAt(
  markers: PlotMarker[],
  pixel: DataPoint,
  scale: PixelScale,
  tolerance = PICK_TOLERANCE,
): string | null {
  let best: { id: string; distance: number; rank: number } | null = null;
  for (const marker of markers) {
    let distance: number;
    if (marker.kind === "point") {
      distance = Math.hypot(scale.x(marker.x!) - pixel.x, scale.y(marker.y!) - pixel.y);
    } else if (marker.kind === "vline") {
      distance = Math.abs(scale.x(marker.x!) - pixel.x);
    } else {
      distance = Math.abs(scale.y(marker.y!) - pixel.y);
    }
    // Point markers have a larger hit area than lines.
    const reach = marker.kind === "point" ? tolerance + 2 : tolerance;
    if (!(distance <= reach)) continue;
    const rank = marker.kind === "point" ? 0 : 1;
    if (!best || rank < best.rank || (rank === best.rank && distance < best.distance)) {
      best = { id: marker.id, distance, rank };
    }
  }
  return best?.id ?? null;
}

/** The text shown beside a marker and in its chip. */
export function markerLabel(
  marker: PlotMarker,
  format: { x: (value: number) => string; y: (value: number) => string },
): string {
  if (marker.kind === "vline") return format.x(marker.x!);
  if (marker.kind === "hline") return format.y(marker.y!);
  return `${format.x(marker.x!)}, ${format.y(marker.y!)}`;
}

/**
 * Replace a marker set, or remove it if empty, enforcing both marker and set limits.
 * Discard the least recently updated sets first; return undefined if none remain.
 */
export function withMarkerSet(
  sets: Record<string, PlotMarker[]> | undefined,
  key: string,
  markers: PlotMarker[],
): Record<string, PlotMarker[]> | undefined {
  const next = { ...sets };
  delete next[key];
  if (markers.length > 0) {
    const keys = Object.keys(next);
    for (const old of keys.slice(0, Math.max(0, keys.length - (MAX_MARKER_SETS - 1)))) {
      delete next[old];
    }
    next[key] = markers.slice(0, MAX_MARKERS);
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

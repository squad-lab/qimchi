/**
 * Client-side line-cut sampling for previews.
 * ! NOTE: Keep interpolation behavior aligned
 * ! with backend/api/plots.py::apply_line_cut, which renders persisted cuts.
 */

export interface CutPoint {
  x: number;
  y: number;
}

export interface CutSamples {
  /** Heat-map coordinates at each sample. */
  x: number[];
  y: number[];
  /** NaN where the cut crosses unmeasured points or leaves the grid. */
  values: number[];
}

export const MAX_CUT_POINTS = 2000;

/** Return a value's fractional index on a monotonic axis, or null if out of range. */
export function fractionalIndex(axis: number[], value: number): number | null {
  const n = axis.length;
  if (n === 0 || !Number.isFinite(value)) return null;
  if (n === 1) return axis[0] === value ? 0 : null;

  // Normalize descending axes before the binary search.
  const sign = axis[n - 1] >= axis[0] ? 1 : -1;
  const at = (i: number) => sign * axis[i];
  const target = sign * value;
  if (target < at(0) || target > at(n - 1)) return null;

  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (at(mid) <= target) lo = mid;
    else hi = mid;
  }
  const step = at(hi) - at(lo);
  return step === 0 ? lo : lo + (target - at(lo)) / step;
}

/** Linear interpolation between the four grid points around (fx, fy). */
function bilinear(z: number[][], fx: number, fy: number): number {
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;

  let total = 0;
  for (const [dy, wy] of [
    [0, 1 - ty],
    [1, ty],
  ]) {
    for (const [dx, wx] of [
      [0, 1 - tx],
      [1, tx],
    ]) {
      const weight = wx * wy;
      if (weight === 0) continue;
      const value = z[y0 + dy]?.[x0 + dx];
      if (value === undefined || !Number.isFinite(value)) return NaN;
      total += weight * value;
    }
  }
  return total;
}

function axisOrIndices(axis: number[], length: number): number[] {
  return axis.length === length ? axis : Array.from({ length }, (_, i) => i);
}

/**
 * Sample z along a line from `start` to `end`, using approximately one sample
 * per grid interval unless `points` is provided.
 */
export function sampleLineCut(
  z: number[][],
  xAxis: number[],
  yAxis: number[],
  start: CutPoint,
  end: CutPoint,
  points?: number,
): CutSamples {
  const xs = axisOrIndices(xAxis, z[0]?.length ?? 0);
  const ys = axisOrIndices(yAxis, z.length);

  let count = points;
  if (!count) {
    const spanned = (axis: number[], a: number, b: number) => {
      const fa = fractionalIndex(axis, a);
      const fb = fractionalIndex(axis, b);
      return fa === null || fb === null ? 0 : Math.abs(fb - fa);
    };
    count = Math.ceil(Math.max(spanned(xs, start.x, end.x), spanned(ys, start.y, end.y))) + 1;
  }
  count = Math.min(Math.max(Math.round(count), 2), MAX_CUT_POINTS);

  const samples: CutSamples = { x: [], y: [], values: [] };
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    const x = start.x + t * (end.x - start.x);
    const y = start.y + t * (end.y - start.y);
    const fx = fractionalIndex(xs, x);
    const fy = fractionalIndex(ys, y);
    samples.x.push(x);
    samples.y.push(y);
    samples.values.push(fx === null || fy === null ? NaN : bilinear(z, fx, fy));
  }
  return samples;
}

/**
 * Select the plot axis with the larger normalized change across the cut.
 */
export function cutPlotAxis(
  xAxis: number[],
  yAxis: number[],
  start: CutPoint,
  end: CutPoint,
): "x" | "y" {
  const extent = (axis: number[], a: number, b: number) => {
    const finite = axis.filter(Number.isFinite);
    if (finite.length < 2) return 0;
    const span = Math.max(...finite) - Math.min(...finite);
    return span > 0 ? Math.abs(b - a) / span : 0;
  };
  return extent(xAxis, start.x, end.x) >= extent(yAxis, start.y, end.y) ? "x" : "y";
}

/** Inverse transform from displayed rotated indices to source-grid indices. */
export interface RotationMeta {
  matrix: number[][];
  offset: number[];
  columns: { start: number; step: number };
  rows: { start: number; step: number };
  x: number[];
  y: number[];
}

/** Interpolate or extrapolate an axis value at a fractional index. */
export function valueAtIndex(axis: number[], index: number): number {
  const n = axis.length;
  if (n === 0) return index;
  if (n === 1) return axis[0];
  const lo = Math.min(Math.max(Math.floor(index), 0), n - 2);
  return axis[lo] + (index - lo) * (axis[lo + 1] - axis[lo]);
}

/** Transform a displayed rotated point into source coordinates. */
export function unrotatePoint(rotation: RotationMeta, point: CutPoint): CutPoint {
  const col = (point.x - rotation.columns.start) / rotation.columns.step;
  const row = (point.y - rotation.rows.start) / rotation.rows.step;
  const [[a, b], [c, d]] = rotation.matrix;
  const dataRow = a * row + b * col + rotation.offset[0];
  const dataCol = c * row + d * col + rotation.offset[1];
  return { x: valueAtIndex(rotation.x, dataCol), y: valueAtIndex(rotation.y, dataRow) };
}

/** Shown beside the Oblique mode and in Help. */
export const OBLIQUE_CUT_CAVEAT =
  "An oblique cut is evaluated by bilinear interpolation from the four nearest measured points, " +
  "slightly smoothing sharp features. Samples adjacent to missing data are excluded. The cut is " +
  "parameterized along the axis with the larger projected span.";

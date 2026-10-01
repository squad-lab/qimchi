/** The newest measured line of a live heat map, for a LineCut that follows it. */
export interface Frontier {
  /** "row" when the map fills row by row (the cut is horizontal). */
  axis: "row" | "column";
  /** Index into the heat map's rows (y) or columns (x). */
  index: number;
  /** Sweep direction: true toward the last line, false toward the first. */
  forward?: boolean;
}

const finiteCount = (values: number[]) => values.filter(Number.isFinite).length;

/** Row and column counts of measured points. */
const coverage = (z: number[][]) => {
  const columns = Math.max(0, ...z.map((row) => row.length));
  const rows = z.map(finiteCount);
  const cols = Array.from({ length: columns }, (_, j) =>
    z.reduce((count, row) => count + (Number.isFinite(row[j]) ? 1 : 0), 0),
  );
  return { rows, cols };
};

/** Return the outermost measured line and sweep direction. */
const edgeLine = (counts: number[]): { index: number; forward: boolean } | null => {
  const started = counts.flatMap((count, i) => (count > 0 ? [i] : []));
  if (started.length === 0) return null;
  const last = counts.length - 1;
  // Sweeps run either way: the block grows away from the end it started at.
  const growsDown = started.includes(last) && !started.includes(0);
  return growsDown
    ? { index: started[0], forward: false }
    : { index: started[started.length - 1], forward: true };
};

/** Return the newest line, or the sweep endpoint after every line has started. */
export function findFrontier(z: number[][], previous: Frontier | null = null): Frontier | null {
  if (z.length === 0) return previous;
  const { rows, cols } = coverage(z);
  const rowsStarted = rows.filter((count) => count > 0).length;
  const colsStarted = cols.filter((count) => count > 0).length;
  if (rowsStarted === 0) return previous;

  const rowsGrowing = rowsStarted < rows.length;
  const colsGrowing = colsStarted < cols.length;
  let axis: Frontier["axis"];
  if (rowsGrowing && !colsGrowing) axis = "row";
  else if (colsGrowing && !rowsGrowing) axis = "column";
  // Early on both are partly started: the slow axis has started fewer lines.
  else if (rowsGrowing && colsGrowing) {
    axis = previous?.axis ?? (rowsStarted <= colsStarted ? "row" : "column");
  } else {
    // Polling may skip intermediate lines, so select the sweep endpoint directly.
    if (!previous) return { axis: "row", index: rows.length - 1, forward: true };
    const lines = previous.axis === "row" ? rows.length : cols.length;
    const forward = previous.forward ?? true;
    return { axis: previous.axis, index: forward ? lines - 1 : 0, forward };
  }

  const edge = edgeLine(axis === "row" ? rows : cols);
  return edge === null ? previous : { axis, ...edge };
}

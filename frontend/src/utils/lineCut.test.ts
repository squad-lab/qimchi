import { describe, expect, it } from "vitest";

import {
  cutPlotAxis,
  fractionalIndex,
  MAX_CUT_POINTS,
  sampleLineCut,
  unrotatePoint,
  valueAtIndex,
  type RotationMeta,
} from "./lineCut";

// Linear test surface: z = 10y + x.
const xs = [0, 0.25, 0.5, 0.75, 1];
const ys = [0, 1, 2];
const z = ys.map((y) => xs.map((x) => 10 * y + x));

describe("fractionalIndex", () => {
  it("places a value between two axis entries", () => {
    expect(fractionalIndex(xs, 0.5)).toBe(2);
    expect(fractionalIndex(xs, 0.375)).toBeCloseTo(1.5);
  });

  it("works for a sweep that runs downwards", () => {
    expect(fractionalIndex([2, 1, 0], 0.5)).toBeCloseTo(1.5);
    expect(fractionalIndex([2, 1, 0], 2)).toBe(0);
  });

  it("returns null outside the axis or without one", () => {
    expect(fractionalIndex(xs, -0.1)).toBeNull();
    expect(fractionalIndex(xs, 1.1)).toBeNull();
    expect(fractionalIndex([], 0)).toBeNull();
    expect(fractionalIndex(xs, NaN)).toBeNull();
  });

  it("handles an axis with a single value", () => {
    expect(fractionalIndex([3], 3)).toBe(0);
    expect(fractionalIndex([3], 4)).toBeNull();
  });
});

describe("sampleLineCut", () => {
  it("interpolates the values along an oblique cut", () => {
    const cut = sampleLineCut(z, xs, ys, { x: 0, y: 0 }, { x: 1, y: 2 });
    cut.values.forEach((value, i) => {
      expect(value).toBeCloseTo(10 * cut.y[i] + cut.x[i]);
    });
    expect(cut.x[0]).toBe(0);
    expect(cut.x[cut.x.length - 1]).toBe(1);
    expect(cut.y[cut.y.length - 1]).toBe(2);
  });

  it("samples about once per grid step along the longer direction", () => {
    // x spans four grid intervals; y spans two.
    expect(sampleLineCut(z, xs, ys, { x: 0, y: 0 }, { x: 1, y: 2 }).values).toHaveLength(5);
    expect(sampleLineCut(z, xs, ys, { x: 0, y: 0 }, { x: 0.25, y: 2 }).values).toHaveLength(3);
  });

  it("uses the number of points it is given, within limits", () => {
    const start = { x: 0, y: 0 };
    const end = { x: 1, y: 2 };
    expect(sampleLineCut(z, xs, ys, start, end, 9).values).toHaveLength(9);
    expect(sampleLineCut(z, xs, ys, start, end, 1).values).toHaveLength(2);
    expect(sampleLineCut(z, xs, ys, start, end, 10_000).values).toHaveLength(MAX_CUT_POINTS);
  });

  it("gives NaN where the cut crosses unmeasured points", () => {
    const gappy = z.map((row) => [...row]);
    gappy[2][4] = NaN;
    const cut = sampleLineCut(gappy, xs, ys, { x: 0, y: 0 }, { x: 1, y: 2 });
    expect(Number.isFinite(cut.values[0])).toBe(true);
    expect(cut.values[cut.values.length - 1]).toBeNaN();
  });

  it("ignores an unmeasured neighbour the cut does not reach", () => {
    const gappy = z.map((row) => [...row]);
    gappy[1][1] = NaN;
    // A cut exactly on y = 0 has zero weight from the adjacent row.
    const cut = sampleLineCut(gappy, xs, ys, { x: 0, y: 0 }, { x: 1, y: 0 });
    expect(cut.values.every(Number.isFinite)).toBe(true);
  });

  it("gives NaN outside the grid", () => {
    const cut = sampleLineCut(z, xs, ys, { x: 0, y: 0 }, { x: 2, y: 0 }, 3);
    expect(cut.values[0]).toBe(0);
    expect(cut.values[1]).toBe(1);
    expect(cut.values[2]).toBeNaN();
  });

  it("falls back to grid indices when an axis is missing", () => {
    const cut = sampleLineCut(z, [], [], { x: 0, y: 0 }, { x: 4, y: 2 });
    expect(cut.values[0]).toBe(0);
    expect(cut.values[cut.values.length - 1]).toBeCloseTo(21);
  });
});

describe("cutPlotAxis", () => {
  it("plots against the axis that changes over more of its range", () => {
    expect(cutPlotAxis(xs, ys, { x: 0, y: 0 }, { x: 1, y: 1 })).toBe("x");
    expect(cutPlotAxis(xs, ys, { x: 0.25, y: 0 }, { x: 0.5, y: 2 })).toBe("y");
  });

  it("prefers x when both change equally", () => {
    expect(cutPlotAxis(xs, ys, { x: 0, y: 0 }, { x: 1, y: 2 })).toBe("x");
  });

  it("uses y for a vertical cut", () => {
    expect(cutPlotAxis(xs, ys, { x: 0.5, y: 0 }, { x: 0.5, y: 2 })).toBe("y");
  });
});

describe("valueAtIndex", () => {
  it("interpolates between entries and continues past the ends", () => {
    expect(valueAtIndex([0, 10, 20], 1.5)).toBe(15);
    expect(valueAtIndex([0, 10, 20], -1)).toBe(-10);
    expect(valueAtIndex([0, 10, 20], 3)).toBe(30);
    expect(valueAtIndex([5], 2)).toBe(5);
    expect(valueAtIndex([], 2)).toBe(2);
  });
});

describe("unrotatePoint", () => {
  // Metadata for a 90-degree rotation of a 3x2 source grid.
  const quarterTurn: RotationMeta = {
    matrix: [
      [0, 1],
      [-1, 0],
    ],
    offset: [0, 2],
    columns: { start: 0.5, step: 1 },
    rows: { start: 5, step: 10 },
    x: [0, 1, 2],
    y: [10, 20],
  };

  it("finds where a rotated point lies in the data", () => {
    expect(unrotatePoint(quarterTurn, { x: 0.5, y: 5 })).toEqual({ x: 2, y: 10 });
    expect(unrotatePoint(quarterTurn, { x: 1.5, y: 25 })).toEqual({ x: 0, y: 20 });
    expect(unrotatePoint(quarterTurn, { x: 1, y: 15 })).toEqual({ x: 1, y: 15 });
  });

  it("changes nothing without a rotation", () => {
    const none: RotationMeta = {
      matrix: [
        [1, 0],
        [0, 1],
      ],
      offset: [0, 0],
      columns: { start: 0, step: 1 },
      rows: { start: 10, step: 10 },
      x: [0, 1, 2],
      y: [10, 20],
    };
    expect(unrotatePoint(none, { x: 1.5, y: 15 })).toEqual({ x: 1.5, y: 15 });
  });
});

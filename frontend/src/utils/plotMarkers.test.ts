import { describe, expect, it } from "vitest";

import {
  MAX_MARKER_SETS,
  MAX_MARKERS,
  markerAt,
  markerAtSameSpot,
  markerLabel,
  markerSetKey,
  nudgeMarker,
  placeMarker,
  withMarkerSet,
  type PlotMarker,
} from "./plotMarkers";

// One data unit is ten pixels on both axes.
const scale = { x: (value: number) => value * 10, y: (value: number) => value * 10 };
const samples = { x: [0, 1, 2, 3], y: [5, 2, 0.5, 4] };

const layout = (zUnit: string, xVariable = "gate") => ({
  meta: {
    qimchi_axes: { x: { variable: xVariable }, y: { variable: "current" } },
    qimchi_units: { x: { unit: "V" }, y: { unit: zUnit } },
  },
});

describe("markerSetKey", () => {
  it("names both axes with their units", () => {
    expect(markerSetKey(layout("A"))).toBe("gate [V] | current [A]");
  });

  it("keeps a filter that changes the unit, or another variable, apart", () => {
    expect(markerSetKey(layout("A/V"))).not.toBe(markerSetKey(layout("A")));
    expect(markerSetKey(layout("A", "bias"))).not.toBe(markerSetKey(layout("A")));
  });

  it("falls back to axis titles, and gives up without a name", () => {
    expect(markerSetKey({ xaxis: { title: { text: "Gate" } }, yaxis: { title: "Signal" } })).toBe(
      "Gate [] | Signal []",
    );
    expect(markerSetKey({ xaxis: { title: "Gate" } })).toBeNull();
    expect(markerSetKey(undefined)).toBeNull();
  });
});

describe("placeMarker", () => {
  it("snaps a vertical line to the nearest sample", () => {
    expect(placeMarker("vline", { x: 1.4, y: 9 }, samples, scale)).toMatchObject({ x: 1 });
  });

  it("snaps a point to the nearest point on the curve, on screen", () => {
    // Sample 1 is closest in x; sample 2 is closest by screen distance.
    expect(placeMarker("point", { x: 1.4, y: 0.6 }, samples, scale)).toMatchObject({
      x: 2,
      y: 0.5,
    });
  });

  it("snaps a horizontal line to the value of the nearest point on the curve", () => {
    const line = placeMarker("hline", { x: 1.4, y: 0.6 }, samples, scale);
    expect(line).toMatchObject({ y: 0.5 });
    expect(line.x).toBeUndefined();
  });

  it("places every kind exactly when asked", () => {
    const at = { x: 1.4, y: 0.6 };
    expect(placeMarker("vline", at, samples, scale, true)).toMatchObject({ x: 1.4 });
    expect(placeMarker("hline", at, samples, scale, true)).toMatchObject({ y: 0.6 });
    expect(placeMarker("point", at, samples, scale, true)).toMatchObject({ x: 1.4, y: 0.6 });
  });

  it("gives every marker its own id", () => {
    const a = placeMarker("vline", { x: 0, y: 0 }, samples, scale);
    const b = placeMarker("vline", { x: 0, y: 0 }, samples, scale);
    expect(a.id).not.toBe(b.id);
  });
});

describe("markerAt", () => {
  const markers: PlotMarker[] = [
    { id: "v", kind: "vline", x: 2 },
    { id: "h", kind: "hline", y: 3 },
    { id: "p", kind: "point", x: 2, y: 3 },
  ];

  it("prefers a point over the lines through it", () => {
    expect(markerAt(markers, { x: 21, y: 31 }, scale)).toBe("p");
  });

  it("picks a line within reach and nothing further away", () => {
    expect(markerAt(markers, { x: 24, y: 80 }, scale)).toBe("v");
    expect(markerAt(markers, { x: 70, y: 27 }, scale)).toBe("h");
    expect(markerAt(markers, { x: 50, y: 60 }, scale)).toBeNull();
  });
});

describe("markerLabel", () => {
  const format = { x: (v: number) => `${v} V`, y: (v: number) => `${v} A` };
  it("shows the values a marker fixes", () => {
    expect(markerLabel({ id: "a", kind: "vline", x: 1 }, format)).toBe("1 V");
    expect(markerLabel({ id: "a", kind: "hline", y: 2 }, format)).toBe("2 A");
    expect(markerLabel({ id: "a", kind: "point", x: 1, y: 2 }, format)).toBe("1 V, 2 A");
  });
});

describe("withMarkerSet", () => {
  const one: PlotMarker[] = [{ id: "a", kind: "vline", x: 1 }];

  it("removes a set when it is emptied, and everything with the last one", () => {
    const sets = withMarkerSet({ a: one, b: one }, "a", []);
    expect(sets).toEqual({ b: one });
    expect(withMarkerSet(sets, "b", [])).toBeUndefined();
  });

  it("caps the markers in a set", () => {
    const many = Array.from({ length: MAX_MARKERS + 5 }, (_, i) => ({
      id: String(i),
      kind: "vline" as const,
      x: i,
    }));
    expect(withMarkerSet(undefined, "a", many)!.a).toHaveLength(MAX_MARKERS);
  });

  it("drops the least recently changed set past the limit", () => {
    let sets: Record<string, PlotMarker[]> | undefined;
    for (let i = 0; i < MAX_MARKER_SETS; i++) sets = withMarkerSet(sets, `k${i}`, one);
    // Updating k0 makes k1 the least recently updated set.
    sets = withMarkerSet(sets, "k0", one);
    sets = withMarkerSet(sets, "new", one);
    expect(Object.keys(sets!)).toHaveLength(MAX_MARKER_SETS);
    expect(sets).toHaveProperty("k0");
    expect(sets).not.toHaveProperty("k1");
  });
});

describe("nudgeMarker", () => {
  // Use unsorted samples to verify that movement follows coordinate order.
  const curve = { x: [3, 0, 2, 1], y: [4, 5, 0.5, 2] };

  it("steps a vertical line or a point from sample to sample", () => {
    const line = { id: "v", kind: "vline" as const, x: 1 };
    expect(nudgeMarker(line, "right", curve)).toMatchObject({ x: 2 });
    expect(nudgeMarker(line, "left", curve)).toMatchObject({ x: 0 });
    const point = { id: "p", kind: "point" as const, x: 1, y: 2 };
    expect(nudgeMarker(point, "right", curve)).toMatchObject({ x: 2, y: 0.5 });
  });

  it("goes several samples at once, stopping at the ends", () => {
    const line = { id: "v", kind: "vline" as const, x: 1 };
    expect(nudgeMarker(line, "right", curve, 10)).toMatchObject({ x: 3 });
    expect(nudgeMarker({ ...line, x: 3 }, "right", curve)).toMatchObject({ x: 3 });
  });

  it("lands on the next sample from a position between samples", () => {
    const line = { id: "v", kind: "vline" as const, x: 1.4 };
    expect(nudgeMarker(line, "right", curve)).toMatchObject({ x: 2 });
    expect(nudgeMarker(line, "left", curve)).toMatchObject({ x: 1 });
  });

  it("steps a horizontal line through the values the curve takes", () => {
    // The curve's values, in order: 0.5, 2, 4, 5.
    const level = { id: "h", kind: "hline" as const, y: 2 };
    expect(nudgeMarker(level, "up", curve)).toMatchObject({ y: 4 });
    expect(nudgeMarker(level, "down", curve)).toMatchObject({ y: 0.5 });
    expect(nudgeMarker(level, "up", curve, 5)).toMatchObject({ y: 5 });
    expect(nudgeMarker({ ...level, y: 3 }, "down", curve)).toMatchObject({ y: 2 });
  });

  it("ignores keys that do not move a kind of marker", () => {
    expect(nudgeMarker({ id: "h", kind: "hline", y: 2 }, "left", curve)).toBeNull();
    expect(nudgeMarker({ id: "v", kind: "vline", x: 1 }, "up", curve)).toBeNull();
  });
});

describe("markerAtSameSpot", () => {
  const markers: PlotMarker[] = [
    { id: "v", kind: "vline", x: 2 },
    { id: "p", kind: "point", x: 2, y: 0.5 },
  ];

  it("finds a marker of the same kind at the same position", () => {
    expect(markerAtSameSpot(markers, { id: "n", kind: "vline", x: 2 })?.id).toBe("v");
    expect(markerAtSameSpot(markers, { id: "n", kind: "point", x: 2, y: 0.5 })?.id).toBe("p");
    // Floating-point noise from converting pixels still counts as the same spot.
    expect(markerAtSameSpot(markers, { id: "n", kind: "vline", x: 2 + 1e-12 })?.id).toBe("v");
  });

  it("ignores other kinds, other positions and the marker itself", () => {
    expect(markerAtSameSpot(markers, { id: "n", kind: "hline", y: 0.5 })).toBeUndefined();
    expect(markerAtSameSpot(markers, { id: "n", kind: "point", x: 2, y: 1 })).toBeUndefined();
    expect(markerAtSameSpot(markers, markers[0])).toBeUndefined();
  });
});

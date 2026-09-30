import { describe, expect, it } from "vitest";

import { engineeringPresentation, unitMetaFromLayout } from "./engineeringTicks";

const microamps = {
  unit: "A",
  engineering_scale: 1,
  engineering_titles: {
    "0": "Current (A)",
    "-3": "Current (mA)",
    "-6": "Current (µA)",
    "-9": "Current (nA)",
  },
};

describe("engineeringPresentation", () => {
  it("ticks a full sweep in the prefix that suits it", () => {
    const result = engineeringPresentation(microamps, [-1e-4, 1e-4], 5);

    expect(result?.title).toBe("Current (µA)");
    expect(result?.ticktext).toEqual(["−100", "−50", "0", "50", "100"]);
  });

  it("re-ticks for a zoomed-in range", () => {
    const result = engineeringPresentation(microamps, [-1.2e-5, 1.1e-5], 5);

    expect(result?.ticktext).toEqual(["−10", "0", "10"]);
    expect(result?.tickvals).toEqual([-1e-5, 0, 1e-5]);
  });

  it("moves to a smaller prefix when the zoom goes deep enough", () => {
    const result = engineeringPresentation(microamps, [-2e-9, 2e-9], 5);

    expect(result?.title).toBe("Current (nA)");
  });

  it("says nothing for an axis with no unit information", () => {
    expect(engineeringPresentation(undefined, [0, 1], 5)).toBeNull();
    expect(engineeringPresentation({ unit: "A" }, [0, 1], 5)).toBeNull();
  });

  it("puts the prefix on the labels when there is no unit to carry it", () => {
    // A filter can cancel the units; the magnitude still has to read sensibly.
    const result = engineeringPresentation({ unit: "", engineering_scale: 1 }, [0, 0.001], 5);

    expect(result?.title).toBeUndefined();
    expect(result?.ticktext.some((text) => text.endsWith("m"))).toBe(true);
  });
});

describe("unitMetaFromLayout", () => {
  it("reads the axis units the backend attached", () => {
    expect(unitMetaFromLayout({ meta: { qimchi_units: { x: microamps } } }).x).toBe(microamps);
    expect(unitMetaFromLayout({})).toEqual({});
    expect(unitMetaFromLayout(undefined)).toEqual({});
  });
});

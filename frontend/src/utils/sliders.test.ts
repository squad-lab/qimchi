import { describe, expect, it } from "vitest";

import { sliderIndexOf, sliderSteps, sliderText, sliderValueAt, visibleSliders } from "./sliders";

const param = { min: 0, max: 2, step: 1, value: 0, labels: ["deltaCq", "tau", "c"] };
const field = { min: -1, max: 1, step: 0.5, value: -1 };

describe("sliderText", () => {
  it("shows the label a labelled slider points at", () => {
    expect(sliderText(param, 1)).toBe("tau");
    expect(sliderText(param, 1.4)).toBe("tau");
  });

  it("shows the number for a numeric slider", () => {
    expect(sliderText(field, 0.5)).toBe("0.500000");
  });

  it("falls back to the number when a value has no label", () => {
    expect(sliderText(param, 7)).toBe("7.000000");
  });
});

describe("visibleSliders", () => {
  it("offers only the sliders the backend returned", () => {
    const stale = { ...field, value: 0.5 };

    const shown = visibleSliders({ param }, { param: { ...param, value: 2 }, Bperp: stale });

    expect(Object.keys(shown)).toEqual(["param"]);
    expect(shown.param.value).toBe(2);
  });

  it("starts a new slider at its minimum and keeps the backend's range and labels", () => {
    const shown = visibleSliders({ param, field }, {});

    expect(shown.field.value).toBe(-1);
    expect(shown.param).toEqual({ ...param, value: 0 });
  });
});

describe("slider steps", () => {
  // A step of 1/49 overshoots 1 after 49 steps in floating point, which left a
  // browser range input stuck one step short of the maximum.
  const uneven = { min: 0, max: 1, step: 1 / 49, value: 0 };

  it("reaches the maximum exactly on the last step", () => {
    expect(sliderSteps(uneven)).toBe(49);
    expect(sliderValueAt(uneven, 49)).toBe(1);
    expect(sliderValueAt(uneven, 48)).toBeCloseTo(48 / 49);
    expect(sliderIndexOf(uneven, 1)).toBe(49);
  });

  it("finds the nearest step for any value, within the range", () => {
    expect(sliderIndexOf(uneven, 0.5)).toBe(25);
    expect(sliderIndexOf(uneven, -3)).toBe(0);
    expect(sliderIndexOf(uneven, 3)).toBe(49);
  });

  it("works for labelled index sliders", () => {
    const param = { min: 0, max: 2, step: 1, value: 0 };
    expect(sliderSteps(param)).toBe(2);
    expect(sliderValueAt(param, 1)).toBe(1);
  });

  it("has no steps for a single-value dimension", () => {
    const single = { min: 5, max: 5, step: 1, value: 5 };
    expect(sliderSteps(single)).toBe(0);
    expect(sliderValueAt(single, 3)).toBe(5);
  });
});

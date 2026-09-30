import { describe, expect, it } from "vitest";

import { describePresetChanges, presetSummary, samePresetFilters } from "./filterPresets";

describe("filter presets", () => {
  it("summarises filters in the order they run", () => {
    expect(presetSummary([{ name: "savgol" }, { name: "diff_y" }])).toBe(
      "Savitzky-Golay → Diff along X",
    );
  });

  it("treats options in another key order as the same preset", () => {
    expect(
      samePresetFilters(
        [{ name: "savgol", options: { window: 5, polyorder: 2 } }],
        [{ name: "savgol", options: { polyorder: 2, window: 5 } }],
      ),
    ).toBe(true);
    expect(samePresetFilters([{ name: "flip" }], [{ name: "flip", options: {} }])).toBe(true);
  });

  it("notices reordered filters and changed options", () => {
    const smoothThenDiff = [{ name: "savgol", options: { window: 5 } }, { name: "diff_x" }];
    expect(samePresetFilters(smoothThenDiff, [...smoothThenDiff].reverse())).toBe(false);
    expect(
      samePresetFilters(smoothThenDiff, [
        { name: "savgol", options: { window: 7 } },
        { name: "diff_x" },
      ]),
    ).toBe(false);
  });

  it("describes what changed since a preset, in words", () => {
    const saved = [
      { name: "log_scale", options: { enabled: true } },
      { name: "savgol", options: { window: 5 } },
    ];
    expect(describePresetChanges(saved, saved)).toEqual([]);
    expect(
      describePresetChanges(saved, [
        ...saved,
        { name: "diff_y", options: {} },
        { name: "diff_x", options: {} },
      ]),
    ).toEqual(["Added Diff along X", "Added Diff along Y"]);
    expect(describePresetChanges(saved, [saved[0]])).toEqual(["Removed Savitzky-Golay"]);
    expect(
      describePresetChanges(saved, [{ name: "savgol", options: { window: 9 } }, saved[0]]),
    ).toEqual(["Changed Savitzky-Golay: window 5 → 9", "Changed the order"]);
  });

  it("names the settings that changed, and nothing else, when only settings did", () => {
    const saved = [
      { name: "flip", options: {} },
      { name: "r_in_correction", options: { r_in: 1, r_in_unit: "kΩ", bias_axis: "x" } },
    ];
    const current = [
      { name: "flip", options: {} },
      { name: "r_in_correction", options: { r_in: 2.5, r_in_unit: "MΩ", bias_axis: "x" } },
    ];
    expect(describePresetChanges(saved, current)).toEqual([
      "Changed R_in Correction: r_in 1 → 2.5, r_in_unit kΩ → MΩ",
    ]);
    // Settings that are lists or objects are named without their values.
    expect(
      describePresetChanges(
        [{ name: "bg_corr_plane", options: { points: [[0, 0]] } }],
        [{ name: "bg_corr_plane", options: { points: [[1, 1]] } }],
      ),
    ).toEqual(["Changed BG Correction (Plane): points"]);
  });
});

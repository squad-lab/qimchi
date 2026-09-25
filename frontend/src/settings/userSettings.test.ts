import { describe, expect, it } from "vitest";

import {
  applyPatch,
  FACTORY_SETTINGS,
  normalizeStored,
  patchFor,
  resolveSettings,
} from "./userSettings";

describe("resolveSettings", () => {
  it("fills everything not stored from the defaults", () => {
    expect(resolveSettings({})).toEqual(FACTORY_SETTINGS);
    expect(resolveSettings({ general: { zoom: 1.25 } }).general).toEqual({
      ...FACTORY_SETTINGS.general,
      zoom: 1.25,
    });
  });

  it("ignores malformed values instead of breaking the app", () => {
    const settings = resolveSettings({
      general: { theme: "sepia", zoom: "big", plotWidth: 40 },
      export: { formats: [], scale: "2", folder: 3 },
      appearance: { heatmap: { hmap: { colorscale: 7 } } },
    });

    expect(settings.general).toEqual(FACTORY_SETTINGS.general);
    expect(settings.export).toEqual(FACTORY_SETTINGS.export);
    expect(settings.appearance.heatmap.hmap?.colorscale).toBe("viridis");
  });

  it("accepts a value where the default is null", () => {
    const settings = resolveSettings({ export: { scale: 2, folder: "D:/exports" } });

    expect(settings.export.scale).toBe(2);
    expect(settings.export.folder).toBe("D:/exports");
  });
});

describe("live refresh", () => {
  it("defaults to refreshing at most every 300 ms", () => {
    expect(resolveSettings({}).live.minRefreshMs).toBe(300);
  });

  it("accepts only the offered choices", () => {
    expect(resolveSettings({ live: { minRefreshMs: 100 } }).live.minRefreshMs).toBe(100);
    expect(resolveSettings({ live: { minRefreshMs: 1000 } }).live.minRefreshMs).toBe(1000);
    // Off the 50 ms grid, or out of range.
    expect(resolveSettings({ live: { minRefreshMs: 125 } }).live.minRefreshMs).toBe(300);
    expect(resolveSettings({ live: { minRefreshMs: 2000 } }).live.minRefreshMs).toBe(300);
    // Clamp imported or manually edited values below the safe minimum.
    expect(resolveSettings({ live: { minRefreshMs: 5 } }).live.minRefreshMs).toBe(300);
    expect(resolveSettings({ live: { minRefreshMs: "fast" } }).live.minRefreshMs).toBe(300);
  });

  it("is not stored while it is at its default", () => {
    expect(patchFor(["live", "minRefreshMs"], 300)).toEqual({ live: { minRefreshMs: null } });
  });
});

describe("patchFor", () => {
  it("stores a changed value and removes one set back to its default", () => {
    expect(patchFor(["general", "zoom"], 1.5)).toEqual({ general: { zoom: 1.5 } });
    expect(patchFor(["general", "zoom"], 1)).toEqual({ general: { zoom: null } });
  });

  it("only keeps the leaves of a section that differ from the defaults", () => {
    const heatmap = {
      ...FACTORY_SETTINGS.appearance.heatmap,
      hmap: { colorscale: "plasma", rangecolor: null },
    };

    const stored = applyPatch({}, patchFor(["appearance", "heatmap"], heatmap));

    expect(stored).toEqual({ appearance: { heatmap: { hmap: { colorscale: "plasma" } } } });
  });
});

describe("applyPatch", () => {
  it("merges nested values and drops sections left empty", () => {
    const stored = applyPatch(
      { general: { theme: "dark", zoom: 1.5 }, explorer: { sortBy: "name" } },
      { general: { zoom: null }, explorer: { sortBy: null } },
    );

    expect(stored).toEqual({ general: { theme: "dark" } });
  });
});

describe("normalizeStored", () => {
  it("keeps only valid values that differ from the defaults", () => {
    expect(
      normalizeStored({
        general: { theme: "dark", zoom: 1, plotWidth: 7 },
        unknown: { anything: true },
      }),
    ).toEqual({ general: { theme: "dark" } });
  });
});

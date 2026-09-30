import { describe, expect, it } from "vitest";

import type { ComposerSelectionSnapshot } from "../components/PlotComposer";
import { axisCombinations, missingAxesMessage } from "./composerAxes";

const snapshot = (overrides: Partial<ComposerSelectionSnapshot>): ComposerSelectionSnapshot => ({
  plotType: "LinePlot",
  indeps: [],
  deps: [],
  x: [],
  y: [],
  z: [],
  hasRequiredAxes: false,
  hasAnySelections: false,
  fieldSources: [],
  ...overrides,
});

describe("axisCombinations", () => {
  it("makes one line plot per Y field", () => {
    expect(axisCombinations(snapshot({ x: ["f"], y: ["mag", "phase"] }))).toEqual([
      { indeps: ["f"], deps: ["mag"] },
      { indeps: ["f"], deps: ["phase"] },
    ]);
  });

  it("makes one heat map per Y and Z pair, with the Composer's X along X", () => {
    expect(
      axisCombinations(
        snapshot({ plotType: "HeatMap", x: ["f"], y: ["v1", "v2"], z: ["mag", "phase"] }),
      ),
    ).toEqual([
      { indeps: ["v1", "f"], deps: ["mag"] },
      { indeps: ["v1", "f"], deps: ["phase"] },
      { indeps: ["v2", "f"], deps: ["mag"] },
      { indeps: ["v2", "f"], deps: ["phase"] },
    ]);
  });

  it("makes no heat map without a Z field", () => {
    expect(axisCombinations(snapshot({ plotType: "HeatMap", x: ["f"], y: ["v"] }))).toEqual([]);
  });
});

describe("missingAxesMessage", () => {
  it("asks for a Z field when a heat map has only its axes", () => {
    expect(missingAxesMessage(snapshot({ plotType: "HeatMap", x: ["f"], y: ["v"] }))).toMatch(
      /Z-axis/,
    );
  });

  it("asks for X and Y otherwise", () => {
    expect(missingAxesMessage(snapshot({ plotType: "HeatMap", x: ["f"] }))).toMatch(/X and Y/);
  });
});

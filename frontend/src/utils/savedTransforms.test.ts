import { beforeEach, describe, expect, it } from "vitest";

import { withSavedTransforms } from "./savedTransforms";
import { usePlotStore } from "../stores/plotStore";
import type { PlotConfiguration } from "../components/interfaces";

const config = (): PlotConfiguration =>
  ({
    id: "plot-1",
    fpath: "/data/run.zarr",
    indeps: ["gate"],
    deps: ["current"],
    plotType: "LinePlot",
    source: "disk",
  }) as PlotConfiguration;

describe("withSavedTransforms", () => {
  beforeEach(() => {
    usePlotStore.getState().clearAllStates();
  });

  it("leaves a plot with nothing saved alone", () => {
    const original = config();
    expect(withSavedTransforms(original)).toBe(original);
  });

  it("puts saved filters back into the config", () => {
    usePlotStore
      .getState()
      .setPlotFilters("plot-1", [{ name: "diff", options: { axis: "x" } }] as never);

    const restored = withSavedTransforms(config());

    expect(restored.filters_order).toEqual(["diff"]);
    expect(restored.filters_opts).toEqual({ diff: { axis: "x" } });
  });

  it("puts saved sliders back into the config", () => {
    usePlotStore
      .getState()
      .setPlotSliders("plot-1", { field: { value: 2, min: 0, max: 4 } } as never);

    expect(withSavedTransforms(config()).slider).toEqual({ field: { value: 2, min: 0, max: 4 } });
  });

  it("does not resurrect filters the user cleared", () => {
    usePlotStore.getState().setPlotFilters("plot-1", []);

    const restored = withSavedTransforms({
      ...config(),
      filters_order: ["diff"],
      filters_opts: { diff: { axis: "x" } },
    });

    expect(restored.filters_order).toEqual([]);
    expect(restored.filters_opts).toEqual({});
  });

  it("does not resurrect sliders the user cleared", () => {
    usePlotStore.getState().setPlotSliders("plot-1", {});

    const restored = withSavedTransforms({
      ...config(),
      slider: { field: { value: 2, min: 0, max: 4 } } as never,
    });

    expect(restored.slider).toEqual({});
  });
});

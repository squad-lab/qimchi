import { beforeEach, describe, expect, it } from "vitest";

import { usePlotStore } from "./plotStore";

beforeEach(() => {
  usePlotStore.setState({ plotStates: {} });
});

const appearance = { showGrid: true } as never;

describe("plotStore", () => {
  it("keeps each plot's state under its own id", () => {
    usePlotStore.getState().setPlotAppearance("plot-1", appearance);
    usePlotStore.getState().setPlotAppearance("plot-2", appearance);

    expect(Object.keys(usePlotStore.getState().plotStates).sort()).toEqual(["plot-1", "plot-2"]);
    expect(usePlotStore.getState().getPlotState("plot-1")?.id).toBe("plot-1");
  });

  it("merges settings rather than replacing a plot's whole state", () => {
    // Appearance, filters and sliders are set independently by different
    // dialogs; one must not wipe another.
    usePlotStore.getState().setPlotAppearance("plot-1", appearance);
    usePlotStore.getState().setPlotFilters("plot-1", [{ name: "scale", options: {} }] as never);
    usePlotStore.getState().setPlotAxesSwapped("plot-1", true);

    const state = usePlotStore.getState().getPlotState("plot-1");
    expect(state?.appearance_settings).toEqual(appearance);
    expect(state?.applied_filters).toHaveLength(1);
    expect(state?.axes_swapped).toBe(true);
  });

  it("returns undefined for a plot it has never seen", () => {
    expect(usePlotStore.getState().getPlotState("nope")).toBeUndefined();
  });

  it("removes one plot's state and leaves the others", () => {
    usePlotStore.getState().setPlotAppearance("plot-1", appearance);
    usePlotStore.getState().setPlotAppearance("plot-2", appearance);

    usePlotStore.getState().removePlotState("plot-1");

    expect(usePlotStore.getState().getPlotState("plot-1")).toBeUndefined();
    expect(usePlotStore.getState().getPlotState("plot-2")).toBeDefined();
  });

  it("clears every plot at once", () => {
    usePlotStore.getState().setPlotAppearance("plot-1", appearance);

    usePlotStore.getState().clearAllStates();

    expect(usePlotStore.getState().plotStates).toEqual({});
  });
});

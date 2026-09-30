import { beforeEach, describe, expect, it } from "vitest";

import { usePlotStore } from "./plotStore";

beforeEach(() => {
  usePlotStore.setState({ plotStates: {} });
});

const appearance = { x: { maj: { showgrid: true } } };

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
    expect(state?.appearance_overrides).toEqual(appearance);
    expect(state?.applied_filters).toHaveLength(1);
    expect(state?.axes_swapped).toBe(true);
  });

  it("replaces an old whole-appearance save with overrides", () => {
    usePlotStore.setState({
      plotStates: { "plot-1": { id: "plot-1", appearance_settings: { line: {} } } },
    });

    usePlotStore.getState().setPlotAppearance("plot-1", appearance);

    const state = usePlotStore.getState().getPlotState("plot-1");
    expect(state?.appearance_settings).toBeUndefined();
    expect(state?.appearance_overrides).toEqual(appearance);
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

  it("links a plot's filters to a preset until they are cleared", () => {
    const store = usePlotStore.getState();
    store.setPlotFilters("plot-1", [{ name: "flip", options: {} }] as never);
    store.setPlotPresetLink("plot-1", 4);
    store.setPlotFilters("plot-1", [{ name: "diff", options: {} }] as never);
    expect(usePlotStore.getState().getPlotState("plot-1")?.filter_preset_id).toBe(4);

    usePlotStore.getState().setPlotFilters("plot-1", []);
    expect(usePlotStore.getState().getPlotState("plot-1")).not.toHaveProperty("filter_preset_id");
  });

  it("drops every link to a removed preset, and nothing else", () => {
    const store = usePlotStore.getState();
    store.setPlotPresetLink("plot-1", 4);
    store.setPlotPresetLink("plot-2", 4);
    store.setPlotPresetLink("plot-3", 5);

    usePlotStore.getState().unlinkPreset(4);

    const states = usePlotStore.getState().plotStates;
    expect(states["plot-1"]).not.toHaveProperty("filter_preset_id");
    expect(states["plot-2"]).not.toHaveProperty("filter_preset_id");
    expect(states["plot-3"].filter_preset_id).toBe(5);
    // Nothing to unlink leaves the state object as it was.
    const before = usePlotStore.getState().plotStates;
    usePlotStore.getState().unlinkPreset(99);
    expect(usePlotStore.getState().plotStates).toBe(before);
  });

  it("forgets a removed plot's link along with the rest of its state", () => {
    usePlotStore.getState().setPlotPresetLink("plot-1", 4);
    usePlotStore.getState().keepOnly([]);
    expect(usePlotStore.getState().plotStates).toEqual({});
  });
});

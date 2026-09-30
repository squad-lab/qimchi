import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { usePlotStore } from "../stores/plotStore";
import { usePlotCollection } from "./usePlotCollection";

const config = {
  fpath: "C:/data/run.zarr",
  indeps: ["gate"],
  deps: ["signal"],
  plotType: "LinePlot" as const,
  filters_order: [],
  filters_opts: {},
  slider: {},
  source: "disk" as const,
  preferredSource: "disk" as const,
};

beforeEach(() => {
  usePlotStore.setState({ plotStates: {} });
});

describe("usePlotCollection", () => {
  it("forgets a closed plot's saved state", () => {
    // Plot ids are never reused, and the state is persisted, so anything left
    // behind grows for as long as the browser profile lives.
    const { result } = renderHook(() => usePlotCollection());
    act(() => result.current.addPlot(config));
    const id = result.current.plotConfigs[0].id;
    act(() => usePlotStore.getState().setPlotFilters(id, [{ name: "scale", options: {} }]));

    act(() => result.current.removePlot(id));

    expect(usePlotStore.getState().plotStates).toEqual({});
  });

  it("forgets every plot's state when the workspace is cleared", () => {
    const { result } = renderHook(() => usePlotCollection());
    act(() => result.current.addPlots([config, { ...config, deps: ["other"] }]));
    for (const plot of result.current.plotConfigs) {
      act(() => usePlotStore.getState().setPlotAxesSwapped(plot.id, true));
    }

    act(() => result.current.clearPlots());

    expect(usePlotStore.getState().plotStates).toEqual({});
  });

  it("keeps pinned plots at the start of the list", () => {
    const { result } = renderHook(() => usePlotCollection());
    act(() => result.current.addPlots([config, { ...config, deps: ["other"] }]));
    const pinnedId = result.current.plotConfigs[1].id;

    act(() => result.current.setPlotPinned(pinnedId, true));
    expect(result.current.plotConfigs[0].id).toBe(pinnedId);

    act(() => result.current.addPlot({ ...config, deps: ["new"] }));
    expect(result.current.plotConfigs[0].id).toBe(pinnedId);

    act(() => result.current.movePlot(pinnedId, result.current.plotConfigs.length - 1));
    expect(result.current.plotConfigs[0].id).toBe(pinnedId);
  });
});

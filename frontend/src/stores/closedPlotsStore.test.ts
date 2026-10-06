import { beforeEach, describe, expect, it } from "vitest";

import type { PlotConfiguration } from "../components/interfaces";
import { SESSION_KEYS } from "../utils/sessionRestore";
import { useClosedPlotsStore, type ClosedPlot } from "./closedPlotsStore";
import { useSettingsStore } from "./settingsStore";
import { FACTORY_SETTINGS } from "../settings/userSettings";

const plot = (id: string, index = 0): ClosedPlot => ({
  config: {
    id,
    fpath: "/data/run.zarr",
    indeps: ["x"],
    deps: ["y"],
    plotType: "LinePlot",
  } as PlotConfiguration,
  index,
  closedAt: 0,
});

const setLimit = (closedPlotsLimit: number) =>
  useSettingsStore.setState((state) => ({
    settings: { ...state.settings, plots: { ...state.settings.plots, closedPlotsLimit } },
  }));

const ids = () =>
  useClosedPlotsStore.getState().actions.map((action) => action.plots.map((p) => p.config.id));

describe("closedPlotsStore", () => {
  beforeEach(() => {
    setLimit(FACTORY_SETTINGS.plots.closedPlotsLimit);
    useClosedPlotsStore.getState().clear();
    window.sessionStorage.clear();
  });

  it("reopens the newest close first, one whole close at a time", () => {
    const { record, take } = useClosedPlotsStore.getState();
    record([plot("a")]);
    record([plot("c", 1), plot("b", 0)]);

    // Plots within each close action retain their Viewer order.
    expect(take()?.plots.map((p) => p.config.id)).toEqual(["b", "c"]);
    expect(take()?.plots.map((p) => p.config.id)).toEqual(["a"]);
    expect(take()).toBeNull();
  });

  it("takes a given close, or a single plot out of one", () => {
    const { record, take, takePlot } = useClosedPlotsStore.getState();
    const first = record([plot("a")])!;
    record([plot("b", 0), plot("c", 1)]);

    expect(take(first)?.plots[0].config.id).toBe("a");
    expect(takePlot("b")?.config.id).toBe("b");
    expect(ids()).toEqual([["c"]]);
    expect(takePlot("c")?.config.id).toBe("c");
    expect(ids()).toEqual([]);
    expect(takePlot("c")).toBeNull();
  });

  it("keeps as many plots as Settings allows, dropping the oldest", () => {
    const max = FACTORY_SETTINGS.plots.closedPlotsLimit;
    const { record } = useClosedPlotsStore.getState();
    for (let i = 0; i < max - 2; i++) record([plot(`old${i}`)]);
    record(Array.from({ length: 4 }, (_, i) => plot(`new${i}`, i)));

    const kept = ids().flat();
    expect(kept).toHaveLength(max);
    expect(kept.slice(0, 4)).toEqual(["new0", "new1", "new2", "new3"]);
    expect(kept).not.toContain("old0");
    expect(kept).not.toContain("old1");
  });

  it("drops the oldest plots at once when the limit is lowered", () => {
    const { record } = useClosedPlotsStore.getState();
    for (let i = 0; i < 6; i++) record([plot(`p${i}`)]);
    setLimit(3);
    expect(ids().flat()).toEqual(["p5", "p4", "p3"]);
    record([plot("p6")]);
    expect(ids().flat()).toEqual(["p6", "p5", "p4"]);
  });

  it("mirrors the list to the session, so a reload keeps it", () => {
    useClosedPlotsStore.getState().record([plot("a")]);
    const saved = JSON.parse(window.sessionStorage.getItem(SESSION_KEYS.closedPlots)!);
    expect(saved[0].plots[0].config.id).toBe("a");
  });

  it("ignores an empty close", () => {
    expect(useClosedPlotsStore.getState().record([])).toBeNull();
    expect(ids()).toEqual([]);
  });
});

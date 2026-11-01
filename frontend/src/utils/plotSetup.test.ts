import { beforeAll, describe, expect, it, vi } from "vitest";

import {
  buildPlotSetup,
  composerAxesFor,
  planPlotSetup,
  plotSetupFileName,
  readPlotSetup,
  readPlotSetupValue,
  type SavedPlot,
} from "./plotSetup";
import type { PlotConfiguration, PlotPersistentState } from "../components/interfaces";
import type { DatasetLike } from "./datasetFieldSelectors";
import { FACTORY_APPEARANCE_SETTINGS } from "../components/Plots/appearanceDefaults";
import type { PlotAppearanceSettings } from "../components/types";

beforeAll(() => {
  vi.stubGlobal("__QIMCHI_VERSION__", "0.7.2");
});

const factory = () => FACTORY_APPEARANCE_SETTINGS;

const heatmap = (id: string, fpath = "C:\\data\\a.zarr"): PlotConfiguration => ({
  id,
  fpath,
  indeps: ["gate", "bias"],
  deps: ["current"],
  plotType: "HeatMap",
  source: "disk",
  origin: "custom",
});

const dataset = (
  name: string,
  dependents = ["current"],
  path = `C:\\data\\${name}`,
): DatasetLike => ({
  id: name,
  name,
  path,
  attributes: {
    independents: ["gate", "bias"],
    dependents,
    variable_independents: Object.fromEntries(dependents.map((dep) => [dep, ["gate", "bias"]])),
    independent_dimensions: { gate: ["gate"], bias: ["bias"] },
  },
});

const withColorscale = (colorscale: string): PlotAppearanceSettings => ({
  ...FACTORY_APPEARANCE_SETTINGS,
  hmap: { ...FACTORY_APPEARANCE_SETTINGS.hmap, colorscale },
});

describe("buildPlotSetup", () => {
  it("saves what a plot shows and how, without its measurement", () => {
    const state: PlotPersistentState = {
      id: "p1",
      applied_filters: [{ name: "diff_x", options: { enabled: true } }],
      slider_settings: { field: { min: 0, max: 1, step: 0.5, value: 0.5 } },
      axes_swapped: true,
    };
    const setup = buildPlotSetup(
      [heatmap("p1")],
      () => state,
      () => 50,
      factory,
    );

    expect(setup.qimchi).toBe("plot-setup");
    expect(setup.qimchiVersion).toBe("0.7.2");
    expect(setup.plots).toEqual([
      {
        plotType: "HeatMap",
        indeps: ["gate", "bias"],
        deps: ["current"],
        filters: state.applied_filters,
        sliders: state.slider_settings,
        axesSwapped: true,
        width: 50,
        origin: "custom",
      },
    ]);
    expect(JSON.stringify(setup)).not.toContain("a.zarr");
  });

  it("saves one plot replicated over several measurements once", () => {
    const setup = buildPlotSetup(
      [heatmap("p1"), heatmap("p2", "C:\\data\\b.zarr")],
      () => undefined,
      () => undefined,
      factory,
    );

    expect(setup.plots).toHaveLength(1);
  });

  it("uses the filters in the plot's configuration when it has no saved state yet", () => {
    const config = {
      ...heatmap("p1"),
      filters_order: ["flip"],
      filters_opts: { flip: { enabled: true } },
    };
    const setup = buildPlotSetup(
      [config],
      () => undefined,
      () => undefined,
      factory,
    );

    expect(setup.plots[0].filters).toEqual([{ name: "flip", options: { enabled: true } }]);
  });

  it("saves the look against the built-in defaults, so the user's own defaults travel with it", () => {
    const setup = buildPlotSetup(
      [heatmap("p1")],
      () => undefined,
      () => undefined,
      () => withColorscale("magma"),
    );

    expect(setup.plots[0].appearance).toEqual({ hmap: { colorscale: "magma" } });
  });
});

describe("readPlotSetup", () => {
  const file = (plots: unknown[], extra: Record<string, unknown> = {}) =>
    JSON.stringify({ qimchi: "plot-setup", formatVersion: 1, plots, ...extra });

  it("refuses text that is not JSON or not a plot setup", () => {
    expect(readPlotSetup("{").ok).toBe(false);
    expect(readPlotSetup(JSON.stringify({ qimchi: "settings", settings: {} })).ok).toBe(false);
  });

  it("refuses a file from a newer format", () => {
    const read = readPlotSetup(
      file([{ plotType: "LinePlot", indeps: ["x"], deps: ["y"] }], {
        formatVersion: 2,
      }),
    );

    expect(read.ok).toBe(false);
  });

  it("drops plots it cannot draw and counts them", () => {
    const read = readPlotSetup(
      file([
        { plotType: "LinePlot", indeps: ["x"], deps: ["y"], filters: [{ name: "flip" }, 3] },
        { plotType: "HeatMap", indeps: ["x"], deps: ["z"] },
        { plotType: "Surface", indeps: ["x", "y"], deps: ["z"] },
      ]),
    );

    expect(read).toEqual({
      ok: true,
      plots: [{ plotType: "LinePlot", indeps: ["x"], deps: ["y"], filters: [{ name: "flip" }] }],
      unreadable: 2,
    });
  });

  it("refuses a file with no drawable plots", () => {
    expect(readPlotSetup(file([{ plotType: "HeatMap", indeps: [], deps: [] }])).ok).toBe(false);
  });
});

describe("planPlotSetup", () => {
  const saved: SavedPlot = {
    plotType: "HeatMap",
    indeps: ["gate", "bias"],
    deps: ["current"],
    filters: [{ name: "diff_x", options: { enabled: true } }],
    axesSwapped: true,
    appearance: { hmap: { colorscale: "magma" } },
    width: 66,
  };

  it("draws each saved plot for each measurement that has its variables", () => {
    const { planned, skipped } = planPlotSetup(
      [saved],
      [dataset("a.zarr"), dataset("b.zarr", ["voltage"])],
      factory,
    );

    expect(skipped).toEqual(["current against gate and bias for b.zarr"]);
    expect(planned).toHaveLength(1);
    expect(planned[0].config).toMatchObject({
      fpath: "C:\\data\\a.zarr",
      plotType: "HeatMap",
      indeps: ["gate", "bias"],
      deps: ["current"],
      filters_order: ["diff_x"],
      filters_opts: { diff_x: { enabled: true } },
      source: "disk",
      origin: "custom",
    });
    expect(planned[0].state).toEqual({
      applied_filters: saved.filters,
      axes_swapped: true,
      appearance_overrides: { hmap: { colorscale: "magma" } },
    });
    expect(planned[0].width).toBe(66);
  });

  it("stores only the parts of the look that differ from the user's defaults", () => {
    const { planned } = planPlotSetup([saved], [dataset("a.zarr")], () => withColorscale("magma"));

    expect(planned[0].state.appearance_overrides).toBeUndefined();
  });

  it("keeps a live measurement live", () => {
    const { planned } = planPlotSetup(
      [saved],
      [dataset("run", ["current"], "memory://run")],
      factory,
    );

    expect(planned[0].config.source).toBe("memory");
  });

  it("skips a measurement whose variables are not known yet", () => {
    const { planned, skipped } = planPlotSetup(
      [saved],
      [{ id: "c", name: "c.zarr", path: "C:\\data\\c.zarr" }],
      factory,
    );

    expect(planned).toEqual([]);
    expect(skipped).toHaveLength(1);
  });
});

describe("composerAxesFor", () => {
  const line = (x: string, y: string): SavedPlot => ({
    plotType: "LinePlot",
    indeps: [x],
    deps: [y],
  });
  const hmap = (x: string, y: string, z: string): SavedPlot => ({
    plotType: "HeatMap",
    indeps: [y, x],
    deps: [z],
  });

  it("finds the Composer selection behind plots of one type", () => {
    expect(composerAxesFor([line("t", "a"), line("t", "b")])).toEqual({
      plotType: "LinePlot",
      x: ["t"],
      y: ["a", "b"],
      z: [],
    });
    expect(composerAxesFor([line("t", "a"), line("s", "a")])).toEqual({
      plotType: "LinePlot",
      x: ["t", "s"],
      y: ["a"],
      z: [],
    });
    expect(
      composerAxesFor([
        hmap("gate", "bias", "i"),
        hmap("gate", "bias", "r"),
        hmap("gate", "field", "i"),
        hmap("gate", "field", "r"),
      ]),
    ).toEqual({ plotType: "HeatMap", x: ["gate"], y: ["bias", "field"], z: ["i", "r"] });
  });

  it("finds none for plots one Composer selection cannot draw together", () => {
    expect(composerAxesFor([line("t", "a"), hmap("gate", "bias", "i")])).toBeNull();
    expect(composerAxesFor([line("t", "a"), line("s", "b")])).toBeNull();
    expect(composerAxesFor([line("t", "a"), line("s", "a"), line("t", "b")])).toBeNull();
    expect(composerAxesFor([hmap("gate", "bias", "i"), hmap("gate", "field", "r")])).toBeNull();
  });
});

describe("plot setup names", () => {
  it("travel with the file", () => {
    const setup = buildPlotSetup(
      [heatmap("p1")],
      () => undefined,
      () => undefined,
      factory,
      "Gate maps",
    );

    const read = readPlotSetup(JSON.stringify(setup));
    expect(read.ok && read.name).toBe("Gate maps");
    expect(readPlotSetupValue(setup)).toEqual(read);
  });

  it("become file names without characters file systems refuse", () => {
    expect(plotSetupFileName("Gate maps")).toBe("Gate maps.json");
    expect(plotSetupFileName('a/b\\c: "d"?')).toBe("a-b-c- -d--.json");
    expect(plotSetupFileName("setup.json")).toBe("setup.json");
    expect(plotSetupFileName("  ")).toBe("qimchi-plots.json");
  });
});

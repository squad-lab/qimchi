import { describe, expect, it } from "vitest";

import { generateAutoPlotConfigs, replicatePlots } from "./autoPlot";
import type { BasketItem } from "../components/Basket";

const item = (
  independents?: string[],
  dependents?: string[],
  path = "C:\\data\\run.zarr",
  variableIndependents?: Record<string, string[]>,
): BasketItem =>
  ({
    id: "run-1",
    name: "run.zarr",
    path,
    type: "file",
    attributes:
      independents || dependents
        ? {
            independents,
            dependents,
            ...(variableIndependents ? { variable_independents: variableIndependents } : {}),
          }
        : undefined,
  }) as BasketItem;

describe("generateAutoPlotConfigs", () => {
  it("makes only the heatmap by default when one can be plotted", () => {
    const result = generateAutoPlotConfigs(item(["gate", "bias"], ["signal"]));

    expect(result.plotConfigs.map((config) => config.plotType)).toEqual(["HeatMap"]);
  });

  it("makes no plots when the behaviour is none", () => {
    const result = generateAutoPlotConfigs(item(["gate", "bias"], ["signal"]), [], [], "none");

    expect(result.plotConfigs).toEqual([]);
  });

  it("makes both a heatmap and a lineplot when asked for both", () => {
    const result = generateAutoPlotConfigs(item(["gate", "bias"], ["signal"]), [], [], "both");

    expect(result.success).toBe(true);
    expect(result.plotConfigs.map((config) => config.plotType)).toEqual(["HeatMap", "LinePlot"]);
    // The heatmap takes both independents; the lineplot takes the first.
    expect(result.plotConfigs[0].indeps).toEqual(["gate", "bias"]);
    expect(result.plotConfigs[1].indeps).toEqual(["gate"]);
  });

  it("puts the first genuinely 2D dependent on the heatmap", () => {
    // Two lock-in readings along the voltage sweep, then an S21 map over
    // voltage AND frequency. dependents[0] is 1D, so it must not be the Z.
    const result = generateAutoPlotConfigs(
      item(["up_voltages", "f"], ["lockin_amp_up", "s21_mag", "s21_phase"], undefined, {
        lockin_amp_up: ["up_voltages"],
        s21_mag: ["up_voltages", "f"],
        s21_phase: ["up_voltages", "f"],
      }),
      [],
      [],
      "both",
    );

    const [heatmap, lineplot] = result.plotConfigs;
    expect(heatmap.plotType).toBe("HeatMap");
    expect(heatmap.deps).toEqual(["s21_mag"]);
    expect(heatmap.indeps).toEqual(["up_voltages", "f"]);
    // The lineplot keeps the first dependent, against the coordinate it
    // actually varies over.
    expect(lineplot.deps).toEqual(["lockin_amp_up"]);
    expect(lineplot.indeps).toEqual(["up_voltages"]);
  });

  it("plots a 1D dependent against its own independent, not the dataset's first", () => {
    const result = generateAutoPlotConfigs(
      item(["f", "up_voltages"], ["lockin_amp_up"], undefined, {
        lockin_amp_up: ["up_voltages"],
      }),
    );

    // Only a lineplot: no dependent varies over two independents.
    expect(result.plotConfigs.map((config) => config.plotType)).toEqual(["LinePlot"]);
    expect(result.plotConfigs[0].indeps).toEqual(["up_voltages"]);
  });

  it("makes no heatmap when every dependent is 1D", () => {
    const result = generateAutoPlotConfigs(
      item(["gate", "bias"], ["signal"], undefined, { signal: ["gate"] }),
    );

    expect(result.plotConfigs.map((config) => config.plotType)).toEqual(["LinePlot"]);
  });

  it("falls back to the first two independents when dims are unknown", () => {
    // Flat tables, and payloads cached before variable_independents existed.
    const result = generateAutoPlotConfigs(item(["gate", "bias"], ["signal"]));

    expect(result.plotConfigs[0].plotType).toBe("HeatMap");
    expect(result.plotConfigs[0].indeps).toEqual(["gate", "bias"]);
  });

  it("makes only a lineplot when there is a single independent", () => {
    const result = generateAutoPlotConfigs(item(["gate"], ["signal"]));

    expect(result.plotConfigs.map((config) => config.plotType)).toEqual(["LinePlot"]);
  });

  it("marks a live measurement as a memory source", () => {
    // The source decides which loader the backend uses for the plot.
    const result = generateAutoPlotConfigs(item(["gate"], ["signal"], "memory://abc"));

    expect(result.plotConfigs[0].source).toBe("memory");
    expect(result.plotConfigs[0].preferredSource).toBe("memory");
  });

  it("declines anything that is not a measurement it can plot", () => {
    expect(generateAutoPlotConfigs(item(["gate"], ["signal"], "C:/notes.md")).success).toBe(false);
    // Attributes still loading.
    expect(generateAutoPlotConfigs(item()).success).toBe(false);
    // Loaded, but nothing to put on an axis.
    expect(generateAutoPlotConfigs(item([], ["signal"])).success).toBe(false);
    expect(generateAutoPlotConfigs(item(["gate"], [])).success).toBe(false);
  });

  it("carries the source plot's filters onto each generated plot", () => {
    const result = generateAutoPlotConfigs(
      item(["gate", "bias"], ["signal"]),
      [{ name: "bg_corr", options: { mode: "line" } }],
      [{ name: "scale", options: { factor: 2 } }],
      "both",
    );

    const [heatmap, lineplot] = result.plotConfigs;
    expect(heatmap.filters_order).toEqual(["bg_corr"]);
    expect(heatmap.filters_opts).toEqual({ bg_corr: { mode: "line" } });
    expect(lineplot.filters_order).toEqual(["scale"]);
  });
});

describe("replicatePlots", () => {
  const config = {
    id: "plot-1",
    origin: "custom" as const,
    fpath: "C:/data/other.zarr",
    indeps: ["gate"],
    deps: ["signal"],
    plotType: "LinePlot" as const,
    filters_order: [],
    filters_opts: {},
    slider: {},
    source: "disk" as const,
    preferredSource: "disk" as const,
  };

  it("recreates a plot whose variables all exist in the new measurement", () => {
    const result = replicatePlots(item(["gate", "bias"], ["signal"]), [{ config }]);

    expect(result.plotConfigs).toHaveLength(1);
    expect(result.plotConfigs[0].fpath).toBe("C:\\data\\run.zarr");
    expect(result.skipped).toEqual([]);
  });

  it("skips a plot with a missing variable, and says which", () => {
    // Silently dropping it would leave the user wondering why a plot
    // appeared for one measurement and not the next.
    const result = replicatePlots(item(["bias"], ["signal"]), [{ config }]);

    expect(result.plotConfigs).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]).toContain("gate");
  });

  it("carries applied filters across, since the replica gets a new id", () => {
    // plotStore keys filters by plot id, so they have to travel in the config.
    const result = replicatePlots(item(["gate"], ["signal"]), [
      { config, filters: [{ name: "scale", options: { factor: 3 } }] },
    ]);

    expect(result.plotConfigs[0].filters_order).toEqual(["scale"]);
    expect(result.plotConfigs[0].filters_opts).toEqual({ scale: { factor: 3 } });
  });

  it("keeps whether the source was a default or a custom plot", () => {
    const auto = { ...config, origin: "auto" as const };

    expect(
      replicatePlots(item(["gate"], ["signal"]), [{ config: auto }]).plotConfigs[0].origin,
    ).toBe("auto");
  });

  it("does nothing for a measurement it cannot read", () => {
    expect(replicatePlots(item(), [{ config }]).plotConfigs).toEqual([]);
    expect(
      replicatePlots(item(["gate"], ["signal"], "C:/notes.md"), [{ config }]).plotConfigs,
    ).toEqual([]);
  });
});

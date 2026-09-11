import { describe, expect, it } from "vitest";

import { generateAutoPlotConfigs, replicateCustomPlots } from "./autoPlot";
import type { BasketItem } from "../components/Basket";

const item = (
  independents?: string[],
  dependents?: string[],
  path = "C:\\data\\run.zarr",
): BasketItem =>
  ({
    id: "run-1",
    name: "run.zarr",
    path,
    type: "file",
    attributes: independents || dependents ? { independents, dependents } : undefined,
  }) as BasketItem;

describe("generateAutoPlotConfigs", () => {
  it("makes both a heatmap and a lineplot when there are two independents", () => {
    const result = generateAutoPlotConfigs(item(["gate", "bias"], ["signal"]));

    expect(result.success).toBe(true);
    expect(result.plotConfigs.map((config) => config.plotType)).toEqual(["HeatMap", "LinePlot"]);
    // The heatmap takes both independents; the lineplot takes the first.
    expect(result.plotConfigs[0].indeps).toEqual(["gate", "bias"]);
    expect(result.plotConfigs[1].indeps).toEqual(["gate"]);
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
    );

    const [heatmap, lineplot] = result.plotConfigs;
    expect(heatmap.filters_order).toEqual(["bg_corr"]);
    expect(heatmap.filters_opts).toEqual({ bg_corr: { mode: "line" } });
    expect(lineplot.filters_order).toEqual(["scale"]);
  });
});

describe("replicateCustomPlots", () => {
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
    const result = replicateCustomPlots(item(["gate", "bias"], ["signal"]), [{ config }]);

    expect(result.plotConfigs).toHaveLength(1);
    expect(result.plotConfigs[0].fpath).toBe("C:\\data\\run.zarr");
    expect(result.skipped).toEqual([]);
  });

  it("skips a plot with a missing variable, and says which", () => {
    // Silently dropping it would leave the user wondering why a plot
    // appeared for one measurement and not the next.
    const result = replicateCustomPlots(item(["bias"], ["signal"]), [{ config }]);

    expect(result.plotConfigs).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]).toContain("gate");
  });

  it("carries applied filters across, since the replica gets a new id", () => {
    // plotStore keys filters by plot id, so they have to travel in the config.
    const result = replicateCustomPlots(item(["gate"], ["signal"]), [
      { config, filters: [{ name: "scale", options: { factor: 3 } }] },
    ]);

    expect(result.plotConfigs[0].filters_order).toEqual(["scale"]);
    expect(result.plotConfigs[0].filters_opts).toEqual({ scale: { factor: 3 } });
  });

  it("does nothing for a measurement it cannot read", () => {
    expect(replicateCustomPlots(item(), [{ config }]).plotConfigs).toEqual([]);
    expect(
      replicateCustomPlots(item(["gate"], ["signal"], "C:/notes.md"), [{ config }]).plotConfigs,
    ).toEqual([]);
  });
});

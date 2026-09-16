import type { Page } from "@playwright/test";

import { expect } from "./coverage";
// Generated from the backend's own HeatMap figure for a live measurement: z is a
// base64 typed array holding NaN for every point not measured yet. "later" has
// more points measured and shifted values; "earlySwapped" has X and Y swapped.
import liveHeatmap from "./fixtures/live-heatmap.json" with { type: "json" };

export type Frame = "early" | "later";

/**
 * Mocks the API for one live heatmap measurement. Set `state.frame` to change
 * what the live poll returns; set `state.holdTransform` to a promise to keep a
 * filter or swap response in flight until it resolves. A poll that carries
 * filters returns `filteredFrame`, and `plotDelayMs` slows every poll down.
 */
export async function mockLiveHeatmapApi(page: Page) {
  const state = {
    frame: "early" as Frame,
    transformResult: liveHeatmap.earlySwapped as unknown,
    holdTransform: null as Promise<void> | null,
    filteredFrame: "later" as Frame,
    plotDelayMs: 0,
    transformRequests: [] as { filters_order: string[] }[],
  };

  await page.route("**/*", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;

    if (path === "/health") {
      await route.fulfill({ json: { ok: true, dbReady: false, dbError: "disabled in test" } });
    } else if (path === "/load/") {
      await route.fulfill({ json: [] });
    } else if (path === "/load-live/") {
      await route.fulfill({
        json: {
          success: true,
          count: 1,
          children: [
            {
              id: "live-heat",
              name: "live-heat",
              path: "memory://live-heat",
              type: "file",
              timestamp: "2026-09-16T09:00:00Z",
              tags: ["live", "zarr"],
            },
          ],
        },
      });
    } else if (path === "/load-attrs/") {
      await route.fulfill({
        json: { independents: ["frequency", "voltage"], dependents: ["current"] },
      });
    } else if (path === "/load-meta/") {
      await route.fulfill({ json: {} });
    } else if (path === "/load-notes/") {
      await route.fulfill({ json: { notes: "", last_saved: null } });
    } else if (path === "/plot/") {
      const body = request.postDataJSON();
      const heatmap = body.plotType === "HeatMap";
      const frame = body.filters_order?.length ? state.filteredFrame : state.frame;
      if (state.plotDelayMs) await new Promise((resolve) => setTimeout(resolve, state.plotDelayMs));
      const plotJson = heatmap
        ? body.swap_xy
          ? liveHeatmap.earlySwapped
          : liveHeatmap[frame]
        : { data: [{ type: "scatter", mode: "lines", x: [0, 1], y: [1, 2] }], layout: {} };
      await route.fulfill({
        json: {
          success: true,
          message: "created",
          plots: [
            {
              id: `plot-${body.plotType}`,
              plot_ref: `plot-ref-${body.plotType}`,
              type: body.plotType,
              is_live: true,
              plotJson,
            },
          ],
        },
      });
    } else if (path === "/transform-plot") {
      state.transformRequests.push(request.postDataJSON());
      if (state.holdTransform) await state.holdTransform;
      await route.fulfill({
        json: { plot_json: state.transformResult, plot_ref: "plot-ref-HeatMap", warnings: [] },
      });
    } else {
      await route.fallback();
    }
  });

  return state;
}

export async function openLiveHeatmap(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Live Measurements" }).click();
  const row = page
    .getByText("live-heat", { exact: true })
    .locator("xpath=ancestor::div[@data-level][1]");
  await row.getByRole("button", { name: "Add to basket" }).click();
  await expect.poll(() => heatmapState(page)).not.toBeNull();
}

/** Reads what Plotly actually rendered for the heatmap and the linecut preview. */
export function heatmapState(page: Page) {
  return page.evaluate(() => {
    const plots = Array.from(document.querySelectorAll(".js-plotly-plot")) as any[];
    const heatmap = plots.find((gd) => gd.data?.[0]?.type === "heatmap");
    const preview = plots.find((gd) => gd.data?.[0]?.name === "LineCut Preview");
    if (!heatmap?._fullLayout?.xaxis) return null;
    return {
      xRange: heatmap._fullLayout.xaxis.range as number[],
      yRange: heatmap._fullLayout.yaxis.range as number[],
      colorbar: heatmap.layout.coloraxis?.colorbar,
      previewX: preview ? Array.from(preview.data[0].x as number[]) : null,
      previewY: preview ? Array.from(preview.data[0].y as number[]) : null,
    };
  });
}

/** Hovers the heatmap at a data coordinate. */
export async function hoverHeatmapAt(page: Page, x: number, y: number) {
  const point = await page.evaluate(
    ([dataX, dataY]) => {
      const gd = (Array.from(document.querySelectorAll(".js-plotly-plot")) as any[]).find(
        (plot) => plot.data?.[0]?.type === "heatmap",
      );
      const { xaxis, yaxis } = gd._fullLayout;
      const box = gd.getBoundingClientRect();
      return {
        x: box.left + xaxis._offset + xaxis.l2p(dataX),
        y: box.top + yaxis._offset + yaxis.l2p(dataY),
      };
    },
    [x, y],
  );
  await page.mouse.move(point.x, point.y);
}

/** Drag-zooms the heatmap to the given fractions of its plot area. */
export async function zoomHeatmap(page: Page, from: number, to: number) {
  const box = await page.evaluate(
    ([start, end]) => {
      const gd = (Array.from(document.querySelectorAll(".js-plotly-plot")) as any[]).find(
        (plot) => plot.data?.[0]?.type === "heatmap",
      );
      const { xaxis, yaxis } = gd._fullLayout;
      const rect = gd.getBoundingClientRect();
      const at = (fraction: number) => ({
        x: rect.left + xaxis._offset + xaxis._length * fraction,
        y: rect.top + yaxis._offset + yaxis._length * fraction,
      });
      return [at(start), at(end)];
    },
    [from, to],
  );
  await page.mouse.move(box[0].x, box[0].y);
  await page.mouse.down();
  await page.mouse.move(box[1].x, box[1].y, { steps: 10 });
  await page.mouse.up();
}

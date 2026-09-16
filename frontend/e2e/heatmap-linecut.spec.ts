import type { Page } from "@playwright/test";

import { expect, test } from "./coverage";
import { heatmapState, hoverHeatmapAt, mockLiveHeatmapApi, openLiveHeatmap } from "./liveHeatmap";

async function enterLineCut(page: Page) {
  await page.getByTitle("Generate line slices (X/Y keys)").first().click();
  await expect(page.getByText("LineCut Preview", { exact: false }).first()).toBeVisible();
  // Entering linecut maximizes the plot, which remounts it.
  await expect.poll(() => heatmapState(page)).not.toBeNull();
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
});

test("labels a live heatmap's colorbar with a unit prefix while points are unmeasured", async ({
  page,
}) => {
  await mockLiveHeatmapApi(page);
  await openLiveHeatmap(page);

  // Without engineering ticks Plotly falls back to raw values like 0.0000000002.
  await expect.poll(async () => (await heatmapState(page))?.colorbar?.tickmode).toBe("array");
  const { colorbar } = (await heatmapState(page))!;
  for (const tick of colorbar.ticktext as string[]) {
    expect(tick).not.toMatch(/0\.0000/);
  }
});

test("updates the linecut preview as live data arrives", async ({ page }) => {
  const state = await mockLiveHeatmapApi(page);
  await openLiveHeatmap(page);
  await enterLineCut(page);

  await hoverHeatmapAt(page, -1.6, 197_500_000);
  await expect.poll(async () => (await heatmapState(page))?.previewY?.length ?? 0).toBe(7);
  const earlyPreview = (await heatmapState(page))!.previewY!;

  // The pointer stays still; only the polled data changes.
  state.frame = "later";
  await expect
    .poll(async () => (await heatmapState(page))?.previewY, { timeout: 5_000 })
    .not.toEqual(earlyPreview);
});

test("swapping axes in linecut mode keeps the heatmap filling its axes", async ({ page }) => {
  await mockLiveHeatmapApi(page);
  await openLiveHeatmap(page);
  await enterLineCut(page);

  await hoverHeatmapAt(page, -1.5, 197_500_000);
  await expect
    .poll(async () => (await heatmapState(page))?.previewY?.length ?? 0)
    .toBeGreaterThan(0);

  // Move off the plot so no fresh hover arrives in the swapped coordinates.
  await page.mouse.move(0, 0);
  await page.getByTitle("Swap X & Y Axes").first().click();

  // After the swap X is frequency (190-205 MHz). A guide line left at the old
  // X of -1.5 V would stretch the autorange down to include it.
  await expect
    .poll(async () => (await heatmapState(page))?.xRange?.[0] ?? 0, { timeout: 5_000 })
    .toBeGreaterThan(180e6);
});

test("drops unmeasured points from a slice without shifting the rest", async ({ page }) => {
  await mockLiveHeatmapApi(page);
  // A 3x2 grid whose middle column is unmeasured in the first row.
  await page.route("**/plot/", async (route) => {
    const body = route.request().postDataJSON();
    if (body.plotType !== "HeatMap") return route.fallback();
    await route.fulfill({
      json: {
        success: true,
        message: "created",
        plots: [
          {
            id: "gap",
            plot_ref: "plot-ref-HeatMap",
            type: "HeatMap",
            is_live: true,
            plotJson: {
              data: [
                {
                  type: "heatmap",
                  x: [0, 1, 2],
                  y: [10, 20],
                  z: [
                    [1, null, 3],
                    [4, 5, 6],
                  ],
                },
              ],
              layout: {},
            },
          },
        ],
      },
    });
  });
  await openLiveHeatmap(page);
  await enterLineCut(page);

  // The vertical cut at x = 1 has no value at y = 10.
  await hoverHeatmapAt(page, 1, 20);
  await expect.poll(async () => (await heatmapState(page))?.previewY).toEqual([5]);
  expect((await heatmapState(page))!.previewX).toEqual([20]);
});

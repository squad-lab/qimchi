import type { Page } from "@playwright/test";

import { expect, test } from "./coverage";
import liveHeatmap from "./fixtures/live-heatmap.json" with { type: "json" };
import { heatmapState, mockLiveHeatmapApi, openLiveHeatmap, zoomHeatmap } from "./liveHeatmap";

// Full x extent of the early fixture: -1.6 V to -1.2 V plus half a cell each side.
const FULL_X: [number, number] = [-1.65, -1.15];

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
});

test("keeps the zoom when a filter result lands after the user zoomed", async ({ page }) => {
  const state = await mockLiveHeatmapApi(page);
  let releaseTransform = () => {};
  state.holdTransform = new Promise((resolve) => (releaseTransform = resolve));
  state.transformResult = liveHeatmap.later;
  await openLiveHeatmap(page);
  const ticksBefore = (await heatmapState(page))!.colorbar.ticktext.join();

  await page.getByTitle("Apply Filters & Sliders").first().click();
  await page.getByText("Diff along Y", { exact: true }).first().click();
  await page.getByText("Apply", { exact: true }).first().click();

  // Live filters are slow; the user zooms while the result is still in flight.
  await zoomHeatmap(page, 0.1, 0.5);
  const zoomed = (await heatmapState(page))!.xRange;
  expect(zoomed[1] - zoomed[0]).toBeLessThan((FULL_X[1] - FULL_X[0]) * 0.6);

  releaseTransform();
  await expect
    .poll(async () => (await heatmapState(page))?.colorbar?.ticktext?.join())
    .not.toBe(ticksBefore);
  expect((await heatmapState(page))!.xRange).toEqual(zoomed);
});

test("keeps the zoom across live refreshes", async ({ page }) => {
  const state = await mockLiveHeatmapApi(page);
  await openLiveHeatmap(page);
  const ticksBefore = (await heatmapState(page))!.colorbar.ticktext.join();

  await zoomHeatmap(page, 0.1, 0.5);
  const zoomed = (await heatmapState(page))!.xRange;

  state.frame = "later";
  await expect
    .poll(async () => (await heatmapState(page))?.colorbar?.ticktext?.join(), { timeout: 5_000 })
    .not.toBe(ticksBefore);
  expect((await heatmapState(page))!.xRange).toEqual(zoomed);
});

test("resets the zoom when the axes are swapped", async ({ page }) => {
  await mockLiveHeatmapApi(page);
  await openLiveHeatmap(page);
  await zoomHeatmap(page, 0.1, 0.5);

  await page.getByTitle("Swap X & Y Axes").first().click();

  // X is now frequency, and the whole 190-205 MHz sweep is back in view.
  await expect
    .poll(async () => (await heatmapState(page))?.xRange[1] ?? 0, { timeout: 5_000 })
    .toBeGreaterThan(205e6);
  expect((await heatmapState(page))!.xRange[0]).toBeLessThan(190e6);
});

test("resetting a filtered live plot does not flip back to the filtered state", async ({
  page,
}) => {
  const state = await mockLiveHeatmapApi(page);
  state.transformResult = liveHeatmap.later;
  state.plotDelayMs = 300;
  await openLiveHeatmap(page);
  const rawTicks = (await heatmapState(page))!.colorbar.ticktext.join();

  await page.getByTitle("Apply Filters & Sliders").first().click();
  await page.getByText("Diff along Y", { exact: true }).first().click();
  await page.getByText("Apply", { exact: true }).first().click();
  await page.getByRole("button", { name: "Close modal" }).first().click();
  const ticks = async () => (await heatmapState(page))?.colorbar?.ticktext?.join() ?? "";
  await expect.poll(ticks).not.toBe(rawTicks);
  // Let the filtered config reach the live polls.
  await page.waitForTimeout(2_000);

  await page.getByTitle("Reset", { exact: true }).first().click();
  const seen: string[] = [];
  for (const end = Date.now() + 3_000; Date.now() < end;) {
    const current = (await ticks()) === rawTicks ? "raw" : "filtered";
    if (seen.at(-1) !== current) seen.push(current);
    await page.waitForTimeout(50);
  }
  expect(seen).toEqual(["filtered", "raw"]);
});

async function applyDiffAlongY(page: Page) {
  await page.getByTitle("Apply Filters & Sliders").first().click();
  await page.getByText("Diff along Y", { exact: true }).first().click();
  await page.getByText("Apply", { exact: true }).first().click();
  await page.getByRole("button", { name: "Close modal" }).first().click();
}

test("Reset clears the zoom without remounting the plot", async ({ page }) => {
  await mockLiveHeatmapApi(page);
  await openLiveHeatmap(page);
  await zoomHeatmap(page, 0.1, 0.5);
  await page.evaluate(() => {
    const gd = (Array.from(document.querySelectorAll(".js-plotly-plot")) as any[]).find(
      (plot) => plot.data?.[0]?.type === "heatmap",
    );
    gd.dataset.beforeReset = "yes";
  });

  await page.getByTitle("Reset", { exact: true }).first().click();

  await expect.poll(async () => (await heatmapState(page))?.xRange[0]).toBeCloseTo(FULL_X[0], 2);
  // A remount would replace the element, flashing the plot blank.
  await expect(page.locator(".js-plotly-plot[data-before-reset='yes']")).toHaveCount(1);
});

test("a filter result still in flight when Reset is pressed is discarded", async ({ page }) => {
  const state = await mockLiveHeatmapApi(page);
  let releaseTransform = () => {};
  state.holdTransform = new Promise((resolve) => (releaseTransform = resolve));
  state.transformResult = liveHeatmap.later;
  await openLiveHeatmap(page);
  const rawTicks = (await heatmapState(page))!.colorbar.ticktext.join();

  await applyDiffAlongY(page);
  await page.getByTitle("Reset", { exact: true }).first().click();
  releaseTransform();

  const ticks = async () => (await heatmapState(page))?.colorbar?.ticktext?.join();
  for (const end = Date.now() + 2_000; Date.now() < end;) {
    expect(await ticks()).toBe(rawTicks);
    await page.waitForTimeout(100);
  }
});

test("names filters and labels the colour range in the data's units", async ({ page }) => {
  const state = await mockLiveHeatmapApi(page);
  state.transformResult = liveHeatmap.early;
  await openLiveHeatmap(page);

  await applyDiffAlongY(page);
  await expect(page.locator("[title='Filters: Diff along Y']").first()).toBeAttached();

  await page.getByTitle("Edit Appearance").first().click();
  // The early frame spans 100-260 pA.
  await expect(page.getByText("Data min: 100 pA")).toBeVisible();
  await expect(page.getByText("Data max: 260 pA")).toBeVisible();
});

test("a filter changed while another is still loading is applied after it", async ({ page }) => {
  const state = await mockLiveHeatmapApi(page);
  let releaseTransform = () => {};
  state.holdTransform = new Promise((resolve) => (releaseTransform = resolve));
  state.transformResult = liveHeatmap.later;
  await openLiveHeatmap(page);

  await page.getByTitle("Apply Filters & Sliders").first().click();
  for (const name of ["Diff along Y", "Diff along X"]) {
    await page.getByText(name, { exact: true }).first().click();
    await page.getByText("Apply", { exact: true }).first().click();
  }
  await expect.poll(() => state.transformRequests.length).toBe(1);

  releaseTransform();

  await expect.poll(() => state.transformRequests.length).toBe(2);
  expect([...state.transformRequests[1].filters_order].sort()).toEqual(["diff_x", "diff_y"]);
  await page.getByRole("button", { name: "Close modal" }).first().click();
  await expect(page.locator("[title^='Filters: ']").first()).toHaveAttribute(
    "title",
    /Diff along Y.*Diff along X|Diff along X.*Diff along Y/,
  );
});

test("switching an axis between linear and log clears the zoom", async ({ page }) => {
  await mockLiveHeatmapApi(page);
  await openLiveHeatmap(page);
  await zoomHeatmap(page, 0.1, 0.5);
  const zoomedY = (await heatmapState(page))!.yRange;
  // Y is frequency, whose cells span 188.75-206.25 MHz.
  expect(zoomedY[1] - zoomedY[0]).toBeLessThan(10e6);

  await page.getByTitle("Edit Appearance").first().click();
  await page.getByRole("button", { name: "Y-Axis", exact: true }).click();
  await page.getByLabel("Y-axis type").click();
  await page.getByText("Log", { exact: true }).last().click();

  // A log axis stores its range as powers of ten.
  await expect
    .poll(async () => 10 ** ((await heatmapState(page))?.yRange[0] ?? 99))
    .toBeLessThan(190e6);
  expect(10 ** (await heatmapState(page))!.yRange[1]).toBeGreaterThan(205e6);
});

test("turning on background correction keeps the zoom", async ({ page }) => {
  await mockLiveHeatmapApi(page);
  await openLiveHeatmap(page);
  // BG correction maximizes the plot, which remounts it, so start maximized.
  await page.getByTitle("Maximize").first().click();
  await expect.poll(() => heatmapState(page)).not.toBeNull();
  await zoomHeatmap(page, 0.1, 0.5);
  const zoomed = (await heatmapState(page))!.xRange;

  await page.getByTitle("BG Correction (interactive)").first().click();

  await page.waitForTimeout(1_000);
  expect((await heatmapState(page))!.xRange).toEqual(zoomed);
});

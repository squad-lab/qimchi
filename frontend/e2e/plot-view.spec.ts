import type { Page } from "@playwright/test";

import { expect, test } from "./coverage";
import { chooseColorscale } from "./colorscale";
import liveHeatmap from "./fixtures/live-heatmap.json" with { type: "json" };
import { heatmapState, mockLiveHeatmapApi, openLiveHeatmap, zoomHeatmap } from "./liveHeatmap";

// Full x extent of the early fixture: -1.6 V to -1.2 V plus half a cell each side.
const FULL_X: [number, number] = [-1.65, -1.15];

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
});

// The colorbar's engineering ticks arrive just after the plot first draws.
async function drawnTicks(page: Page) {
  await expect.poll(async () => (await heatmapState(page))?.colorbar?.ticktext).toBeTruthy();
  return (await heatmapState(page))!.colorbar.ticktext.join();
}

test("keeps the zoom when a filter result lands after the user zoomed", async ({ page }) => {
  const state = await mockLiveHeatmapApi(page);
  let releaseTransform = () => {};
  state.holdTransform = new Promise((resolve) => (releaseTransform = resolve));
  state.transformResult = liveHeatmap.later;
  await openLiveHeatmap(page);
  const ticksBefore = await drawnTicks(page);

  await page.getByRole("button", { name: "Edit filters" }).first().click();
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
  const ticksBefore = await drawnTicks(page);

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

  await page.getByRole("button", { name: "Swap X and Y axes" }).first().click();

  // X is now frequency, and the whole 190-205 MHz sweep is back in view.
  await expect
    .poll(async () => (await heatmapState(page))?.xRange[1] ?? 0, { timeout: 5_000 })
    .toBeGreaterThan(205e6);
  expect((await heatmapState(page))!.xRange[0]).toBeLessThan(190e6);
});

test("Copy puts a transparent, light-theme plot on the clipboard, even in dark mode", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await mockLiveHeatmapApi(page);
  await openLiveHeatmap(page);
  await page.getByRole("button", { name: "Switch to dark theme" }).click();

  const plot = page.locator(".js-plotly-plot").first();
  await plot.hover();
  await page.getByRole("button", { name: "Export" }).first().click();
  await page.getByRole("menuitem", { name: "Copy to clipboard" }).first().click();
  await expect(page.getByText("Copied the plot to the clipboard.")).toBeVisible();

  const image = await page.evaluate(async () => {
    const [item] = await navigator.clipboard.read();
    const bitmap = await createImageBitmap(await item.getType("image/png"));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d")!;
    context.drawImage(bitmap, 0, 0);
    // The title sits along the top: its text should be dark, as in the light theme.
    const top = context.getImageData(0, 0, bitmap.width, Math.round(bitmap.height * 0.1)).data;
    let inked = 0;
    let brightness = 0;
    for (let i = 0; i < top.length; i += 4) {
      if (top[i + 3] < 200) continue;
      inked += 1;
      brightness += (top[i] + top[i + 1] + top[i + 2]) / 3;
    }
    return {
      cornerAlpha: context.getImageData(2, 2, 1, 1).data[3],
      titleBrightness: inked ? brightness / inked : null,
    };
  });
  expect(image.cornerAlpha).toBe(0);
  expect(image.titleBrightness).not.toBeNull();
  expect(image.titleBrightness!).toBeLessThan(100);
});

test("the side ribbon stays open after swapping the axes", async ({ page }) => {
  const state = await mockLiveHeatmapApi(page);
  let release!: () => void;
  state.holdTransform = new Promise((resolve) => (release = resolve));
  await openLiveHeatmap(page);

  const swap = page.getByRole("button", { name: "Swap X and Y axes" }).first();
  const ribbon = swap.locator("xpath=ancestor::div[contains(@class, 'translate-x')][1]");
  await page.locator(".js-plotly-plot").first().hover();
  await expect(ribbon).toHaveClass(/translate-x-0/);

  // The pointer stays on the plot while the swap is worked out and after it lands.
  await swap.click();
  await expect(ribbon).toHaveClass(/translate-x-0/);
  release();
  await expect.poll(() => state.transformRequests.length).toBeGreaterThan(0);
  await page.waitForTimeout(400);
  await expect(ribbon).toHaveClass(/translate-x-0/);
});

test("resetting a filtered live plot does not flip back to the filtered state", async ({
  page,
}) => {
  const state = await mockLiveHeatmapApi(page);
  state.transformResult = liveHeatmap.later;
  state.plotDelayMs = 300;
  await openLiveHeatmap(page);
  const rawTicks = await drawnTicks(page);

  await page.getByRole("button", { name: "Edit filters" }).first().click();
  await page.getByText("Diff along Y", { exact: true }).first().click();
  await page.getByText("Apply", { exact: true }).first().click();
  await page.getByRole("button", { name: "Close modal" }).first().click();
  const ticks = async () => (await heatmapState(page))?.colorbar?.ticktext?.join() ?? "";
  await expect.poll(ticks).not.toBe(rawTicks);
  // Let the filtered config reach the live polls.
  await page.waitForTimeout(2_000);

  await page.getByRole("button", { name: "Reset plot" }).first().click();
  const seen: string[] = [];
  for (const end = Date.now() + 3_000; Date.now() < end;) {
    const current = (await ticks()) === rawTicks ? "raw" : "filtered";
    if (seen.at(-1) !== current) seen.push(current);
    await page.waitForTimeout(50);
  }
  expect(seen).toEqual(["filtered", "raw"]);
});

test("reverses the heatmap colormap from the Reverse toggle", async ({ page }) => {
  await mockLiveHeatmapApi(page);
  await openLiveHeatmap(page);
  const coloraxis = () =>
    page.evaluate(() => {
      const gd = (Array.from(document.querySelectorAll(".js-plotly-plot")) as any[]).find(
        (plot) => plot.data?.[0]?.type === "heatmap",
      );
      const axis = gd._fullLayout.coloraxis;
      return { reversed: axis.reversescale, first: axis.colorscale[0][1] };
    });

  await page.getByRole("button", { name: "Edit appearance" }).first().click();
  await chooseColorscale(page, page, "Viridis");
  await expect.poll(async () => (await coloraxis()).reversed).toBe(false);
  const viridisStart = (await coloraxis()).first;

  await page.getByLabel("Reverse colorscale").check({ force: true });
  await expect.poll(async () => (await coloraxis()).reversed).toBe(true);
  // Plotly reverses at draw time; the stored scale is still Viridis itself.
  expect((await coloraxis()).first).toBe(viridisStart);

  // Picking another map keeps it reversed.
  await chooseColorscale(page, page, "Plasma");
  await expect.poll(async () => (await coloraxis()).first).not.toBe(viridisStart);
  expect((await coloraxis()).reversed).toBe(true);
});

async function applyDiffAlongY(page: Page) {
  await page.getByRole("button", { name: "Edit filters" }).first().click();
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

  await page.getByRole("button", { name: "Reset plot" }).first().click();

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
  const rawTicks = await drawnTicks(page);

  await applyDiffAlongY(page);
  await page.getByRole("button", { name: "Reset plot" }).first().click();
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
  // Live refreshes of the filtered plot must show the same data.
  state.filteredFrame = "early";
  await openLiveHeatmap(page);

  await applyDiffAlongY(page);
  await page.getByRole("button", { name: "Edit filters" }).first().hover();
  await expect(page.getByRole("tooltip", { name: "Filters (F): Diff along Y" })).toBeVisible();

  await page.getByRole("button", { name: "Edit appearance" }).first().click();
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

  await page.getByRole("button", { name: "Edit filters" }).first().click();
  for (const name of ["Diff along Y", "Diff along X"]) {
    await page.getByText(name, { exact: true }).first().click();
    await page.getByText("Apply", { exact: true }).first().click();
  }
  await expect.poll(() => state.transformRequests.length).toBe(1);

  releaseTransform();

  await expect.poll(() => state.transformRequests.length).toBe(2);
  expect([...state.transformRequests[1].filters_order].sort()).toEqual(["diff_x", "diff_y"]);
  await page.getByRole("button", { name: "Close modal" }).first().click();
  await page.getByRole("button", { name: "Edit filters" }).first().hover();
  await expect(
    page.getByRole("tooltip", {
      name: /Filters \(F\): (Diff along Y.*Diff along X|Diff along X.*Diff along Y)/,
    }),
  ).toBeVisible();
});

test("rapid filter parameter changes keep every applied filter", async ({ page }) => {
  const state = await mockLiveHeatmapApi(page);
  await openLiveHeatmap(page);

  await page.getByRole("button", { name: "Edit filters" }).first().click();
  const panel = page.locator('[data-tour="filters-panel"]');
  for (const name of ["Diff along Y", "Savitzky-Golay"]) {
    await panel.getByRole("tab", { name }).click();
    await panel.getByText("Apply", { exact: true }).click();
    await expect
      .poll(() => state.transformRequests.length)
      .toBeGreaterThanOrEqual(name === "Diff along Y" ? 1 : 2);
  }

  const windowSize = panel.getByLabel("Savitzky-Golay window size");
  await expect(panel.getByLabel("Savitzky-Golay axis")).toHaveValue("0");
  await windowSize.focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");

  await expect.poll(() => state.transformRequests.length).toBeGreaterThanOrEqual(3);
  const last = state.transformRequests.at(-1)!;
  expect(last.filters_order).toEqual(["diff_x", "savgol"]);
  expect(last.filters_opts.savgol.window).toBe(11);
  expect(last.filters_opts.savgol.axis).toBe(0);
  expect(state.transformRequests.every((request) => request.filters_order.length > 0)).toBe(true);
});

test("applied filters can be reordered and removed from their list", async ({ page }) => {
  const state = await mockLiveHeatmapApi(page);
  await openLiveHeatmap(page);

  await page.getByRole("button", { name: "Edit filters" }).first().click();
  const panel = page.locator('[data-tour="filters-panel"]');
  for (const name of ["Diff along Y", "Savitzky-Golay"]) {
    await panel.getByRole("tab", { name }).click();
    await panel.getByText("Apply", { exact: true }).click();
  }
  await expect(panel.getByRole("tab", { name: /^Applied/ })).toContainText("2");
  await panel.getByRole("tab", { name: /^Applied/ }).click();
  const applied = panel.getByRole("region", { name: "Applied filters" });
  await expect(applied.getByRole("listitem")).toHaveText([/Diff along Y/, /Savitzky-Golay/]);
  const lastOrder = () => state.transformRequests.at(-1)?.filters_order;
  await expect.poll(lastOrder).toEqual(["diff_x", "savgol"]);

  const savgolToggle = applied.getByRole("switch", { name: "Disable Savitzky-Golay" });
  await expect(savgolToggle).not.toHaveAttribute("title");
  await savgolToggle.hover();
  await expect(page.getByRole("tooltip")).toHaveText("Disable Savitzky-Golay");

  // The arrows move a filter one place and redraw with the new order.
  await applied.getByRole("button", { name: "Apply Savitzky-Golay earlier" }).click();
  await expect(applied.getByRole("listitem")).toHaveText([/Savitzky-Golay/, /Diff along Y/]);
  await expect.poll(lastOrder).toEqual(["savgol", "diff_x"]);
  await expect(panel.getByRole("tab", { name: /Savitzky-Golay/ })).toContainText("1");

  // Dragging a row by its grip does the same, applied once on drop.
  const requestsBeforeDrag = state.transformRequests.length;
  const grip = applied.locator(".lucide-grip-vertical").first();
  const target = applied.getByRole("listitem").nth(1);
  const from = (await grip.boundingBox())!;
  const to = (await target.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2, to.y + to.height - 2, { steps: 8 });
  // While held, a line marks where the row will land and the order is not yet applied.
  await expect(applied.locator('[data-drop-side="after"]')).toBeVisible();
  expect(state.transformRequests.length).toBe(requestsBeforeDrag);
  await page.mouse.up();
  await expect(applied.locator("[data-drop-side]")).toHaveCount(0);
  await expect(applied.getByRole("listitem")).toHaveText([/Diff along Y/, /Savitzky-Golay/]);
  await expect.poll(lastOrder).toEqual(["diff_x", "savgol"]);
  expect(state.transformRequests.length).toBe(requestsBeforeDrag + 1);

  // The compact switch keeps a disabled filter in the list so it can be restored quickly.
  await applied.getByRole("switch", { name: "Disable Savitzky-Golay" }).click();
  await expect(applied.getByRole("listitem")).toHaveCount(2);
  await expect(applied.getByRole("switch", { name: "Enable Savitzky-Golay" })).not.toBeChecked();
  await expect.poll(lastOrder).toEqual(["diff_x"]);
  await applied.getByRole("switch", { name: "Enable Savitzky-Golay" }).click();
  await expect.poll(lastOrder).toEqual(["diff_x", "savgol"]);

  await applied.getByRole("button", { name: "Remove Diff along Y" }).click();
  await expect(applied.getByRole("listitem")).toHaveText([/Savitzky-Golay/]);
  await expect.poll(lastOrder).toEqual(["savgol"]);
});

test("a data slider reaches its maximum and keeps its place when a filter is applied or removed", async ({
  page,
}) => {
  const state = await mockLiveHeatmapApi(page);
  // A step of 1/49 overshoots 1 in floating point; the slider used to stop at 48/49.
  const slider = { temperature: { min: 0, max: 1, step: 1 / 49, value: 0 } };
  const plotRequests: { slider?: Record<string, { value: number }> }[] = [];
  await page.route("**/plot/", async (route) => {
    const body = route.request().postDataJSON();
    if (body.plotType !== "HeatMap") return route.fallback();
    plotRequests.push(body);
    await route.fulfill({
      json: {
        success: true,
        message: "created",
        plots: [
          {
            id: "plot-HeatMap",
            plot_ref: "plot-ref-HeatMap",
            type: "HeatMap",
            is_live: true,
            plotJson: liveHeatmap.early,
            slider_config: slider,
          },
        ],
      },
    });
  });
  const sliderValue = () =>
    (state.transformRequests.at(-1) as { slider?: Record<string, { value: number }> } | undefined)
      ?.slider?.temperature?.value;
  await openLiveHeatmap(page);

  await page.getByRole("button", { name: "Edit filters" }).first().click();
  const panel = page.locator('[data-tour="filters-panel"]');
  await panel.getByRole("tab", { name: /Sliders/ }).click();
  const range = panel.locator('input[type="range"]').first();
  await range.focus();
  await page.keyboard.press("End");
  await expect(panel.getByText("1.000000").first()).toBeVisible();
  await expect.poll(sliderValue).toBe(1);

  await panel.getByRole("tab", { name: /^Scale/ }).click();
  const before = plotRequests.length;
  await panel.getByText("Apply", { exact: true }).click();
  await expect.poll(() => state.transformRequests.at(-1)?.filters_order).toEqual(["transform"]);
  expect(sliderValue()).toBe(1);

  // Removing the last filter keeps the slice rather than going back to the first one.
  const transformsBefore = state.transformRequests.length;
  await panel.getByText("Apply", { exact: true }).click();
  await expect.poll(() => state.transformRequests.length).toBeGreaterThan(transformsBefore);
  expect(state.transformRequests.at(-1)?.filters_order).toEqual([]);
  expect(sliderValue()).toBe(1);

  // The plot's saved state keeps the slider too, so the next live refresh does not reset it.
  await panel.getByRole("tab", { name: /Sliders/ }).click();
  await expect(panel.getByText("1.000000").first()).toBeVisible();
  await panel.getByRole("button", { name: "Close modal" }).click();
  await expect.poll(() => plotRequests.length, { timeout: 8_000 }).toBeGreaterThan(before + 1);
  for (const request of plotRequests.slice(before + 1)) {
    expect(request.slider?.temperature?.value).toBe(1);
  }
});

test("switching an axis between linear and log clears the zoom", async ({ page }) => {
  await mockLiveHeatmapApi(page);
  await openLiveHeatmap(page);
  await zoomHeatmap(page, 0.1, 0.5);
  const zoomedY = (await heatmapState(page))!.yRange;
  // Y is frequency, whose cells span 188.75-206.25 MHz.
  expect(zoomedY[1] - zoomedY[0]).toBeLessThan(10e6);

  await page.getByRole("button", { name: "Edit appearance" }).first().click();
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
  await page.getByRole("button", { name: "Maximize plot" }).first().click();
  await expect.poll(() => heatmapState(page)).not.toBeNull();
  await zoomHeatmap(page, 0.1, 0.5);
  const zoomed = (await heatmapState(page))!.xRange;

  // Background correction has no button; B toggles it on the selected plot.
  await page.keyboard.press("b");
  await expect(page.getByText(/BG Corr active/).first()).toBeVisible();

  await page.waitForTimeout(1_000);
  expect((await heatmapState(page))!.xRange).toEqual(zoomed);
});

test("the R_in correction filter shows its equation and sends its resistance", async ({ page }) => {
  const state = await mockLiveHeatmapApi(page);
  await openLiveHeatmap(page);

  await page.getByRole("button", { name: "Edit filters" }).first().click();
  const panel = page.locator('[data-tour="filters-panel"]');
  await panel.getByRole("tab", { name: "R_in Correction" }).click();
  const equation = panel.getByRole("math", { name: "V_S = V_b − I × R_in" });
  await expect(equation).toBeVisible();
  // MathJax replaces the fallback with SVG.
  await expect(equation.locator("svg")).toBeAttached();
  // The formula does not open MathJax UI.
  await equation.click();
  await expect(page.getByText("MathJax Expression Explorer Help")).toHaveCount(0);
  await expect(panel.locator("mjx-container[tabindex]")).toHaveCount(0);

  await panel.getByLabel("Inline resistance", { exact: true }).fill("12");
  await panel.getByLabel("Inline resistance unit").selectOption("MΩ");
  await panel.getByLabel("Bias axis").selectOption("y");
  await panel.getByText("Apply", { exact: true }).click();

  await expect
    .poll(() => state.transformRequests.at(-1)?.filters_opts.r_in_correction)
    .toMatchObject({ r_in: 12, r_in_unit: "MΩ", bias_axis: "y" });
  expect(state.transformRequests.at(-1)!.filters_order).toEqual(["r_in_correction"]);
  if (process.env.SHOT_DIR) await panel.screenshot({ path: `${process.env.SHOT_DIR}/bias.png` });
});

test("contrast filters follow Flip Heatmap in the filter menu", async ({ page }) => {
  await mockLiveHeatmapApi(page);
  await openLiveHeatmap(page);

  await page.getByRole("button", { name: "Edit filters" }).first().click();
  const panel = page.locator('[data-tour="filters-panel"]');
  const labels = (await panel.getByRole("tab").allTextContents()).map((label) => label.trim());
  const flip = labels.indexOf("Flip Heatmap");

  expect(labels.slice(flip + 1, flip + 5)).toEqual([
    "Gamma Correction",
    "Log Correction",
    "Sigmoid Correction",
    "Rescale Intensity",
  ]);
});

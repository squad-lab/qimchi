import type { Page } from "@playwright/test";

import { expect, test } from "./coverage";
import {
  heatmapState,
  hoverHeatmapAt,
  mockLiveHeatmapApi,
  openLiveHeatmap,
  zoomHeatmap,
} from "./liveHeatmap";
import { mockSettingsApi } from "./settingsMock";

async function enterLineCut(page: Page) {
  await page.getByRole("button", { name: "LineCut Tool" }).first().click();
  await expect(page.getByRole("group", { name: "LineCut direction" }).first()).toBeVisible();
  await expect.poll(() => heatmapState(page)).not.toBeNull();
  // These tests slice at a fixed x; the default slices at a fixed y.
  await page.keyboard.press("y");
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
  await page
    .getByRole("button", { name: /^Swap X (&|and) Y axes$/i })
    .first()
    .click();

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

/** Mock a 5x3 heat map with backend-compatible axis metadata. */
async function mockGridHeatmap(
  page: Page,
  axes = { x: false, y: false },
  grid: { x: number[]; y: number[]; z: number[][]; rotation?: unknown } = {
    x: [0, 1, 2, 3, 4],
    y: [10, 20, 30],
    z: [0, 1, 2].map((row) => [0, 1, 2, 3, 4].map((x) => x + 10 * row)),
  },
) {
  const linePlotRequests: Record<string, unknown>[] = [];
  await page.route("**/plot/", async (route) => {
    const body = route.request().postDataJSON();
    if (body.plotType !== "HeatMap") {
      linePlotRequests.push(body);
      return route.fallback();
    }
    await route.fulfill({
      json: {
        success: true,
        message: "created",
        plots: [
          {
            id: "grid",
            plot_ref: "plot-ref-HeatMap",
            type: "HeatMap",
            is_live: true,
            plotJson: {
              data: [
                {
                  type: "heatmap",
                  x: grid.x,
                  y: grid.y,
                  z: grid.z,
                },
              ],
              layout: {
                meta: {
                  qimchi_axes: {
                    x: { variable: "voltage", dependent: axes.x },
                    y: { variable: "frequency", dependent: axes.y },
                  },
                  ...(grid.rotation ? { qimchi_rotation: grid.rotation } : {}),
                },
              },
            },
          },
        ],
      },
    });
  });
  return linePlotRequests;
}

/** Retry a heat-map click if a live redraw invalidates Plotly's hover target. */
async function clickHeatmapAt(page: Page, x: number, y: number, done: () => Promise<unknown>) {
  await expect(async () => {
    await hoverHeatmapAt(page, x, y);
    // Plotly emits the click only after hover data identifies the target point.
    await expect
      .poll(
        () =>
          page.evaluate(
            ([dataX, dataY]) => {
              const gd = (Array.from(document.querySelectorAll(".js-plotly-plot")) as any[]).find(
                (plot) => plot.data?.[0]?.type === "heatmap",
              );
              const point = gd?._hoverdata?.[0];
              return point?.x === dataX && point?.y === dataY;
            },
            [x, y],
          ),
        { timeout: 2_000 },
      )
      .toBe(true);
    await page.mouse.down();
    await page.mouse.up();
    await done();
  }).toPass({ timeout: 15_000 });
}

test("draws an oblique cut between two clicked points and keeps it as a line plot", async ({
  page,
}) => {
  await mockLiveHeatmapApi(page);
  const linePlotRequests = await mockGridHeatmap(page);
  await openLiveHeatmap(page);
  await page.getByRole("button", { name: "LineCut Tool" }).first().click();
  await expect.poll(() => heatmapState(page)).not.toBeNull();

  await page.getByRole("button", { name: "Oblique", exact: true }).click();
  await expect(page.getByRole("button", { name: "Oblique", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  // The caveat sits beside the mode, and its tooltip stays inside the window.
  await page.getByRole("button", { name: "Oblique", exact: true }).hover();
  const caveat = page.getByRole("tooltip").filter({ hasText: "bilinear interpolation" });
  await expect(caveat).toBeVisible();
  const box = (await caveat.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  await expect(page.getByText("Click the heat map where the cut should start.")).toBeVisible();

  await clickHeatmapAt(page, 0, 10, () =>
    expect(page.getByText("Now click where the cut should end.")).toBeVisible({
      timeout: 1_000,
    }),
  );

  // The cut spans four x intervals and produces one sample per interval.
  // A live poll can redraw the heat map under a still pointer, so hover again until it lands.
  await expect(async () => {
    await page.mouse.move(0, 0);
    await hoverHeatmapAt(page, 4, 30);
    await expect
      .poll(async () => (await heatmapState(page))?.previewX, { timeout: 1_000 })
      .toEqual([0, 1, 2, 3, 4]);
  }).toPass({ timeout: 10_000 });
  expect((await heatmapState(page))!.previewY).toEqual([0, 6, 12, 18, 24]);

  await clickHeatmapAt(page, 4, 30, () =>
    expect.poll(() => linePlotRequests.length, { timeout: 1_000 }).toBeGreaterThan(0),
  );
  expect(linePlotRequests[0]).toMatchObject({
    plotType: "LinePlot",
    indeps: ["voltage", "frequency"],
    cut: {
      start: { voltage: 0, frequency: 10 },
      end: { voltage: 4, frequency: 30 },
    },
  });

  // Completing a cut resets endpoint selection.
  await expect(page.getByText("Click the heat map where the cut should start.")).toBeVisible();
});

test("a right-click locks the cut in place until it is unlocked", async ({ page }) => {
  await mockLiveHeatmapApi(page);
  const linePlotRequests = await mockGridHeatmap(page);
  await openLiveHeatmap(page);
  await page.getByRole("button", { name: "LineCut Tool" }).first().click();
  await expect.poll(() => heatmapState(page)).not.toBeNull();
  const guide = async () =>
    JSON.parse(
      (await page.locator("[data-linecut-guide]").first().getAttribute("data-linecut-guide"))!,
    );

  await expect(async () => {
    await page.mouse.move(0, 0);
    await hoverHeatmapAt(page, 1, 20);
    await expect
      .poll(async () => (await heatmapState(page))?.previewY, { timeout: 1_000 })
      .toEqual([10, 11, 12, 13, 14]);
  }).toPass({ timeout: 10_000 });

  await page.mouse.down({ button: "right" });
  await page.mouse.up({ button: "right" });
  const unlock = page.getByRole("button", { name: "Unlock the cut" });
  await expect(unlock).toBeVisible();
  expect(linePlotRequests).toHaveLength(0);

  // The pointer moves on; the cut stays.
  await hoverHeatmapAt(page, 3, 30);
  await page.waitForTimeout(400);
  expect((await heatmapState(page))!.previewY).toEqual([10, 11, 12, 13, 14]);
  expect(await guide()).toMatchObject({ locked: true, hovered: { y: 20 } });

  // A click anywhere keeps the locked cut.
  await page.mouse.down();
  await page.mouse.up();
  await expect.poll(() => linePlotRequests.length).toBe(1);

  await unlock.click();
  await expect(unlock).toHaveCount(0);
  await expect(async () => {
    await page.mouse.move(0, 0);
    await hoverHeatmapAt(page, 3, 30);
    await expect
      .poll(async () => (await heatmapState(page))?.previewY, { timeout: 1_000 })
      .toEqual([20, 21, 22, 23, 24]);
  }).toPass({ timeout: 10_000 });
});

test("refuses an oblique cut when an axis is measured", async ({ page }) => {
  await mockLiveHeatmapApi(page);
  await mockGridHeatmap(page, { x: true, y: false });
  await openLiveHeatmap(page);
  await page.getByRole("button", { name: "LineCut Tool" }).first().click();
  await expect.poll(() => heatmapState(page)).not.toBeNull();

  await page.getByRole("button", { name: "Oblique", exact: true }).click();

  await expect(page.getByText("An oblique cut needs both axes to be swept")).toBeVisible();
  await expect(page.getByRole("button", { name: "Oblique", exact: true })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
});

test("a cut across a rotated heat map is kept as the matching cut through the data", async ({
  page,
}) => {
  await mockLiveHeatmapApi(page);
  // Rotate a 3x2 source grid by 90 degrees using the filter's output metadata.
  const linePlotRequests = await mockGridHeatmap(
    page,
    { x: false, y: false },
    {
      x: [0.5, 1.5],
      y: [5, 15, 25],
      z: [
        [3, 6],
        [2, 5],
        [1, 4],
      ],
      rotation: {
        matrix: [
          [0, 1],
          [-1, 0],
        ],
        offset: [0, 2],
        columns: { start: 0.5, step: 1 },
        rows: { start: 5, step: 10 },
        x: [0, 1, 2],
        y: [10, 20],
      },
    },
  );
  await openLiveHeatmap(page);
  await page.getByRole("button", { name: "LineCut Tool" }).first().click();
  await expect.poll(() => heatmapState(page)).not.toBeNull();

  // Preview samples the displayed, rotated grid.
  await hoverHeatmapAt(page, 0.5, 15);
  await expect.poll(async () => (await heatmapState(page))?.previewY).toEqual([2, 5]);

  // Map the displayed horizontal cut back to source x = 1.
  await clickHeatmapAt(page, 0.5, 15, () =>
    expect.poll(() => linePlotRequests.length, { timeout: 1_000 }).toBeGreaterThan(0),
  );
  expect(linePlotRequests[0]).toMatchObject({
    plotType: "LinePlot",
    indeps: ["voltage", "frequency"],
    cut: {
      start: { voltage: 1, frequency: 10 },
      end: { voltage: 1, frequency: 20 },
    },
  });
});

test("starting an oblique cut in a corner does not move the axes", async ({ page }) => {
  await mockLiveHeatmapApi(page);
  // Cells a few pixels wide, so the corner marker sits right at the edge.
  const xs = Array.from({ length: 120 }, (_, i) => i);
  const ys = Array.from({ length: 80 }, (_, i) => i);
  await mockGridHeatmap(
    page,
    { x: false, y: false },
    { x: xs, y: ys, z: ys.map((row) => xs.map((x) => x + row)) },
  );
  await openLiveHeatmap(page);
  await page.getByRole("button", { name: "LineCut Tool" }).first().click();
  await expect.poll(() => heatmapState(page)).not.toBeNull();
  await page.getByRole("button", { name: "Oblique", exact: true }).click();
  const before = (await heatmapState(page))!;

  await clickHeatmapAt(page, 0, 79, () =>
    expect(page.getByText("Now click where the cut should end.")).toBeVisible({
      timeout: 1_000,
    }),
  );
  await hoverHeatmapAt(page, 119, 0);
  await expect
    .poll(async () => (await heatmapState(page))?.previewY?.length ?? 0)
    .toBeGreaterThan(0);

  const after = (await heatmapState(page))!;
  expect(after.xRange).toEqual(before.xRange);
  expect(after.yRange).toEqual(before.yRange);
});

test("a zoomed heat map stays zoomed and can still be cut", async ({ page }) => {
  await mockLiveHeatmapApi(page);
  const xs = Array.from({ length: 120 }, (_, i) => i);
  const ys = Array.from({ length: 80 }, (_, i) => i);
  await mockGridHeatmap(
    page,
    { x: false, y: false },
    { x: xs, y: ys, z: ys.map((row) => xs.map((x) => x + row)) },
  );
  await openLiveHeatmap(page);
  await page.getByRole("button", { name: "LineCut Tool" }).first().click();
  await expect.poll(() => heatmapState(page)).not.toBeNull();

  const heatmap = page.locator(".js-plotly-plot").first();
  await heatmap.hover();
  await heatmap.locator('.modebar-btn[data-title="Zoom in"]').click();
  await expect
    .poll(async () => {
      const [low, high] = (await heatmapState(page))!.yRange;
      return high - low;
    })
    .toBeLessThan(60);
  const zoomed = (await heatmapState(page))!.yRange;

  // Changing mode and starting a cut must not throw the zoom away.
  await page.getByRole("button", { name: "Oblique", exact: true }).click();
  const [low, high] = zoomed;
  const inside = (fraction: number) => low + (high - low) * fraction;
  await clickHeatmapAt(page, 60, Math.round(inside(0.3)), () =>
    expect(page.getByText("Now click where the cut should end.")).toBeVisible({
      timeout: 1_000,
    }),
  );
  await hoverHeatmapAt(page, 65, 45);
  await expect
    .poll(async () => (await heatmapState(page))?.previewY?.length ?? 0)
    .toBeGreaterThan(0);
  expect((await heatmapState(page))!.yRange).toEqual(zoomed);
});

test("the guide keeps following the pointer after zooming far in", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await mockLiveHeatmapApi(page);
  await openLiveHeatmap(page);
  await enterLineCut(page);

  // Far enough in that the axis title switches to a smaller unit prefix.
  for (let i = 0; i < 5; i++) await zoomHeatmap(page, 0.3, 0.6);
  const { xRange, yRange } = (await heatmapState(page))!;
  const guideX = () =>
    page.evaluate(() => {
      const gd = (Array.from(document.querySelectorAll(".js-plotly-plot")) as any[]).find(
        (plot) => plot.data?.[0]?.type === "heatmap",
      );
      const guide =
        document.querySelector<SVGElement>("[data-linecut-guide]")?.dataset.linecutGuide;
      return [guide ? JSON.parse(guide).hovered?.x : undefined, gd._hoverdata?.[0]?.x];
    });

  await hoverHeatmapAt(
    page,
    xRange[0] + (xRange[1] - xRange[0]) * 0.5,
    (yRange[0] + yRange[1]) / 2,
  );
  await expect
    .poll(async () => {
      const [guide, hovered] = await guideX();
      return guide !== undefined && guide === hovered;
    })
    .toBe(true);
  expect(errors.filter((text) => text.includes("Maximum update depth"))).toEqual([]);
});

test("the guide is drawn over the hovered column", async ({ page }) => {
  await mockLiveHeatmapApi(page);
  await openLiveHeatmap(page);
  await enterLineCut(page);

  await hoverHeatmapAt(page, -1.6, 197_500_000);
  await hoverHeatmapAt(page, -1.5, 197_500_000);
  await hoverHeatmapAt(page, -1.4, 197_500_000);

  // The red line sits on the hovered column's centre, in pixels.
  await expect
    .poll(() =>
      page.evaluate(() => {
        const gd = (Array.from(document.querySelectorAll(".js-plotly-plot")) as any[]).find(
          (plot) => plot.data?.[0]?.type === "heatmap",
        );
        const hovered = gd._hoverdata?.[0]?.x;
        const line = document.querySelectorAll("[data-linecut-guide] line")[1] as SVGLineElement;
        if (hovered === undefined || !line) return null;
        const xa = gd._fullLayout.xaxis;
        const expected = gd.getBoundingClientRect().left + xa._offset + xa.l2p(xa.d2l(hovered));
        const actual = line.getBoundingClientRect().left + line.getBoundingClientRect().width / 2;
        return Math.abs(actual - expected) < 1.5;
      }),
    )
    .toBe(true);
});

test("LineCut opens in a pop-up that expands to the full window and back", async ({ page }) => {
  await mockLiveHeatmapApi(page);
  await openLiveHeatmap(page);
  await page.getByRole("button", { name: "LineCut Tool" }).first().click();

  // The plot stays in its tile; the preview is a floating card.
  const popup = page.getByRole("dialog", { name: "LineCut" });
  await expect(popup).toBeVisible();
  await expect(page.getByRole("button", { name: "Restore" })).toHaveCount(0);

  await hoverHeatmapAt(page, -1.6, 197_500_000);
  await expect
    .poll(async () => (await heatmapState(page))?.previewY?.length ?? 0)
    .toBeGreaterThan(0);

  // Expanding moves the preview beside a full-window heat map; only one preview exists.
  await popup.getByRole("button", { name: "Expand LineCut" }).click();
  await expect(popup).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Restore" })).toBeVisible();
  await page.keyboard.press("o");
  await expect(page.getByRole("button", { name: "Oblique", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  // Restoring keeps LineCut, and its direction, in the pop-up.
  await page.getByRole("button", { name: "Restore" }).click();
  await expect(popup).toBeVisible();
  await expect(popup.getByRole("button", { name: "Oblique", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const previews = await page.evaluate(
    () =>
      (Array.from(document.querySelectorAll(".js-plotly-plot")) as any[]).filter(
        (gd) => gd.data?.[0]?.name === "LineCut Preview",
      ).length,
  );
  expect(previews).toBeLessThanOrEqual(1);

  await popup.getByRole("button", { name: "Leave LineCut" }).click();
  await expect(popup).toHaveCount(0);
});

test("X, Y and O only change the cut while LineCut is on", async ({ page }) => {
  await mockLiveHeatmapApi(page);
  await openLiveHeatmap(page);

  // Outside LineCut the keys do nothing to it.
  await page.locator("body").press("o");
  await page.locator("body").press("y");
  await page.getByRole("button", { name: "LineCut Tool" }).first().click();
  const popup = page.getByRole("dialog", { name: "LineCut" });
  const pressed = (name: string) =>
    popup.getByRole("button", { name, exact: true }).getAttribute("aria-pressed");
  await expect.poll(() => pressed("Horizontal")).toBe("true");

  // A key with a modifier is someone else's shortcut.
  await page.keyboard.press("Control+y");
  await page.keyboard.press("Alt+o");
  expect(await pressed("Horizontal")).toBe("true");

  await page.keyboard.press("y");
  await expect.poll(() => pressed("Vertical")).toBe("true");

  // After leaving, the keys are inert again.
  await page.keyboard.press("Escape");
  await expect(popup).toHaveCount(0);
  await page.locator("body").press("o");
  await page.getByRole("button", { name: "LineCut Tool" }).first().click();
  await expect.poll(() => pressed("Horizontal")).toBe("true");
});

test("the linecut preview hovers with the heat map's labels and units", async ({ page }) => {
  await mockLiveHeatmapApi(page);
  const volts = (label: string) => ({
    label,
    unit: "V",
    unit_text: "V",
    engineering_titles: { "0": `${label} (V)`, "-3": `${label} (mV)` },
    engineering_units_text: { "0": "V", "-3": "mV" },
  });
  await page.route("**/plot/", async (route) => {
    const body = route.request().postDataJSON();
    if (body.plotType !== "HeatMap") return route.fallback();
    await route.fulfill({
      json: {
        success: true,
        message: "created",
        plots: [
          {
            id: "units",
            plot_ref: "plot-ref-HeatMap",
            type: "HeatMap",
            is_live: true,
            plotJson: {
              data: [
                {
                  type: "heatmap",
                  x: [0, 0.5, 1],
                  y: [0, 1],
                  z: [
                    [4.8, 4.9, 5],
                    [4.7, 4.8, 4.9],
                  ],
                  hovertemplate:
                    "Voltage 2: %{x:.3~s}V<br>Voltage 1: %{y:.3~s}V<br>" +
                    "Voltmeter: %{z:.3~s}V<extra></extra>",
                },
              ],
              layout: {
                meta: {
                  qimchi_units: {
                    x: volts("Voltage 2"),
                    y: volts("Voltage 1"),
                    z: volts("Voltmeter"),
                  },
                },
              },
            },
          },
        ],
      },
    });
  });
  await openLiveHeatmap(page);
  await enterLineCut(page);

  // A cut at fixed x runs along y.
  await hoverHeatmapAt(page, 0.5, 1);
  await expect
    .poll(async () => (await heatmapState(page))?.previewHover)
    .toBe("Voltage 1: %{x:.3~s}V<br>Voltmeter: %{y:.3~s}V<extra></extra>");
  const { previewUnits, previewTitle } = (await heatmapState(page))!;
  expect(previewTitle).toBe("Slice at Voltage 2 = 500 mV");
  expect(previewUnits.x.label).toBe("Voltage 1");
  expect(previewUnits.y.label).toBe("Voltmeter");

  await expect(page.locator(".hoverlayer .hovertext").first()).toBeVisible();
  const stacking = await page.evaluate(() => {
    const guide = document.querySelector("[data-linecut-guide]");
    const plot = guide?.closest(".js-plotly-plot");
    const tooltip = plot?.querySelector(".hoverlayer .hovertext");
    const position =
      guide && tooltip
        ? guide.compareDocumentPosition(tooltip)
        : Node.DOCUMENT_POSITION_DISCONNECTED;
    return {
      found: Boolean(guide && tooltip),
      tooltipAboveGuide: Boolean(position & Node.DOCUMENT_POSITION_FOLLOWING),
    };
  });
  expect(stacking.found).toBe(true);
  expect(stacking.tooltipAboveGuide).toBe(true);
});

test("LineCut starts in the direction chosen in Settings", async ({ page }) => {
  await mockLiveHeatmapApi(page);
  await mockSettingsApi(page, { plots: { lineCutDirection: "vertical" } });
  await openLiveHeatmap(page);

  await page.getByRole("button", { name: "LineCut Tool" }).first().click();
  const direction = page.getByRole("group", { name: "LineCut direction" }).first();
  await expect(direction.getByRole("button", { name: "Vertical" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("the cut can follow the newest line of a live heat map as it grows", async ({ page }) => {
  const state = await mockLiveHeatmapApi(page);
  await openLiveHeatmap(page);
  await enterLineCut(page);

  const follow = page.getByRole("button", { name: "Follow the newest line" }).first();
  await follow.click();
  await expect(follow).toHaveAttribute("aria-pressed", "true");

  // The early frame has measured two of five gate values, column by column.
  await expect
    .poll(async () => (await heatmapState(page))?.previewTitle)
    .toMatch(/^Newest column · /);
  const early = (await heatmapState(page))!;
  expect(early.previewY).toHaveLength(7);

  state.frame = "later";
  await expect
    .poll(async () => (await heatmapState(page))?.previewTitle, { timeout: 5_000 })
    .not.toBe(early.previewTitle);
  expect((await heatmapState(page))!.previewTitle).toMatch(/^Newest column · /);

  // Swapping the axes keeps following: the columns are now rows.
  await page.mouse.move(0, 0);
  await page
    .getByRole("button", { name: /^Swap X (&|and) Y axes$/i })
    .first()
    .click();
  await expect
    .poll(async () => (await heatmapState(page))?.previewTitle, { timeout: 5_000 })
    .toMatch(/^Newest row · /);
  await expect(follow).toHaveAttribute("aria-pressed", "true");

  // Choosing a direction by hand stops following.
  await page.keyboard.press("x");
  await expect(follow).toHaveAttribute("aria-pressed", "false");
});

test("Follow is removed when a live plot completes", async ({ page }) => {
  const state = await mockLiveHeatmapApi(page);
  await mockSettingsApi(page, { live: { minRefreshMs: 100 } });
  await openLiveHeatmap(page);
  await enterLineCut(page);

  const follow = page.getByRole("button", { name: "Follow the newest line" }).first();
  await expect(follow).toBeVisible();
  await follow.click();
  await expect(follow).toHaveAttribute("aria-pressed", "true");

  state.isLive = false;
  await expect(follow).toHaveCount(0, { timeout: 5_000 });
  await expect(page.getByRole("button", { name: "Stop following the newest line" })).toHaveCount(0);
});

test("a LineCut card placed by hand stays inside a window that has become smaller", async ({
  page,
}) => {
  await mockLiveHeatmapApi(page);
  await openLiveHeatmap(page);
  await page.getByRole("button", { name: "LineCut Tool" }).first().click();
  const popup = page.getByRole("dialog", { name: "LineCut" });
  await expect(popup).toBeVisible();

  // Drag the card to the bottom-right corner of the large window.
  const handle = (await popup.locator(".linecut-popup-handle").first().boundingBox())!;
  await page.mouse.move(handle.x + 20, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(1550, 950, { steps: 15 });
  await page.mouse.up();
  await popup.getByRole("button", { name: "Leave LineCut" }).click();
  await expect(popup).toHaveCount(0);

  const inside = async (width: number, height: number) => {
    const box = (await popup.boundingBox())!;
    return box.x >= 0 && box.y >= 0 && box.x + box.width <= width && box.y + box.height <= height;
  };

  // Reopening it in a smaller window moves it back inside.
  await page.setViewportSize({ width: 1000, height: 650 });
  await page.getByRole("button", { name: "LineCut Tool" }).first().click();
  await expect.poll(() => inside(1000, 650)).toBe(true);

  // Shrinking the window while it is open does the same.
  await page.setViewportSize({ width: 820, height: 560 });
  await expect.poll(() => inside(820, 560)).toBe(true);
});

/** Convert preview data coordinates to page coordinates after the layout settles. */
async function previewPoint(page: Page, x: number, y: number) {
  const locate = () =>
    page.evaluate(
      ([dataX, dataY]) => {
        const gd = (Array.from(document.querySelectorAll(".js-plotly-plot")) as any[]).find(
          (plot) => plot.data?.[0]?.name === "LineCut Preview",
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
  // Marker list changes can resize the preview, so wait for stable coordinates.
  let point = await locate();
  await expect(async () => {
    await page.waitForTimeout(150);
    const again = await locate();
    const settled = again.x === point.x && again.y === point.y;
    point = again;
    expect(settled).toBe(true);
  }).toPass({ timeout: 5_000 });
  return point;
}

/** Click the LineCut preview at the given data coordinates. */
async function clickPreviewAt(page: Page, x: number, y: number, modifiers: "Shift"[] = []) {
  const point = await previewPoint(page, x, y);
  for (const key of modifiers) await page.keyboard.down(key);
  await page.mouse.click(point.x, point.y);
  for (const key of modifiers) await page.keyboard.up(key);
}

/** Hover a row of the grid heat map until the preview shows it. */
async function previewRow(page: Page, y: number, values: number[]) {
  await expect(async () => {
    await page.mouse.move(0, 0);
    await hoverHeatmapAt(page, 1, y);
    await expect
      .poll(async () => (await heatmapState(page))?.previewY, { timeout: 1_000 })
      .toEqual(values);
  }).toPass({ timeout: 10_000 });
}

async function pickMarkerTool(page: Page, name: "vertical line" | "horizontal line" | "point") {
  const button = page.getByRole("dialog", { name: "LineCut" }).getByRole("button", {
    name: `Add a ${name}`,
  });
  await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "true");
}

const drawnMarkers = (page: Page) =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll("[data-linecut-marker]")).map((marker) =>
      marker.getAttribute("data-kind"),
    ),
  );

test("markers can be placed on the preview, selected and removed", async ({ page }) => {
  await mockLiveHeatmapApi(page);
  await mockGridHeatmap(page);
  await openLiveHeatmap(page);
  await page.getByRole("button", { name: "LineCut Tool" }).first().click();
  const popup = page.getByRole("dialog", { name: "LineCut" });
  const markers = popup.getByRole("list", { name: "Placed markers" }).getByRole("listitem");

  await previewRow(page, 20, [10, 11, 12, 13, 14]);

  // A vertical line snaps to the nearest sample.
  await pickMarkerTool(page, "vertical line");
  await expect(popup.getByRole("button", { name: "Add a vertical line" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await clickPreviewAt(page, 2.3, 12.5);
  await expect(markers).toHaveCount(1);
  await expect(markers.first()).toHaveText("2");

  // Points snap to the nearest curve sample; horizontal lines use its y value.
  await pickMarkerTool(page, "point");
  await clickPreviewAt(page, 3.2, 13.1);
  await pickMarkerTool(page, "horizontal line");
  await clickPreviewAt(page, 1.2, 11.4);
  // Shift disables snapping; pixel rounding makes the result close to 11.5.
  await clickPreviewAt(page, 0.5, 11.5, ["Shift"]);
  // Lines are listed first, then points.
  await expect(markers).toHaveText(["2", "11", /^11\.5\d*$/, "3, 13"]);
  expect(await drawnMarkers(page)).toEqual(["vline", "point", "hline", "hline"]);

  // Escape deactivates the marker tool without closing LineCut.
  await page.keyboard.press("Escape");
  await expect(popup.getByRole("button", { name: "Add a horizontal line" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await expect(popup).toBeVisible();

  // Changing the cut preserves marker coordinates.
  await previewRow(page, 30, [20, 21, 22, 23, 24]);
  await expect(markers).toHaveCount(4);

  // Delete removes the selected marker while keeping the plot open.
  await clickPreviewAt(page, 2, 22);
  await expect(
    popup.getByRole("button", { name: "Vertical line at 2", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Delete");
  await expect(markers).toHaveText(["11", /^11\.5/, "3, 13"]);
  await expect(page.locator(".js-plotly-plot").first()).toBeVisible();

  // The chip's remove button also removes the marker.
  await popup.getByRole("button", { name: "Remove the point at 3, 13" }).click();
  await expect(markers).toHaveText(["11", /^11\.5/]);
  expect(await drawnMarkers(page)).toEqual(["hline", "hline"]);

  // Escape closes LineCut when no tool or marker is active; reopening restores markers.
  await page.keyboard.press("Escape");
  await expect(popup).toHaveCount(0);
  await page.getByRole("button", { name: "LineCut Tool" }).first().click();
  await previewRow(page, 20, [10, 11, 12, 13, 14]);
  await expect(markers).toHaveText(["11", /^11\.5/]);
});

test("oblique cuts have no markers, and the others come back afterwards", async ({ page }) => {
  await mockLiveHeatmapApi(page);
  await mockGridHeatmap(page);
  await openLiveHeatmap(page);
  await page.getByRole("button", { name: "LineCut Tool" }).first().click();
  const popup = page.getByRole("dialog", { name: "LineCut" });
  const markers = popup.getByRole("list", { name: "Placed markers" }).getByRole("listitem");

  await previewRow(page, 20, [10, 11, 12, 13, 14]);
  await pickMarkerTool(page, "vertical line");
  await clickPreviewAt(page, 1, 11);
  await expect(markers).toHaveCount(1);

  await page.keyboard.press("o");
  await expect(popup.getByRole("button", { name: "Add a vertical line" })).toBeDisabled();
  await expect(markers).toHaveCount(0);
  await expect(popup.getByText("Not available for oblique cuts")).toBeVisible();

  await page.keyboard.press("x");
  await previewRow(page, 20, [10, 11, 12, 13, 14]);
  await expect(markers).toHaveText(["1"]);
  expect(await drawnMarkers(page)).toEqual(["vline"]);
});

test("closing a plot forgets its markers", async ({ page }) => {
  await mockLiveHeatmapApi(page);
  await mockGridHeatmap(page);
  await openLiveHeatmap(page);
  await page.getByRole("button", { name: "LineCut Tool" }).first().click();
  await previewRow(page, 20, [10, 11, 12, 13, 14]);
  await pickMarkerTool(page, "vertical line");
  await clickPreviewAt(page, 1, 11);

  const storedMarkers = () =>
    page.evaluate(() => {
      const saved = JSON.parse(localStorage.getItem("plot-states-storage") ?? "{}");
      return Object.values(saved.state?.plotStates ?? {}).filter(
        (plot: any) => plot.linecut_markers,
      ).length;
    });
  await expect.poll(storedMarkers).toBe(1);

  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Close plot" }).first().click();
  await expect.poll(storedMarkers).toBe(0);
});

test("markers do not pile up drawing nodes while a live preview refreshes", async ({ page }) => {
  const state = await mockLiveHeatmapApi(page);
  await openLiveHeatmap(page);
  await enterLineCut(page);
  await hoverHeatmapAt(page, -1.6, 197_500_000);
  await expect.poll(async () => (await heatmapState(page))?.previewY?.length ?? 0).toBe(7);

  const preview = (await heatmapState(page))!;
  await pickMarkerTool(page, "vertical line");
  await clickPreviewAt(page, preview.previewX![2], preview.previewY![2]);
  await pickMarkerTool(page, "point");
  await clickPreviewAt(page, preview.previewX![4], preview.previewY![4]);
  await page.keyboard.press("Escape");
  const nodes = () =>
    page.evaluate(() => document.querySelectorAll("[data-linecut-markers] *").length);
  await expect.poll(drawnMarkers.bind(null, page)).toEqual(["vline", "point"]);
  const before = await nodes();

  state.frame = "later";
  await expect
    .poll(async () => (await heatmapState(page))?.previewY, { timeout: 5_000 })
    .not.toEqual(preview.previewY);
  // Live refreshes preserve markers without adding drawing nodes.
  await page.waitForTimeout(2_500);
  expect(await drawnMarkers(page)).toEqual(["vline", "point"]);
  expect(await nodes()).toBe(before);
  expect(await page.locator("[data-linecut-markers]").count()).toBe(1);
});

test("the arrow keys nudge the selected marker through the data", async ({ page }) => {
  await mockLiveHeatmapApi(page);
  await mockGridHeatmap(page);
  await mockSettingsApi(page, { plots: { lineCutMarkerStep: 2 } });
  await openLiveHeatmap(page);
  await page.getByRole("button", { name: "LineCut Tool" }).first().click();
  const popup = page.getByRole("dialog", { name: "LineCut" });
  const markers = popup.getByRole("list", { name: "Placed markers" }).getByRole("listitem");

  await previewRow(page, 20, [10, 11, 12, 13, 14]);
  await pickMarkerTool(page, "point");
  await clickPreviewAt(page, 2, 12);
  await page.keyboard.press("Escape");
  await expect(markers).toHaveText(["2, 12"]);

  // Arrow keys move points by one sample; Shift uses the configured step size.
  await page.locator("body").press("ArrowRight");
  await expect(markers).toHaveText(["3, 13"]);
  await page.locator("body").press("Shift+ArrowLeft");
  await expect(markers).toHaveText(["1, 11"]);
  await page.locator("body").press("Shift+ArrowLeft");
  await expect(markers).toHaveText(["0, 10"]);
  // Up and down do not move a point.
  await page.locator("body").press("ArrowUp");
  await expect(markers).toHaveText(["0, 10"]);

  // Horizontal lines step through the curve's sorted y values.
  await pickMarkerTool(page, "horizontal line");
  await clickPreviewAt(page, 1, 11);
  await page.keyboard.press("Escape");
  const line = markers.nth(0);
  await expect(line).toHaveText("11");
  await page.locator("body").press("ArrowUp");
  await expect(line).toHaveText("12");
  await page.locator("body").press("Shift+ArrowUp");
  await expect(line).toHaveText("14");

  // Arrow keys leave markers unchanged when none is selected.
  await page.keyboard.press("Escape");
  const unchanged = await markers.allTextContents();
  await page.locator("body").press("ArrowRight");
  await expect(markers).toHaveText(unchanged);
});

test("each spot holds one marker of a kind, and nudging steps past taken spots", async ({
  page,
}) => {
  await mockLiveHeatmapApi(page);
  await mockGridHeatmap(page);
  await openLiveHeatmap(page);
  await page.getByRole("button", { name: "LineCut Tool" }).first().click();
  const popup = page.getByRole("dialog", { name: "LineCut" });
  const markers = popup.getByRole("list", { name: "Placed markers" }).getByRole("listitem");

  await previewRow(page, 20, [10, 11, 12, 13, 14]);
  await pickMarkerTool(page, "point");
  await clickPreviewAt(page, 2, 12);
  await clickPreviewAt(page, 3, 13);
  // Placing a duplicate selects the existing point.
  await clickPreviewAt(page, 2.1, 12.1);
  await expect(page.getByText("There is already a point there.")).toBeVisible();
  await expect(markers).toHaveText(["2, 12", "3, 13"]);
  await expect(popup.getByRole("button", { name: "Point at 2, 12", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  // Different marker kinds can share a position.
  await pickMarkerTool(page, "vertical line");
  await clickPreviewAt(page, 2, 12);
  await expect(markers).toHaveText(["2", "2, 12", "3, 13"]);

  // Nudging the point at 2 to the right skips the point at 3.
  await page.keyboard.press("Escape");
  await popup.getByRole("button", { name: "Point at 2, 12", exact: true }).click();
  await page.locator("body").press("ArrowRight");
  await expect(markers).toHaveText(["2", "3, 13", "4, 14"]);
});

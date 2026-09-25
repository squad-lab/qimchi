import type { Page } from "@playwright/test";

import { expect, test } from "./coverage";
import {
  heatmapState,
  hoverHeatmapAt,
  mockLiveHeatmapApi,
  openLiveHeatmap,
  zoomHeatmap,
} from "./liveHeatmap";

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

import type { Page } from "@playwright/test";

import { expect, test } from "./coverage";
import { mockLiveHeatmapApi } from "./liveHeatmap";
import { mockSettingsApi } from "./settingsMock";

async function openBothPlots(page: Page) {
  await mockLiveHeatmapApi(page);
  const settings = await mockSettingsApi(page, { plots: { plottingBehaviour: "both" } });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/");
  await page.getByRole("button", { name: "Live Measurements" }).click();
  await page.getByText("live-heat", { exact: true }).dblclick();
  await expect(page.locator(".js-plotly-plot")).toHaveCount(2);
  return settings;
}

// Each plot card's width as the Viewer lays it out, keyed by trace type.
const plotWidths = (page: Page) =>
  page.evaluate(() =>
    Object.fromEntries(
      (Array.from(document.querySelectorAll(".js-plotly-plot")) as any[]).map((plot) => {
        const card = plot.closest("[style*='flex-basis']") as HTMLElement;
        return [plot.data?.[0]?.type, card.style.maxWidth];
      }),
    ),
  );

test("the width button sizes one plot, and the Viewer's buttons size them all", async ({
  page,
}) => {
  const settings = await openBothPlots(page);
  const widthButtons = page
    .locator("[data-plot-id]")
    .getByRole("button", { name: "Plot width", exact: true });
  await expect(widthButtons).toHaveCount(2);

  // The options stay hidden until the button is pressed.
  await expect(page.getByRole("menuitemradio")).toHaveCount(0);
  await widthButtons.first().click();
  await expect(page.getByRole("menuitemradio")).toHaveCount(4);
  await page.getByRole("menuitemradio", { name: "100% width (this plot)" }).click();
  await expect(page.getByRole("menuitemradio")).toHaveCount(0);

  const widths = await plotWidths(page);
  expect(Object.values(widths).sort()).toEqual(["calc(100% - 8px)", "calc(50% - 8px)"]);
  // A plot's own width is for this session only; it is not a saved setting.
  expect(settings.document).toEqual({ plots: { plottingBehaviour: "both" } });

  const viewerWidth = page.getByRole("button", { name: "Plot width", exact: true }).last();
  await viewerWidth.click();
  await page.getByRole("menuitemradio", { name: "33% width (all plots)" }).click();
  await expect
    .poll(async () => Object.values(await plotWidths(page)))
    .toEqual(["calc(33% - 8px)", "calc(33% - 8px)"]);
});

test("the export button offers export to disk and to notes", async ({ page }) => {
  await openBothPlots(page);
  const requests: string[] = [];
  await page.route("**/export-plot-images**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    requests.push(path);
    if (path.endsWith("/send-to-notes")) {
      await route.fulfill({ json: { success: true, paths: {}, md_line: "" } });
    } else if (path.includes("/status/")) {
      await route.fulfill({ json: { status: "completed", saved_to: "C:/exports/a.zip" } });
    } else {
      await route.fulfill({ status: 202, json: { task_id: "task" } });
    }
  });

  const exportButton = page.getByRole("button", { name: "Export", exact: true }).first();
  await exportButton.click();
  await page.getByRole("menuitem", { name: "Export images" }).click();
  await expect.poll(() => requests).toContain("/export-plot-images");

  await exportButton.click();
  await page.getByRole("menuitem", { name: "Send to Notes" }).click();
  await expect.poll(() => requests).toContain("/export-plot-images/send-to-notes");

  // Escape closes the menu without choosing anything.
  await exportButton.click();
  await expect(page.getByRole("menu", { name: "Export" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu", { name: "Export" })).toHaveCount(0);
});

test("plot sidebar tooltips show keyboard shortcuts", async ({ page }) => {
  await openBothPlots(page);
  const heatmap = page.locator("[data-plot-id]").first();
  await heatmap.hover();

  await heatmap.getByRole("button", { name: "LineCut Tool" }).hover();
  await expect(page.getByRole("tooltip", { name: "LineCut Tool (Shift+X)" })).toBeVisible();

  await heatmap.getByRole("button", { name: "Swap X and Y axes" }).hover();
  await expect(page.getByRole("tooltip", { name: "Swap X & Y Axes (S)" })).toBeVisible();

  await heatmap.getByRole("button", { name: "Reset plot" }).hover();
  await expect(page.getByRole("tooltip", { name: "Reset plot (R)" })).toBeVisible();
});

// Plot trace types and widths in the Viewer's order.
const plotLayout = (page: Page) =>
  page.evaluate(() =>
    (Array.from(document.querySelectorAll(".js-plotly-plot")) as any[]).map((plot) => {
      const card = plot.closest("[data-plot-id]") as HTMLElement;
      return `${plot.data?.[0]?.type} ${card.style.maxWidth}`;
    }),
  );

test("plots are rearranged by dragging their handle, and keep their own widths", async ({
  page,
}) => {
  await openBothPlots(page);
  await page.getByRole("button", { name: "Plot width", exact: true }).first().click();
  await page.getByRole("menuitemradio", { name: "100% width (this plot)" }).click();
  await expect
    .poll(() => plotLayout(page))
    .toEqual(["heatmap calc(100% - 8px)", "scatter calc(50% - 8px)"]);

  // Moving a plot must not redraw it from scratch.
  await page.evaluate(() =>
    document.querySelectorAll<HTMLElement>(".js-plotly-plot").forEach((plot) => {
      plot.dataset.beforeMove = "yes";
    }),
  );
  const cards = page.locator("[data-plot-id]");
  // The ribbon slides in on hover or focus; wait until the handle sits inside
  // its plot before grabbing it.
  const handle = cards.nth(1).getByRole("button", { name: "Move plot" });
  await cards.nth(1).hover();
  await handle.focus();
  await expect
    .poll(async () => {
      const [box, card] = [await handle.boundingBox(), await cards.nth(1).boundingBox()];
      return Boolean(box && card && box.x + box.width <= card.x + card.width);
    })
    .toBe(true);
  const from = (await handle.boundingBox())!;
  const onto = (await cards.nth(0).boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(onto.x + 40, onto.y + 80, { steps: 10 });
  await expect(page.locator("[data-drop-side='before']")).toHaveCount(1);
  await page.mouse.up();

  await expect
    .poll(() => plotLayout(page))
    .toEqual(["scatter calc(50% - 8px)", "heatmap calc(100% - 8px)"]);
  await expect(page.locator(".js-plotly-plot")).toHaveCount(2);
  expect(await cards.nth(0).evaluate((node) => node.style.transform)).toBe("");
  await expect(page.locator(".js-plotly-plot[data-before-move='yes']")).toHaveCount(2);

  // The handle also moves a plot from the keyboard.
  await cards.nth(1).hover();
  await cards.nth(1).getByRole("button", { name: "Move plot" }).focus();
  await page.keyboard.press("ArrowLeft");
  await expect
    .poll(() => plotLayout(page))
    .toEqual(["heatmap calc(100% - 8px)", "scatter calc(50% - 8px)"]);
});

test("the Viewer exports every plot at once, each as it is shown", async ({ page }) => {
  await openBothPlots(page);
  // Export dimensions should match each plot's displayed size.
  await page.getByRole("button", { name: "Plot width", exact: true }).first().click();
  await page.getByRole("menuitemradio", { name: "100% width (this plot)" }).click();
  type Exported = { layout: { width?: number; height?: number }; data: { type: string }[] };
  let batch: { plots: { fpath: string; relayout_data: unknown; plot_json: Exported }[] } | null =
    null;
  await page.route("**/export-plot-images**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/batch")) {
      batch = route.request().postDataJSON();
      await route.fulfill({ status: 202, json: { task_id: "task" } });
    } else {
      await route.fulfill({
        json: { status: "completed", saved_to: "C:/exports/all.zip", exported: 2, failures: [] },
      });
    }
  });

  await page.getByRole("button", { name: "Export all plots" }).click();
  await expect(page.getByText("Saved to C:/exports/all.zip")).toBeVisible();
  expect(batch!.plots).toHaveLength(2);
  expect(batch!.plots.every((plot) => plot.plot_json && plot.fpath)).toBe(true);
  const drawn = await page.evaluate(() =>
    Object.fromEntries(
      (Array.from(document.querySelectorAll(".js-plotly-plot")) as any[]).map((plot) => [
        plot.data?.[0]?.type,
        [plot.clientWidth, plot.clientHeight],
      ]),
    ),
  );
  for (const { plot_json } of batch!.plots) {
    const [width, height] = drawn[plot_json.data[0].type];
    expect([plot_json.layout.width, plot_json.layout.height]).toEqual([width, height]);
  }
  expect(drawn.heatmap[0]).toBeGreaterThan(drawn.scatter[0]);
});

test("a plot can be copied to the clipboard as an image", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await openBothPlots(page);

  await page.getByRole("button", { name: "Export", exact: true }).first().click();
  await page.getByRole("menuitem", { name: "Copy to clipboard" }).click();
  await expect(page.getByText("Copied the plot to the clipboard.")).toBeVisible();

  const types = await page.evaluate(async () => {
    const items = await navigator.clipboard.read();
    return items.flatMap((item) => item.types);
  });
  expect(types).toContain("image/png");
});

test("a reload keeps the Basket, the plots and their widths", async ({ page }) => {
  await openBothPlots(page);
  await page.getByRole("button", { name: "Plot width", exact: true }).first().click();
  await page.getByRole("menuitemradio", { name: "100% width (this plot)" }).click();
  const before = await plotLayout(page);

  await page.reload();
  await expect(page.locator(".js-plotly-plot")).toHaveCount(2);
  await expect.poll(() => plotLayout(page)).toEqual(before);
  await expect(page.locator("[data-tour='basket']").getByText("live-heat")).toBeVisible();
});

const closeCard = async (page: Page, index: number) => {
  const card = page.locator("[data-plot-id]").nth(index);
  await card.hover();
  await card.getByRole("button", { name: "Close plot" }).first().click();
};

test("a closed plot comes back with Ctrl+Z, where it was and as wide as it was", async ({
  page,
}) => {
  await openBothPlots(page);
  await page.getByRole("button", { name: "Plot width", exact: true }).first().click();
  await page.getByRole("menuitemradio", { name: "100% width (this plot)" }).click();
  await expect
    .poll(() => plotLayout(page))
    .toEqual(["heatmap calc(100% - 8px)", "scatter calc(50% - 8px)"]);

  // Swap the axes to check that reopening restores saved state.
  const heatmapCard = page.locator("[data-plot-id]").first();
  const plotId = await heatmapCard.getAttribute("data-plot-id");
  await heatmapCard.hover();
  await heatmapCard.getByRole("button", { name: /^Swap X (&|and) Y axes$/i }).click();
  const swapped = () =>
    page.evaluate(
      (id) =>
        JSON.parse(localStorage.getItem("plot-states-storage") ?? "{}").state?.plotStates?.[id!]
          ?.axes_swapped ?? false,
      plotId,
    );
  await expect.poll(swapped).toBe(true);

  await closeCard(page, 0);
  await expect(page.locator(".js-plotly-plot")).toHaveCount(1);
  await expect(page.getByText(/^Closed .+ vs .+\.$/)).toBeVisible();
  await expect.poll(swapped).toBe(false);

  await page.locator("body").press("Control+z");
  await expect(page.locator(".js-plotly-plot")).toHaveCount(2);
  await expect(page.locator("[data-plot-id]").first()).toHaveAttribute("data-plot-id", plotId!);
  await expect.poll(swapped).toBe(true);
  await expect
    .poll(() => plotLayout(page))
    .toEqual(["heatmap calc(100% - 8px)", "scatter calc(50% - 8px)"]);

  // Ctrl+Z has no effect once the closed-plot history is empty.
  await page.locator("body").press("Control+z");
  await page.waitForTimeout(300);
  await expect(page.locator(".js-plotly-plot")).toHaveCount(2);
});

test("Clear all is undone in one step from the toast", async ({ page }) => {
  await openBothPlots(page);
  const before = await plotLayout(page);

  await page.getByRole("button", { name: "Clear All Plots" }).click();
  await expect(page.locator(".js-plotly-plot")).toHaveCount(0);
  const toast = page.getByText("Closed 2 plots.");
  await expect(toast).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();

  await expect(page.locator(".js-plotly-plot")).toHaveCount(2);
  await expect.poll(() => plotLayout(page)).toEqual(before);
});

test("the Recently closed list reopens one plot, and Ctrl+Z leaves text fields alone", async ({
  page,
}) => {
  await openBothPlots(page);
  await closeCard(page, 1);
  await closeCard(page, 0);
  await expect(page.locator(".js-plotly-plot")).toHaveCount(0);

  // Ctrl+Z in a text field must not reopen plots.
  const search = page.getByRole("textbox").first();
  await search.click();
  await search.press("Control+z");
  await page.waitForTimeout(300);
  await expect(page.locator(".js-plotly-plot")).toHaveCount(0);

  await page.getByRole("button", { name: "Recently closed plots" }).click();
  const list = page.getByRole("menu", { name: "Recently closed plots" });
  await expect(list.getByRole("menuitem")).toHaveCount(2);
  await list.getByRole("menuitem").last().click();
  await expect(page.locator(".js-plotly-plot")).toHaveCount(1);
  await expect.poll(() => plotLayout(page)).toEqual(["scatter calc(50% - 8px)"]);

  await page.getByRole("button", { name: "Recently closed plots" }).click();
  await expect(list.getByRole("menuitem")).toHaveCount(1);
  await list.getByRole("button", { name: "Clear list" }).click();
  await page.getByRole("button", { name: "Recently closed plots" }).click();
  await expect(list.getByRole("menuitem")).toHaveCount(0);
  await expect(list.getByText("Re-open closed plots from here.")).toBeVisible();
});

test("a closed plot's backend context is released, unless it is reopened in time", async ({
  page,
}) => {
  await page.clock.install();
  await openBothPlots(page);
  const released: string[][] = [];
  await page.route("**/plot-contexts/release", async (route) => {
    released.push(route.request().postDataJSON().plot_refs);
    await route.fulfill({ json: { released: 1 } });
  });

  // Reopening before the release delay keeps the backend context.
  await closeCard(page, 1);
  await page.locator("body").press("Control+z");
  await expect(page.locator(".js-plotly-plot")).toHaveCount(2);
  await page.clock.fastForward(31_000);
  await page.waitForTimeout(200);
  expect(released.flat()).not.toContain("plot-ref-LinePlot");

  // After the delay, only the closed plot's context is released.
  await closeCard(page, 1);
  await expect(page.locator(".js-plotly-plot")).toHaveCount(1);
  await page.clock.fastForward(31_000);
  await expect.poll(() => released.flat()).toContain("plot-ref-LinePlot");
  expect(released.flat()).not.toContain("plot-ref-HeatMap");
});

test("the Recently closed list stays inside a short window", async ({ page }) => {
  // Seed a full closed-plot history in session storage.
  await page.addInitScript(() => {
    const plots = Array.from({ length: 25 }, (_, i) => ({
      config: {
        id: `closed-${i}`,
        fpath: `/data/run${i}.nc`,
        indeps: ["x"],
        deps: ["y"],
        plotType: "LinePlot",
      },
      index: 0,
      closedAt: Date.now(),
    }));
    sessionStorage.setItem(
      "qimchi-session-closed-plots",
      JSON.stringify([{ id: "seeded", plots }]),
    );
  });
  await openBothPlots(page);
  await page.setViewportSize({ width: 1200, height: 520 });

  await page.getByRole("button", { name: "Recently closed plots" }).click();
  const list = page.getByRole("menu", { name: "Recently closed plots" });
  await expect(list.getByRole("menuitem")).toHaveCount(25);
  const box = (await list.boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(520);
  expect(box.x).toBeGreaterThanOrEqual(0);

  // The last entry can be scrolled to and reopened.
  const last = list.getByRole("menuitem").last();
  await last.scrollIntoViewIfNeeded();
  await last.click();
  await expect(page.locator("[data-plot-id='closed-24']")).toHaveCount(1);
});

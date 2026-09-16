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
  await page
    .getByText("live-heat", { exact: true })
    .locator("xpath=ancestor::div[@data-level][1]")
    .getByRole("button", { name: "Add to basket" })
    .click();
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
  const widthButtons = page.getByRole("button", { name: "Plot width", exact: true });
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

  await page.getByRole("button", { name: "33% width" }).click();
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
  await cards.nth(1).hover();
  const handle = cards.nth(1).getByRole("button", { name: "Move plot" });
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

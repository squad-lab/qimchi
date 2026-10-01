import type { Locator, Page } from "@playwright/test";

import { expect, test } from "./coverage";
import { mockLiveHeatmapApi, openLiveHeatmap } from "./liveHeatmap";
import { mockSettingsApi } from "./settingsMock";

// Check whether a panel is fully inside the viewport.
const inside = async (page: Page, panel: Locator) => {
  const box = await panel.boundingBox();
  const { width, height } = page.viewportSize()!;
  return (
    !!box && box.x >= 0 && box.y >= 0 && box.x + box.width <= width && box.y + box.height <= height
  );
};

async function openPlot(page: Page, routes?: () => Promise<void>) {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await mockLiveHeatmapApi(page);
  await mockSettingsApi(page);
  await routes?.();
  await openLiveHeatmap(page);
}

const panels: [string, (page: Page) => Promise<Locator>][] = [
  [
    "Appearance",
    async (page) => {
      await page.getByRole("button", { name: "Edit appearance" }).first().click({ force: true });
      return page.locator("[data-tour='appearance-panel']");
    },
  ],
  [
    "Filters",
    async (page) => {
      await page.getByRole("button", { name: "Edit filters" }).first().click({ force: true });
      return page.locator("[data-tour='filters-panel']");
    },
  ],
  [
    "Settings",
    async (page) => {
      await page.keyboard.press("Shift+S");
      return page.getByRole("dialog", { name: "Settings" });
    },
  ],
];

for (const [name, open] of panels) {
  test(`the ${name} panel opens inside a small window`, async ({ page }) => {
    await openPlot(page);
    await page.setViewportSize({ width: 1100, height: 520 });
    const panel = await open(page);
    await expect(panel).toBeVisible();
    await expect.poll(() => inside(page, panel)).toBe(true);
  });

  test(`the ${name} panel stays inside the window when it shrinks`, async ({ page }) => {
    await openPlot(page);
    const panel = await open(page);
    await expect(panel).toBeVisible();
    await page.setViewportSize({ width: 1000, height: 600 });
    await expect.poll(() => inside(page, panel)).toBe(true);
  });
}

test("the pinned parameters card stays inside the window when it shrinks", async ({ page }) => {
  await openPlot(page, async () => {
    await page.route("**/load-meta/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/load-meta/parameters/") {
        await route.fulfill({
          json: { parameters: [{ name: "dmm_v1", label: "Voltmeter", display: "5.076 V" }] },
        });
      } else {
        const snapshot = { dmm_v1: { value: 5.076, unit: "V", label: "Voltmeter" } };
        await route.fulfill({ json: { "Parameters Snapshot": JSON.stringify(snapshot) } });
      }
    });
  });
  await page.getByRole("button", { name: "Metadata" }).click();
  await page.getByText('"dmm_v1"').hover();
  await page.getByRole("button", { name: "Pin dmm_v1" }).click();
  const card = page.getByRole("dialog", { name: "Pinned parameters" });
  await expect(card.getByText("Voltmeter")).toBeVisible();

  // Drag it to the far right of the large window.
  const handle = (await card.locator(".pinned-parameters-handle").boundingBox())!;
  await page.mouse.move(handle.x + 20, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(1500, handle.y + handle.height / 2, { steps: 15 });
  await page.mouse.up();

  await page.setViewportSize({ width: 1000, height: 650 });
  await expect.poll(() => inside(page, card)).toBe(true);
});

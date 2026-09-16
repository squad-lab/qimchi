import type { Page } from "@playwright/test";

import { expect, test } from "./coverage";

const DATASET_COUNT = 52;
const name = (index: number) => `run-${String(index).padStart(2, "0")}.nc`;

async function mockExplorer(page: Page) {
  const attributeRequests: string[] = [];
  await page.route("**/*", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/health") {
      await route.fulfill({ json: { ok: true, dbReady: false, dbError: "disabled in test" } });
    } else if (path === "/load/") {
      await route.fulfill({
        json: Array.from({ length: DATASET_COUNT }, (_, index) => ({
          id: `dataset-${index}`,
          name: name(index),
          path: `C:\\measurements\\${name(index)}`,
          type: "file",
          tags: ["netcdf"],
        })),
      });
    } else if (path === "/load-attrs/") {
      attributeRequests.push(route.request().postDataJSON().path);
      // No variables, so adding a measurement creates no plots.
      await route.fulfill({ json: {} });
    } else {
      await route.fallback();
    }
  });
  return attributeRequests;
}

test("the basket stops at 50 measurements and says why", async ({ page }) => {
  const attributeRequests = await mockExplorer(page);
  await page.goto("/");
  await page.getByPlaceholder("Enter folder path").fill("C:\\measurements");
  await page.getByTitle("Load folder").click();

  await page.getByText(name(0), { exact: true }).click();
  await page.keyboard.press("Control+KeyA");
  await page.getByTitle("Add all selected files to basket").click();

  await expect(
    page.getByText("The basket holds at most 50 measurements. Remove some before adding more."),
  ).toHaveCount(1);
  const basketRows = page.locator("button[aria-label^='Download run-']");
  await expect(basketRows).toHaveCount(50);
  // Refused measurements are not looked up.
  expect(attributeRequests).toHaveLength(50);

  // The basket's ribbon keeps saying so while it is full.
  const fullWarning = page.getByRole("img", { name: /basket holds at most 50/ });
  await expect(fullWarning).toBeVisible();

  await page.getByRole("button", { name: "Clear basket" }).click();
  await expect(basketRows).toHaveCount(0);
  await expect(fullWarning).toHaveCount(0);
});

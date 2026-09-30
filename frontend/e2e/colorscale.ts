import type { Locator, Page } from "@playwright/test";

/** Pick a heat map colour scale from the picker inside \`scope\`. */
export async function chooseColorscale(page: Page, scope: Page | Locator, label: string) {
  await scope.getByRole("button", { name: "Heatmap colorscale" }).click();
  // The list opens in a layer of its own, outside the panel.
  await page.getByRole("option", { name: label, exact: true }).first().click();
}

import type { Page } from "@playwright/test";

import { expect, test } from "./coverage";

const NAMES = ["run-0.nc", "run-1.nc", "run-2.nc", "run-3.nc"];

async function fillBasket(page: Page) {
  await page.route("**/*", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/health") {
      await route.fulfill({ json: { ok: true, dbReady: false, dbError: "disabled in test" } });
    } else if (path === "/load/") {
      await route.fulfill({
        json: NAMES.map((name) => ({
          id: name,
          name,
          path: `C:\\measurements\\${name}`,
          type: "file",
          tags: ["netcdf"],
        })),
      });
    } else if (path === "/load-attrs/") {
      // Empty attributes prevent automatic plots.
      await route.fulfill({ json: {} });
    } else {
      await route.fallback();
    }
  });
  await page.goto("/");
  await page.getByPlaceholder("Enter folder path").fill("C:\\measurements");
  await page.getByTitle("Load folder").click();
  await page.getByText(NAMES[0], { exact: true }).click();
  await page.keyboard.press("Control+KeyA");
  await page.getByRole("button", { name: "Add all selected files to basket" }).click();
  await expect(page.getByRole("option")).toHaveCount(NAMES.length);
}

const card = (page: Page, name: string) =>
  page.getByRole("option").filter({ has: page.getByText(name, { exact: true }) });

// Return selected names in fixture order.
const selectedNames = async (page: Page) => {
  const options = page.getByRole("option");
  const names: string[] = [];
  for (const name of NAMES) {
    const option = options.filter({ has: page.getByText(name, { exact: true }) });
    if ((await option.count()) && (await option.getAttribute("aria-selected")) === "true") {
      names.push(name);
    }
  }
  return names;
};

test("the Basket always keeps a measurement selected", async ({ page }) => {
  await fillBasket(page);

  // Adding more items preserves the initial selection.
  expect(await selectedNames(page)).toEqual([NAMES[0]]);
  await expect(page.getByText(`Selected: ${NAMES[0]}`)).toBeVisible();
  await expect(page.getByRole("checkbox", { name: `Select ${NAMES[0]}` })).toBeChecked();

  // A nonempty Basket keeps one item selected.
  await page.getByRole("checkbox", { name: `Select ${NAMES[0]}` }).click();
  await card(page, NAMES[0])
    .getByText(NAMES[0], { exact: true })
    .click({ modifiers: ["Control"] });
  expect(await selectedNames(page)).toEqual([NAMES[0]]);

  // Removal selects the nearest item and persists that choice.
  await card(page, NAMES[2]).getByText(NAMES[2], { exact: true }).click();
  await card(page, NAMES[2]).getByTitle("Remove").click();
  expect(await selectedNames(page)).toEqual([NAMES[1]]);
  await page.reload();
  await expect(page.getByRole("option")).toHaveCount(NAMES.length - 1);
  expect(await selectedNames(page)).toEqual([NAMES[1]]);
});

test("Basket measurements are selected with the mouse like files", async ({ page }) => {
  await fillBasket(page);
  // Basket order is newest first.
  await card(page, NAMES[3]).getByText(NAMES[3], { exact: true }).click();
  await card(page, NAMES[1])
    .getByText(NAMES[1], { exact: true })
    .click({ modifiers: ["Shift"] });
  expect(await selectedNames(page)).toEqual([NAMES[1], NAMES[2], NAMES[3]]);

  await page.getByRole("checkbox", { name: `Select ${NAMES[2]}` }).click();
  expect(await selectedNames(page)).toEqual([NAMES[1], NAMES[3]]);

  await card(page, NAMES[0])
    .getByText(NAMES[0], { exact: true })
    .click({ modifiers: ["Control"] });
  expect(await selectedNames(page)).toEqual([NAMES[0], NAMES[1], NAMES[3]]);
  await expect(page.getByText("Selected: 3 datasets")).toBeVisible();
});

test("Basket measurements are selected with the keyboard while the Basket has focus", async ({
  page,
}) => {
  await fillBasket(page);
  await card(page, NAMES[3]).getByText(NAMES[3], { exact: true }).click();

  await page.keyboard.press("ArrowRight");
  expect(await selectedNames(page)).toEqual([NAMES[2]]);
  await page.keyboard.press("Shift+ArrowRight");
  await page.keyboard.press("Shift+ArrowRight");
  expect(await selectedNames(page)).toEqual([NAMES[0], NAMES[1], NAMES[2]]);

  await page.keyboard.press("Control+ArrowLeft");
  await page.keyboard.press("Space");
  expect(await selectedNames(page)).toEqual([NAMES[0], NAMES[2]]);

  await page.keyboard.press("Home");
  expect(await selectedNames(page)).toEqual([NAMES[3]]);
  await page.keyboard.press("Control+KeyA");
  expect(await selectedNames(page)).toEqual(NAMES);

  // Shortcuts are inactive outside the Basket.
  await page.locator("body").focus();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press("ArrowRight");
  expect(await selectedNames(page)).toEqual(NAMES);
});

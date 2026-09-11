import type { Page } from "@playwright/test";

import { expect, test } from "./coverage";

const datasets = [
  {
    id: "dataset-run",
    name: "run.nc",
    path: "C:\\measurements\\run.nc",
    type: "file",
    tags: ["netcdf"],
  },
];

async function mockShellApi(page: Page, metadata: unknown) {
  await page.route("**/*", async (route) => {
    const path = new URL(route.request().url()).pathname;

    if (path === "/health") {
      await route.fulfill({ json: { ok: true, dbReady: false, dbError: "disabled in test" } });
    } else if (path === "/load/") {
      await route.fulfill({ json: datasets });
    } else if (path === "/load-attrs/") {
      await route.fulfill({
        json: {
          "Sample Name": "sample-a",
          independents: ["gate"],
          dependents: ["signal"],
        },
      });
    } else if (path === "/load-meta/") {
      await route.fulfill({ json: metadata });
    } else if (path === "/load-notes/") {
      await route.fulfill({ json: { notes: "", last_saved: null } });
    } else {
      await route.fallback();
    }
  });
}

const rootFontSize = (page: Page) => page.evaluate(() => document.documentElement.style.fontSize);

test.describe("sidebar rail", () => {
  test.beforeEach(async ({ page }) => {
    await mockShellApi(page, { general: { operator: "Alice" } });
    await page.goto("/");
  });

  test("Alt+1 to Alt+4 open each pane", async ({ page }) => {
    for (const [key, label] of [
      ["Alt+2", "Metadata"],
      ["Alt+3", "Notes"],
      ["Alt+4", "Live Measurements"],
      ["Alt+1", "Explorer"],
    ] as const) {
      await page.keyboard.press(key);
      await expect(page.getByRole("button", { name: label, exact: true })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    }
  });

  test("the shortcut for the open pane leaves it open", async ({ page }) => {
    // Unlike clicking the rail, the shortcut never collapses -- otherwise the
    // pane would vanish under a key you pressed to reach it.
    await page.keyboard.press("Alt+1");
    await page.keyboard.press("Alt+1");

    await expect(page.getByRole("button", { name: "Explorer", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("zooms the app and resets to 100%", async ({ page }) => {
    expect(await rootFontSize(page)).toBe("16px");

    await page.getByRole("button", { name: "Zoom in" }).click();
    const zoomed = await rootFontSize(page);
    expect(parseFloat(zoomed)).toBeGreaterThan(16);

    await page.getByRole("button", { name: /^Zoom .* reset/ }).click();
    expect(await rootFontSize(page)).toBe("16px");
  });

  test("keeps the zoom across a reload", async ({ page }) => {
    await page.getByRole("button", { name: "Zoom out" }).click();
    const zoomed = await rootFontSize(page);

    await page.reload({ waitUntil: "domcontentloaded" });

    expect(await rootFontSize(page)).toBe(zoomed);
  });
});

test.describe("Basket and Composer", () => {
  test.beforeEach(async ({ page }) => {
    await mockShellApi(page, { general: { operator: "Alice" } });
    await page.goto("/");
  });

  test("Alt+B and Alt+C collapse and restore them", async ({ page }) => {
    await page.keyboard.press("Alt+B");
    await expect(page.getByRole("button", { name: "Expand basket" })).toBeVisible();
    await page.keyboard.press("Alt+B");
    await expect(page.getByRole("button", { name: "Collapse basket" })).toBeVisible();

    await page.keyboard.press("Alt+C");
    await expect(page.getByRole("button", { name: "Expand composer" })).toBeVisible();
    await page.keyboard.press("Alt+C");
    await expect(page.getByRole("button", { name: "Collapse composer" })).toBeVisible();
  });

  test("keeps the collapse across a reload", async ({ page }) => {
    await page.keyboard.press("Alt+B");
    await expect(page.getByRole("button", { name: "Expand basket" })).toBeVisible();

    await page.reload({ waitUntil: "domcontentloaded" });

    await expect(page.getByRole("button", { name: "Expand basket" })).toBeVisible();
  });
});

test.describe("full-window Explorer", () => {
  test.beforeEach(async ({ page }) => {
    await mockShellApi(page, { general: { operator: "Alice" } });
    await page.goto("/");
  });

  test("Shift+F expands it and Esc returns", async ({ page }) => {
    await page.keyboard.press("Shift+F");
    await expect(page.getByRole("button", { name: "Exit full window" })).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Expand to full window" })).toBeVisible();
  });
});

test.describe("help search", () => {
  test.beforeEach(async ({ page }) => {
    await mockShellApi(page, { general: { operator: "Alice" } });
    await page.goto("/");
  });

  test("searches the documentation and jumps to a result", async ({ page }) => {
    await page.keyboard.press("Shift+H");
    const search = page.getByPlaceholder("Search help...");
    await expect(search).toBeVisible();

    await search.fill("dark");
    await expect(page.getByText(/result(s)? --/)).toBeVisible();

    // Opening a result returns to the section view, scrolled to the match.
    // Scoped to the results: "dark" also names the rail's theme toggle.
    await page
      .getByRole("group", { name: "Help search results" })
      .getByRole("button")
      .first()
      .click();
    await expect(search).toHaveValue("");
  });

  test("reports when nothing matches", async ({ page }) => {
    await page.keyboard.press("Shift+H");
    await page.getByPlaceholder("Search help...").fill("zzzzzzzz");

    await expect(page.getByText(/No help matches/)).toBeVisible();
  });
});

test.describe("oversized metadata", () => {
  test("reports a withheld section in place instead of rendering it", async ({ page }) => {
    await mockShellApi(page, {
      Sweeps: { gate: [0, 1] },
      snapshot: {
        __qimchi_metadata_too_large__: true,
        nodeCount: 7236,
        nodeLimit: 100,
      },
    });
    await page.goto("/");

    await page.getByPlaceholder("Enter folder path").fill("C:\\measurements");
    await page.getByTitle("Load folder").click();
    const row = page
      .getByText("run.nc", { exact: true })
      .locator("xpath=ancestor::div[@data-level][1]");
    await row.getByRole("button", { name: "Add to basket" }).click();

    await page.keyboard.press("Alt+2");

    // The small section still renders; only the oversized one is withheld.
    await expect(page.getByText("Sweeps:", { exact: true })).toBeVisible();
    await expect(page.getByText("snapshot:", { exact: true })).toBeVisible();
    await expect(page.getByText(/7,236/)).toBeVisible();
  });
});

import type { Page } from "@playwright/test";

import { expect, test } from "./coverage";

// DirTree's library features -- hearts, trash, tags and the filters built on
// them -- plus the banner shown when the library database is unavailable.
// A local mock: this spec needs the /library/* endpoints the others do not.
const datasets = [
  {
    id: "run-1",
    name: "1-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.zarr",
    path: "C:\\measurements\\1-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.zarr",
    type: "file",
    tags: ["zarr"],
  },
  {
    id: "run-2",
    name: "2-ffffffff-bbbb-cccc-dddd-eeeeeeeeeeee.zarr",
    path: "C:\\measurements\\2-ffffffff-bbbb-cccc-dddd-eeeeeeeeeeee.zarr",
    type: "file",
    tags: ["zarr"],
  },
];

interface LibraryOptions {
  dbReady?: boolean;
  dbError?: string | null;
}

async function mockLibraryApi(page: Page, options: LibraryOptions = {}) {
  const { dbReady = true, dbError = null } = options;

  // One tag exists, and the first measurement is hearted and carries it.
  const tags = [{ id: 1, name: "cold" }];
  const states = [
    {
      uuid: "u1",
      abs_path: "C:\\measurements\\1-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.zarr",
      hearted: true,
      trashed: false,
      tags: [1],
    },
    {
      uuid: "u2",
      abs_path: "C:\\measurements\\2-ffffffff-bbbb-cccc-dddd-eeeeeeeeeeee.zarr",
      hearted: false,
      trashed: false,
      tags: [],
    },
  ];

  await page.route("**/*", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;

    if (path === "/health") {
      await route.fulfill({ json: { ok: true, dbReady, dbError } });
    } else if (path === "/load/") {
      await route.fulfill({ json: datasets });
    } else if (path === "/library/states") {
      await route.fulfill({ json: dbReady ? states : [], status: dbReady ? 200 : 503 });
    } else if (path === "/library/tags") {
      if (request.method() === "POST") {
        const created = { id: 2, name: request.postDataJSON().name };
        tags.push(created);
        await route.fulfill({ json: created });
      } else {
        await route.fulfill({ json: dbReady ? tags : [], status: dbReady ? 200 : 503 });
      }
    } else if (path.startsWith("/library/")) {
      await route.fulfill({ json: {} });
    } else if (path === "/load-attrs/") {
      await route.fulfill({ json: { independents: ["gate"], dependents: ["signal"] } });
    } else {
      await route.fallback();
    }
  });
}

async function loadExplorer(page: Page) {
  await page.getByPlaceholder("Enter folder path").fill("C:\\measurements");
  await page.getByTitle("Load folder").click();
  await expect(page.getByText(/1-aaaaaaaa/)).toBeVisible();
}

const openFilters = (page: Page) => page.getByTitle("Toggle filters").click();

test.describe("library filters", () => {
  test.beforeEach(async ({ page }) => {
    await mockLibraryApi(page);
    await page.goto("/");
    await loadExplorer(page);
  });

  test("Hearted narrows the tree to hearted measurements", async ({ page }) => {
    await openFilters(page);
    await page.getByRole("button", { name: "Hearted" }).click();

    await expect(page.getByText(/1-aaaaaaaa/)).toBeVisible();
    await expect(page.getByText(/2-ffffffff/)).toHaveCount(0);
  });

  test("the tag dropdown filters by tag", async ({ page }) => {
    await openFilters(page);
    await page.getByRole("button", { name: /^Tags/ }).click();
    await page.getByRole("dialog").getByRole("button", { name: "#cold" }).click();

    // Only the measurement carrying the tag survives.
    await expect(page.getByText(/1-aaaaaaaa/)).toBeVisible();
    await expect(page.getByText(/2-ffffffff/)).toHaveCount(0);
  });

  test("#tag in the search box filters the same way", async ({ page }) => {
    await page.getByPlaceholder("Search files and folders...").fill("#cold");

    await expect(page.getByText(/1-aaaaaaaa/)).toBeVisible();
    await expect(page.getByText(/2-ffffffff/)).toHaveCount(0);
  });

  test("an unknown #tag matches nothing rather than everything", async ({ page }) => {
    await page.getByPlaceholder("Search files and folders...").fill("#nosuchtag");

    await expect(page.getByText(/1-aaaaaaaa/)).toHaveCount(0);
    await expect(page.getByText(/2-ffffffff/)).toHaveCount(0);
  });
});

test.describe("bulk library actions", () => {
  test.beforeEach(async ({ page }) => {
    await mockLibraryApi(page);
    await page.goto("/");
    await loadExplorer(page);
  });

  test("stay disabled until datasets are selected", async ({ page }) => {
    // Nothing selected: the buttons say why rather than silently doing nothing.
    const heart = page.getByTitle("Select datasets first").first();
    await expect(heart).toBeDisabled();
  });

  test("apply to the whole selection at once", async ({ page }) => {
    const requests: string[] = [];
    page.on("request", (request) => {
      const path = new URL(request.url()).pathname;
      if (path.startsWith("/library/")) requests.push(`${request.method()} ${path}`);
    });

    await page.getByText(/1-aaaaaaaa/).click();
    await page.getByText(/2-ffffffff/).click({ modifiers: ["Control"] });

    await page.getByTitle(/^Heart \/ unheart/).click();

    // Both selections are sent, in one action -- not one row at a time.
    await expect
      .poll(() => requests.filter((entry) => entry.includes("/library/heart")).length)
      .toBeGreaterThanOrEqual(2);
  });
});

test.describe("library unavailable", () => {
  test("says so, and disables what cannot be saved", async ({ page }) => {
    await mockLibraryApi(page, { dbReady: false, dbError: "no such table: measurements" });
    await page.goto("/");
    await loadExplorer(page);

    // The banner must state the consequence, not just the fault.
    const banner = page.getByRole("status").filter({ hasText: "Library unavailable" });
    await expect(banner).toBeVisible();
    await expect(banner).toContainText("Plotting still works");
    await expect(banner).toContainText("no such table: measurements");

    await openFilters(page);
    await expect(page.getByRole("button", { name: "Hearted" })).toBeDisabled();
  });
});

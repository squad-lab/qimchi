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

const openFilters = (page: Page) => page.getByRole("button", { name: "Toggle filters" }).click();

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
    await page.getByRole("button", { name: "Tagged" }).click();
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
    const heart = page.getByRole("button", { name: "Select datasets or folders first" }).first();
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

    await page.getByRole("button", { name: /^Heart \/ unheart/ }).click();

    // Both selections are sent, in one action -- not one row at a time.
    await expect
      .poll(() => requests.filter((entry) => entry.includes("/library/heart")).length)
      .toBeGreaterThanOrEqual(2);
  });

  test("remain actionable in the full-window Explorer", async ({ page }) => {
    const requests: string[] = [];
    page.on("request", (request) => {
      const path = new URL(request.url()).pathname;
      if (path.startsWith("/library/")) requests.push(`${request.method()} ${path}`);
    });

    await page.getByRole("button", { name: "Expand to full window" }).click();
    await expect(page.getByRole("button", { name: "Exit full window" })).toBeVisible();

    await page.getByText(/1-aaaaaaaa/).click();
    await page.getByText(/2-ffffffff/).click({ modifiers: ["Control"] });

    await page.getByRole("button", { name: /^Heart \/ unheart/ }).click();
    await expect
      .poll(() => requests.filter((entry) => entry.includes("/library/heart")).length)
      .toBeGreaterThanOrEqual(2);

    await page.getByRole("button", { name: /^Trash \/ restore/ }).click();
    await expect
      .poll(() => requests.filter((entry) => entry.includes("/library/trash")).length)
      .toBeGreaterThanOrEqual(2);

    await page.getByRole("button", { name: /^Tag 2 datasets/ }).click();
    const tagDialog = page.getByRole("dialog", { name: "Tags" });
    await expect(tagDialog).toBeVisible();
    await expect(tagDialog).toHaveCSS("z-index", "1600");
  });

  test("the create-tag button stays transparent in dark mode", async ({ page }) => {
    await page.evaluate(() => document.documentElement.classList.add("dark"));
    await page.getByText(/1-aaaaaaaa/).click();
    await page.getByRole("button", { name: /^Tag 1 dataset/ }).click();

    const create = page.getByRole("button", { name: "Create and apply tag" });
    await expect(create).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
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

test.describe("folders", () => {
  const FOLDER = "C:\\measurements\\cooldown";
  const inside = {
    id: "run-3",
    name: "3-99999999-bbbb-cccc-dddd-eeeeeeeeeeee.zarr",
    path: `${FOLDER}\\3-99999999-bbbb-cccc-dddd-eeeeeeeeeeee.zarr`,
    type: "file",
    tags: ["zarr"],
  };
  const tree = [
    { id: "cooldown", name: "cooldown", path: FOLDER, type: "folder", children: [inside] },
    ...datasets,
  ];

  async function mockFolderLibrary(
    page: Page,
    folderState: Record<string, unknown> | null,
    childStates: Record<string, unknown>[] = [],
  ) {
    const requests: { path: string; body: Record<string, unknown> | null }[] = [];
    await page.route("**/*", async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (path.startsWith("/library/")) {
        requests.push({ path, body: request.method() === "POST" ? request.postDataJSON() : null });
      }
      if (path === "/health") {
        await route.fulfill({ json: { ok: true, dbReady: true, dbError: null } });
      } else if (path === "/load/") {
        await route.fulfill({ json: tree });
      } else if (path === "/library/states") {
        await route.fulfill({
          json: [
            ...(folderState ? [{ uuid: "f1", abs_path: FOLDER, tags: [], ...folderState }] : []),
            ...childStates,
          ],
        });
      } else if (path === "/library/tags") {
        await route.fulfill({ json: [] });
      } else if (path === "/library/register") {
        await route.fulfill({ json: { uuid: "f1", hearted: false, trashed: false } });
      } else if (path.startsWith("/library/")) {
        await route.fulfill({ json: {} });
      } else {
        await route.fallback();
      }
    });
    return requests;
  }

  const folderRow = (page: Page) =>
    page.locator("[data-level]").filter({ has: page.getByText("cooldown", { exact: true }) });

  test("a folder can be hearted from its row", async ({ page }) => {
    const requests = await mockFolderLibrary(page, null);
    await page.goto("/");
    await loadExplorer(page);

    const row = folderRow(page);
    await row.hover();
    await row.getByRole("button", { name: "Heart" }).click();

    await expect
      .poll(() => requests.find((entry) => entry.path === "/library/register")?.body)
      .toMatchObject({ path: FOLDER, folder: true });
    await expect.poll(() => requests.some((entry) => entry.path === "/library/heart")).toBe(true);
  });

  test("Hearted shows a hearted folder with everything in it", async ({ page }) => {
    await mockFolderLibrary(page, { hearted: true, trashed: false });
    await page.goto("/");
    await loadExplorer(page);

    await openFilters(page);
    await page.getByRole("button", { name: "Hearted" }).click();
    await folderRow(page).getByRole("button", { name: "Expand folder" }).click();

    await expect(page.getByText(/3-99999999/)).toBeVisible();
    await expect(
      page
        .locator("[data-level]")
        .filter({ has: page.getByText(/3-99999999/) })
        .getByRole("button", { name: "Heart inherited from parent folder" }),
    ).toBeDisabled();
    await expect(page.getByText(/2-ffffffff/)).toHaveCount(0);
  });

  test("what is inside a trashed folder shows as trashed", async ({ page }) => {
    await mockFolderLibrary(page, { hearted: false, trashed: true }, [
      { uuid: "u3", abs_path: inside.path, tags: [], hearted: true, trashed: false },
    ]);
    await page.goto("/");
    await loadExplorer(page);

    // The folder can still be opened, and restored from its own row.
    await folderRow(page).getByRole("button", { name: "Expand folder" }).click();
    const child = page.locator("[data-level]").filter({ has: page.getByText(/3-99999999/) });
    await expect(child).toHaveClass(/qimchi-trashed/);
    await expect(child).toHaveAttribute("draggable", "false");
    await expect(child.getByRole("button", { name: "Restore before hearting" })).toBeDisabled();
    await expect(child.locator(".group\\/heart > svg")).not.toHaveClass(/fill-red-500/);

    await child.getByText(/3-99999999/).dblclick({ force: true });
    await expect(page.locator('[data-tour="basket"]').getByText(/3-99999999/)).toHaveCount(0);

    await page.evaluate((item) => {
      const dataTransfer = new DataTransfer();
      dataTransfer.setData("application/json", JSON.stringify(item));
      document
        .querySelector('[data-tour="basket"] > div > div')
        ?.dispatchEvent(new DragEvent("drop", { bubbles: true, dataTransfer }));
    }, inside);
    await expect(page.locator('[data-tour="basket"]').getByText(/3-99999999/)).toHaveCount(0);
    await expect(folderRow(page).getByRole("button", { name: "Restore from trash" })).toBeVisible();
  });
});

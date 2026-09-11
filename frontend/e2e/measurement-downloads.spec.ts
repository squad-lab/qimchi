import type { Page, Request } from "@playwright/test";

import { expect, test } from "./coverage";

const nodes = [
  {
    id: "dataset-run",
    name: "run.nc",
    path: "C:\\measurements\\run.nc",
    type: "file",
    tags: ["netcdf"],
  },
  {
    id: "dataset-sweep",
    name: "sweep.zarr",
    path: "C:\\measurements\\sweep.zarr",
    type: "file",
    tags: ["zarr"],
  },
  {
    id: "sample-folder",
    name: "sample-a",
    path: "C:\\measurements\\sample-a",
    type: "folder",
    children: [],
  },
];

const zipBody = Buffer.from("PK\u0003\u0004playwright-download-fixture");

async function openExplorer(page: Page) {
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/health") {
      await route.fulfill({ json: { ok: true, dbReady: false, dbError: null } });
    } else if (url.pathname === "/load/") {
      await route.fulfill({ json: nodes });
    } else if (url.pathname === "/load-attrs/") {
      await route.fulfill({
        json: { measurement_id: "test", independents: [], dependents: [] },
      });
    } else {
      await route.fallback();
    }
  });

  await page.goto("/");
  await page.getByPlaceholder("Enter folder path").fill("C:\\measurements");
  await page.getByTitle("Load folder").click();
  await expect(page.getByText("run.nc", { exact: true })).toBeVisible();
  await expect(page.getByText("sample-a", { exact: true })).toBeVisible();
}

async function expectPostDownload(page: Page, endpoint: string, click: () => Promise<void>) {
  let capturedRequest: Request | undefined;
  await page.route(`**${endpoint}`, async (route) => {
    capturedRequest = route.request();
    await route.fulfill({
      status: 200,
      contentType: "application/zip",
      body: zipBody,
    });
  });

  const downloadPromise = page.waitForEvent("download");
  await click();
  const browserDownload = await downloadPromise;
  expect(capturedRequest?.method()).toBe("POST");
  return { browserDownload, request: capturedRequest! };
}

test.beforeEach(async ({ page }) => {
  await openExplorer(page);
});

test("downloads one measurement from Explorer", async ({ page }) => {
  const { browserDownload, request } = await expectPostDownload(page, "/download/", () =>
    page.getByRole("button", { name: "Download dataset" }).first().click(),
  );

  expect(request.postDataJSON()).toEqual({ path: "C:\\measurements\\run.nc" });
  expect(browserDownload.suggestedFilename()).toBe("run.nc.zip");
});

test("downloads a folder from Explorer", async ({ page }) => {
  const { browserDownload, request } = await expectPostDownload(page, "/download-folder/", () =>
    page.getByRole("button", { name: "Download folder: sample-a" }).click(),
  );

  expect(request.postDataJSON()).toEqual({ path: "C:\\measurements\\sample-a" });
  expect(browserDownload.suggestedFilename()).toBe("sample-a.zip");
});

test("downloads the Explorer multi-selection", async ({ page }) => {
  await page.getByText("run.nc", { exact: true }).click();
  await page.getByText("sweep.zarr", { exact: true }).click({ modifiers: ["Control"] });

  const { browserDownload, request } = await expectPostDownload(page, "/download-multiple/", () =>
    page.getByTitle("Download all selected items as ZIP").click(),
  );

  expect(request.postDataJSON()).toEqual({
    paths: ["C:\\measurements\\run.nc", "C:\\measurements\\sweep.zarr"],
  });
  expect(browserDownload.suggestedFilename()).toMatch(/^selected_items_\d{4}-\d{2}-\d{2}\.zip$/);
});

test("downloads one measurement from its Basket action", async ({ page }) => {
  await page.getByRole("button", { name: "Add to basket" }).first().click();
  await expect(page.getByRole("button", { name: "Download run.nc" })).toBeVisible();

  const { browserDownload, request } = await expectPostDownload(page, "/download-multiple/", () =>
    page.getByRole("button", { name: "Download run.nc" }).click(),
  );

  expect(request.postDataJSON()).toEqual({ paths: ["C:\\measurements\\run.nc"] });
  expect(browserDownload.suggestedFilename()).toBe("run.nc.zip");
});

test("downloads every measurement in the Basket", async ({ page }) => {
  await page.getByRole("button", { name: "Add to basket" }).nth(0).click();
  await page.getByRole("button", { name: "Add to basket" }).nth(0).click();
  await expect(page.getByTitle("Remove")).toHaveCount(2);

  const { browserDownload, request } = await expectPostDownload(page, "/download-selected/", () =>
    page.getByRole("button", { name: "Download basket" }).click(),
  );

  expect(request.postDataJSON()).toEqual([
    { path: "C:\\measurements\\sweep.zarr" },
    { path: "C:\\measurements\\run.nc" },
  ]);
  expect(browserDownload.suggestedFilename()).toBe("selected_datasets_2_files.zip");
});

test("desktop downloads use the backend-saved path instead of a blob link", async ({ page }) => {
  await page.addInitScript(() => {
    const original = URL.createObjectURL.bind(URL);
    Object.defineProperty(window, "__createdDownloadUrls", { value: 0, writable: true });
    URL.createObjectURL = (...args) => {
      (window as typeof window & { __createdDownloadUrls: number }).__createdDownloadUrls += 1;
      return original(...args);
    };
  });
  await page.reload();
  await page.getByPlaceholder("Enter folder path").fill("C:\\measurements");
  await page.getByTitle("Load folder").click();

  await page.route("**/download/", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/zip",
      headers: {
        "X-Qimchi-Saved-To": encodeURIComponent("C:\\Users\\tester\\Downloads\\run.zip"),
      },
      body: zipBody,
    });
  });

  const urlsBeforeDownload = await page.evaluate(
    () => (window as typeof window & { __createdDownloadUrls: number }).__createdDownloadUrls,
  );
  await page.getByRole("button", { name: "Download dataset" }).first().click();
  await expect(page.getByText("Saved to C:\\Users\\tester\\Downloads\\run.zip")).toBeVisible();
  expect(
    await page.evaluate(
      () => (window as typeof window & { __createdDownloadUrls: number }).__createdDownloadUrls,
    ),
  ).toBe(urlsBeforeDownload);
});

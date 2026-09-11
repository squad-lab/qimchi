import type { Page, Request } from "@playwright/test";

import { expect, test } from "./coverage";

const datasets = [
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
    id: "dataset-qanary-zarr",
    name: "1-40d7d11d-cbd9-48f4-9921-1ae6ac3a67fa.zarr",
    path: "C:\\measurements\\1-40d7d11d-cbd9-48f4-9921-1ae6ac3a67fa.zarr",
    type: "file",
    tags: ["zarr"],
  },
  {
    id: "dataset-qanary-nc",
    name: "2-acde1234-5678-4abc-9def-0123456789ab.nc",
    path: "C:\\measurements\\2-acde1234-5678-4abc-9def-0123456789ab.nc",
    type: "file",
    tags: ["netcdf"],
  },
  {
    id: "dataset-qcodes-run",
    name: "7 | transport",
    path: "C:\\measurements\\runs.db#run_id=7",
    type: "file",
    tags: ["qcodes", "qcodes-run", "sqlite"],
  },
  {
    id: "sample-folder",
    name: "sample-a",
    path: "C:\\measurements\\sample-a",
    type: "folder",
    children: [],
  },
];

interface ApiState {
  loadRequests: Request[];
  plotRequests: Request[];
  exportRequests: Request[];
  saveNotesRequests: Request[];
}

async function mockApplicationApi(page: Page): Promise<ApiState> {
  const state: ApiState = {
    loadRequests: [],
    plotRequests: [],
    exportRequests: [],
    saveNotesRequests: [],
  };
  let plotId = 0;

  await page.route("**/*", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;

    if (path === "/health") {
      await route.fulfill({ json: { ok: true, dbReady: false, dbError: "disabled in test" } });
    } else if (path === "/load/") {
      state.loadRequests.push(request);
      await route.fulfill({ json: datasets });
    } else if (path === "/load-attrs/") {
      const requestPath = request.postDataJSON()?.path as string;
      if (requestPath?.includes("#run_id=7")) {
        await route.fulfill({
          json: {
            ds_name: "transport",
            exp_name: "device test",
            guid: "qcodes-guid-7",
            run_id: 7,
            run_timestamp: "2026-09-11 10:00:00+0000",
            sample_name: "sample-a",
            independents: ["gate"],
            dependents: ["signal"],
          },
        });
        return;
      }
      await route.fulfill({
        json: {
          Timestamp: "2025-04-09T19:25:34.311282",
          Cryostat: "017",
          "Wafer ID": "00602_A3",
          "Device Type": "Quantum Dot",
          "Sample Name": "sample-a",
          "Experiment Name": "Single gate sweep",
          "Measurement ID": "1-40d7d11d-cbd9-48f4-9921-1ae6ac3a67fa",
          independents: ["gate", "bias"],
          dependents: ["signal"],
        },
      });
    } else if (path === "/load-meta/") {
      await route.fulfill({
        json: { general: { operator: "Alice", temperature: "20 mK" } },
      });
    } else if (path === "/load-notes/") {
      await route.fulfill({
        json: { notes: "Initial measurement note", last_saved: "2026-09-09T09:00:00Z" },
      });
    } else if (path === "/save-notes/") {
      state.saveNotesRequests.push(request);
      await route.fulfill({ json: { success: true, last_saved: "2026-09-09T10:00:00Z" } });
    } else if (path === "/export-plot-images") {
      state.exportRequests.push(request);
      await route.fulfill({ status: 202, json: { task_id: "export-task" } });
    } else if (path === "/export-plot-images/status/export-task") {
      await route.fulfill({
        json: { status: "completed", saved_to: "C:\\exports\\plot_images.zip" },
      });
    } else if (path === "/plot/") {
      state.plotRequests.push(request);
      const body = request.postDataJSON();
      const heatmap = body.plotType === "HeatMap";
      plotId += 1;
      await route.fulfill({
        json: {
          success: true,
          message: "created",
          plots: [
            {
              id: `plot-${plotId}`,
              plot_ref: `plot-ref-${plotId}`,
              type: body.plotType,
              is_live: false,
              plotJson: {
                data: heatmap
                  ? [
                      {
                        type: "heatmap",
                        x: [0, 1],
                        y: [0, 1],
                        z: [
                          [1, 2],
                          [3, 4],
                        ],
                      },
                    ]
                  : [{ type: "scatter", mode: "lines", x: [0, 1], y: [1, 2] }],
                layout: {
                  title: { text: body.plotType },
                  xaxis: { title: { text: "$\\mathrm{Gate}\\;\\left(\\mathrm{V}\\right)$" } },
                  yaxis: { title: { text: "$\\mathrm{Current}\\;\\left(\\mathrm{A}\\right)$" } },
                },
              },
            },
          ],
        },
      });
    } else {
      await route.fallback();
    }
  });

  return state;
}

async function loadExplorer(page: Page) {
  await page.getByPlaceholder("Enter folder path").fill("C:\\measurements");
  await page.getByTitle("Load folder").click();
  await expect(page.getByText("run.nc", { exact: true })).toBeVisible();
}

async function addDatasetToBasket(page: Page, displayedName: string) {
  const datasetRow = page
    .getByText(displayedName, { exact: true })
    .locator("xpath=ancestor::div[@data-level][1]");
  await datasetRow.getByRole("button", { name: "Add to basket" }).click();
}

test.beforeEach(async ({ page }) => {
  await mockApplicationApi(page);
  await page.goto("/");
});

test("loads the major application panels", async ({ page }) => {
  await expect(page.getByRole("button", { name: "Explorer" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByRole("button", { name: "Clear basket" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Plot type: LinePlot" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Clear All Plots" })).toBeVisible();
  await expect(page.locator(".js-plotly-plot")).toHaveCount(0);
  await expect(page.getByRole("status", { name: /connected/i })).toBeVisible();
});

test("switches theme and restores it after reload", async ({ page }) => {
  await page.getByRole("button", { name: "Switch to dark theme" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(page.getByRole("button", { name: "Switch to light theme" })).toBeVisible();
});

test("loads, searches, refreshes and navigates the Explorer", async ({ page }) => {
  const state = await mockApplicationApi(page);
  await loadExplorer(page);

  await expect(page.getByText("1-40d7d11d*.zarr", { exact: true })).toBeVisible();
  await expect(page.getByText("2-acde1234*.nc", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Copy filename: 1-40d7d11d-cbd9-48f4-9921-1ae6ac3a67fa.zarr",
    }),
  ).toBeVisible();

  await page.getByPlaceholder("Search files and folders...").fill("sweep");
  await expect(page.getByText("sweep.zarr", { exact: true })).toBeVisible();
  await expect(page.getByText("run.nc", { exact: true })).toBeHidden();
  await page.getByTitle("Clear search").click();
  await expect(page.getByText("run.nc", { exact: true })).toBeVisible();

  await page.getByTitle("Refresh directory").click();
  await expect.poll(() => state.loadRequests.length).toBeGreaterThanOrEqual(2);

  await page.getByText("sample-a", { exact: true }).dblclick();
  await expect(page.getByPlaceholder("Enter folder path")).toHaveValue(
    "C:\\measurements\\sample-a",
  );
});

test("adds a measurement, creates default plots and clears the workspace", async ({ page }) => {
  const state = await mockApplicationApi(page);
  await loadExplorer(page);

  await addDatasetToBasket(page, "run.nc");
  await expect(page.getByRole("button", { name: "Clear basket" })).toBeEnabled();
  await expect(page.locator(".js-plotly-plot")).toHaveCount(2);
  await expect.poll(() => state.plotRequests.length).toBe(2);

  const statusBadge = page.getByRole("status", { name: "Status: Completed" }).first();
  const statusLabel = statusBadge.locator(".plot-status-label");
  await expect(statusBadge).toBeVisible();
  await expect(statusLabel).toHaveCSS("max-width", "0px");
  await statusBadge.hover();
  await expect(statusLabel).toHaveCSS("max-width", "96px");
  await expect(statusLabel).toHaveCSS("opacity", "1");

  expect(state.plotRequests.map((request) => request.postDataJSON().plotType).sort()).toEqual([
    "HeatMap",
    "LinePlot",
  ]);

  await page.getByTitle("Export images").first().click();
  await expect.poll(() => state.exportRequests.length).toBe(1);
  expect(state.exportRequests[0].postDataJSON().measurement_info).toMatchObject({
    Timestamp: "2025-04-09T19:25:34.311282",
    "Experiment Name": "Single gate sweep",
    "Measurement ID": "1-40d7d11d-cbd9-48f4-9921-1ae6ac3a67fa",
  });

  await page.getByRole("button", { name: "Clear All Plots" }).click();
  await expect(page.locator(".js-plotly-plot")).toHaveCount(0);
  await page.getByRole("button", { name: "Clear basket" }).click();
  await expect(page.getByRole("button", { name: "Clear basket" })).toBeDisabled();
});

test("edits MathJax X and Y axis titles inline", async ({ page }) => {
  await loadExplorer(page);
  await addDatasetToBasket(page, "run.nc");

  for (const [axisClass, replacement] of [
    ["xtitle", "Edited X axis"],
    ["ytitle", "Edited Y axis"],
  ] as const) {
    const mathTitle = page.locator(`g.${axisClass}-math-group`).first();
    await expect(mathTitle).toBeVisible();
    await mathTitle.scrollIntoViewIfNeeded();
    const bounds = await mathTitle.boundingBox();
    expect(bounds).not.toBeNull();
    await page.mouse.click(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);

    const editor = page.locator(".plugin-editable[contenteditable='true']").last();
    await expect(editor).toBeVisible();
    await editor.fill(replacement);
    await editor.press("Enter");
    await expect(page.locator(`text.${axisClass}`).first()).toHaveText(replacement);
  }
});

test("loads searchable metadata and saves measurement notes", async ({ page }) => {
  const state = await mockApplicationApi(page);
  await loadExplorer(page);
  await addDatasetToBasket(page, "run.nc");

  await page.getByRole("button", { name: "Metadata" }).click();
  await expect(page.getByText("1 file in basket")).toBeVisible();
  await page.getByPlaceholder("Search metadata...").fill("Alice");
  await expect(page.getByText(/Found 1 file with matches/)).toBeVisible();
  await expect(page.getByText("Alice", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Notes", exact: true }).click();
  const editor = page.getByPlaceholder(/Start typing your notes here/);
  await expect(editor).toHaveValue("Initial measurement note");
  await editor.fill("Updated from Playwright");
  await editor.press("Control+s");
  await expect.poll(() => state.saveNotesRequests.length).toBe(1);
  expect(state.saveNotesRequests[0].postDataJSON()).toMatchObject({
    path: "C:\\measurements\\run.nc",
    notes: "Updated from Playwright",
    note_scope: "measurement",
  });
});

test("saves QCoDeS notes against the Qimchi UID and run integer", async ({ page }) => {
  const state = await mockApplicationApi(page);
  await loadExplorer(page);
  await addDatasetToBasket(page, "7 | transport");

  await page.getByRole("button", { name: "Notes", exact: true }).click();
  const editor = page.getByPlaceholder(/Start typing your notes here/);
  await expect(editor).toHaveValue("Initial measurement note");
  await editor.fill("Run seven note");
  await editor.press("Control+s");

  await expect.poll(() => state.saveNotesRequests.length).toBe(1);
  expect(state.saveNotesRequests[0].postDataJSON()).toMatchObject({
    path: "C:\\measurements\\runs.db#run_id=7",
    uuid: "qcodes-guid-7",
    run_id: 7,
    notes: "Run seven note",
    note_scope: "measurement",
  });
});

test("opens help by shortcut but ignores shortcuts in editable fields", async ({ page }) => {
  const pathInput = page.getByPlaceholder("Enter folder path");
  await pathInput.focus();
  await page.keyboard.press("Shift+h");
  await expect(page.getByRole("heading", { name: "Help & Tips" })).toHaveCount(0);

  await pathInput.blur();
  await page.keyboard.press("Shift+h");
  await expect(page.getByRole("heading", { name: "Help & Tips" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { name: "Help & Tips" })).toHaveCount(0);
});

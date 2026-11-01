import { readFile } from "node:fs/promises";

import type { Page } from "@playwright/test";

import { expect, test } from "./coverage";
import { mockLiveHeatmapApi } from "./liveHeatmap";
import { mockSettingsApi } from "./settingsMock";

async function openPlotSetup(page: Page, item: "Save plot setup" | "Load plot setup") {
  await page.getByRole("button", { name: "Plot setup", exact: true }).click();
  await page.getByRole("menuitem", { name: item }).click();
}

test("a saved plot setup draws the same plots again", async ({ page }) => {
  await mockLiveHeatmapApi(page);
  await mockSettingsApi(page, { plots: { plottingBehaviour: "both" } });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/");
  await page.getByRole("button", { name: "Live Measurements" }).click();
  await page.getByText("live-heat", { exact: true }).dblclick();
  const plots = page.locator(".js-plotly-plot");
  await expect(plots).toHaveCount(2);

  await page
    .locator("[data-plot-id]")
    .first()
    .getByRole("button", { name: "Plot width", exact: true })
    .click();
  await page.getByRole("menuitemradio", { name: "100% width (this plot)" }).click();

  await openPlotSetup(page, "Save plot setup");
  await page.getByLabel("Plot setup name").fill("Live maps");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save to file" }).click();
  expect((await download).suggestedFilename()).toBe("Live maps.json");
  const saved = await (await download).path();
  const setup = JSON.parse(await readFile(saved, "utf-8"));
  expect(setup.qimchi).toBe("plot-setup");
  expect(setup.name).toBe("Live maps");
  expect(setup.plots.map((plot: { plotType: string }) => plot.plotType).sort()).toEqual([
    "HeatMap",
    "LinePlot",
  ]);
  expect(setup.plots.filter((plot: { width?: number }) => plot.width === 100)).toHaveLength(1);
  expect(JSON.stringify(setup)).not.toContain("memory://");

  await page.getByRole("button", { name: "Clear All Plots" }).click();
  await expect(plots).toHaveCount(0);

  await openPlotSetup(page, "Load plot setup");
  await page.getByLabel("Plot setup file to load").setInputFiles(saved);
  await expect(plots).toHaveCount(2);
  await expect(page.getByText(/Loaded 2 plots from/)).toBeVisible();
  const widths = await page.evaluate(() =>
    Array.from(document.querySelectorAll(".js-plotly-plot")).map(
      (plot) => (plot.closest("[style*='flex-basis']") as HTMLElement).style.maxWidth,
    ),
  );
  expect(widths).toContain("calc(100% - 8px)");
  // Composer cannot represent mixed plot types.
  await expect(page.locator("[data-tour='composer']")).toContainText("Drag any field here");

  const heatmap = setup.plots.find((plot: { plotType: string }) => plot.plotType === "HeatMap");
  await page.getByRole("button", { name: "Clear All Plots" }).click();
  await openPlotSetup(page, "Load plot setup");
  await page.getByLabel("Plot setup file to load").setInputFiles({
    name: "heatmap.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ ...setup, plots: [heatmap] })),
  });
  await expect(plots).toHaveCount(1);
  const composer = page.locator("[data-tour='composer']");
  for (const name of [...heatmap.indeps, ...heatmap.deps]) {
    await expect(composer).toContainText(name);
  }
});

test("loading a plot setup asks for measurements when the Basket is empty", async ({ page }) => {
  await mockSettingsApi(page);
  await page.goto("/");

  await openPlotSetup(page, "Load plot setup");
  await expect(
    page.getByText(/Add the measurements the plots should be drawn for to the Basket/),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Load from file…" })).toBeDisabled();
});

/** Mock library storage for plot setups. */
async function mockPlotSetupLibrary(page: Page) {
  const rows: { id: number; name: string; setup: unknown; updatedAt: string }[] = [];
  let nextId = 1;
  await page.route("**/health", (route) =>
    route.fulfill({ json: { ok: true, dbReady: true, dbError: null } }),
  );
  await page.route("**/library/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    const id = Number(path.split("/").pop());
    const updatedAt = new Date().toISOString();
    if (!path.startsWith("/library/plot-setups")) {
      await route.fulfill({
        json: method === "GET" ? [] : { uuid: null, hearted: false, trashed: false },
      });
    } else if (method === "GET") {
      await route.fulfill({ json: rows });
    } else if (method === "POST") {
      const { name, setup } = request.postDataJSON();
      const row = { id: nextId++, name, setup, updatedAt };
      rows.push(row);
      await route.fulfill({ json: row });
    } else if (method === "PATCH") {
      const row = rows.find((candidate) => candidate.id === id)!;
      Object.assign(row, request.postDataJSON(), { updatedAt });
      await route.fulfill({ json: row });
    } else {
      rows.splice(
        rows.findIndex((row) => row.id === id),
        1,
      );
      await route.fulfill({ json: { deleted: id } });
    }
  });
  return rows;
}

test("plot setups can be kept in the library, renamed, replaced and removed", async ({ page }) => {
  await mockLiveHeatmapApi(page);
  await mockSettingsApi(page, { plots: { plottingBehaviour: "both" } });
  const rows = await mockPlotSetupLibrary(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Live Measurements" }).click();
  await page.getByText("live-heat", { exact: true }).dblclick();
  const plots = page.locator(".js-plotly-plot");
  await expect(plots).toHaveCount(2);

  await openPlotSetup(page, "Save plot setup");
  await page.getByLabel("Plot setup name").fill("Live maps");
  await page.getByRole("button", { name: "Save to library" }).click();
  await expect(page.getByText("Saved “Live maps” to the library.")).toBeVisible();
  expect(rows.map((row) => row.name)).toEqual(["Live maps"]);

  await page.getByRole("button", { name: "Clear All Plots" }).click();
  await openPlotSetup(page, "Load plot setup");
  await expect(page.getByText(/^2 plots: /)).toBeVisible();
  await page.getByRole("button", { name: "Load plot setup Live maps" }).click();
  await expect(plots).toHaveCount(2);

  await openPlotSetup(page, "Load plot setup");
  await page.getByRole("button", { name: "Rename plot setup Live maps" }).click();
  await page.getByLabel("Rename plot setup Live maps").fill("Cooldown 3");
  await page.getByRole("button", { name: "Rename", exact: true }).click();
  await expect(page.getByText("Cooldown 3", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();

  // Confirm before replacing a setup with the same name.
  await page.locator("[data-plot-id]").first().getByRole("button", { name: "Close plot" }).click();
  await expect(plots).toHaveCount(1);
  await openPlotSetup(page, "Save plot setup");
  await page.getByLabel("Plot setup name").fill("Cooldown 3");
  await expect(page.getByText(/already has a setup called “Cooldown 3”/)).toBeVisible();
  await page.getByRole("button", { name: "Save to library" }).click();
  await page.getByRole("button", { name: "Replace", exact: true }).click();
  await expect(page.getByText("Saved “Cooldown 3” to the library.")).toBeVisible();
  expect(rows).toHaveLength(1);
  expect((rows[0].setup as { plots: unknown[] }).plots).toHaveLength(1);

  await openPlotSetup(page, "Load plot setup");
  await page.getByRole("button", { name: "Remove plot setup Cooldown 3" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Remove", exact: true }).click();
  await expect(page.getByText(/No plot setups in the library yet/)).toBeVisible();
  expect(rows).toHaveLength(0);
});

test("loading a setup that draws more than 30 plots asks first", async ({ page }) => {
  await mockLiveHeatmapApi(page);
  await mockSettingsApi(page, { plots: { plottingBehaviour: "both" } });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/");
  await page.getByRole("button", { name: "Live Measurements" }).click();
  await page.getByText("live-heat", { exact: true }).dblclick();
  const plots = page.locator(".js-plotly-plot");
  await expect(plots).toHaveCount(2);

  await openPlotSetup(page, "Save plot setup");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save to file" }).click();
  const setup = JSON.parse(await readFile(await (await download).path(), "utf-8"));
  const many = { ...setup, plots: Array.from({ length: 16 }, () => setup.plots).flat() };
  await page.getByRole("button", { name: "Clear All Plots" }).click();
  await expect(plots).toHaveCount(0);

  const load = async () => {
    await openPlotSetup(page, "Load plot setup");
    await page.getByLabel("Plot setup file to load").setInputFiles({
      name: "many.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(many)),
    });
  };
  const confirm = page.getByRole("alertdialog", { name: "Draw 32 plots?" });

  await load();
  await expect(confirm).toContainText("Loading many.json would draw 32 plots");
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(confirm).toHaveCount(0);
  await expect(plots).toHaveCount(0);

  await load();
  await confirm.getByRole("button", { name: "Draw 32 plots" }).click();
  await expect(page.getByText(/Loaded 32 plots from many\.json/)).toBeVisible();
});

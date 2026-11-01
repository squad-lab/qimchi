import type { Page } from "@playwright/test";

import { expect, test } from "./coverage";
import { mockSettingsApi } from "./settingsMock";

// Sweep rounds with their start times.
const ATTRIBUTES = {
  independents: ["round", "time"],
  dependents: ["current"],
  variable_independents: { current: ["round", "time"] },
  independent_dimensions: { round: ["round"], time: ["round"] },
};

async function openMeasurement(page: Page, count = 1) {
  const names = Array.from({ length: count }, (_, index) => (index ? `run${index}.nc` : "run.nc"));
  const plotRequests: { indeps: string[]; deps: string[]; plotType: string }[] = [];
  await page.route("**/*", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/health") {
      await route.fulfill({ json: { ok: true, dbReady: false, dbError: "disabled in test" } });
    } else if (path === "/load/") {
      await route.fulfill({
        json: names.map((name) => ({
          id: name,
          name,
          path: `C:\\data\\${name}`,
          type: "file",
          tags: ["netcdf"],
        })),
      });
    } else if (path === "/load-attrs/") {
      await route.fulfill({ json: ATTRIBUTES });
    } else if (path === "/plot/") {
      const body = request.postDataJSON();
      plotRequests.push(body);
      await route.fulfill({
        json: {
          success: true,
          plots: [
            {
              id: `plot-${plotRequests.length}`,
              plot_ref: `ref-${plotRequests.length}`,
              type: body.plotType,
              plotJson: { data: [{ type: "scatter", x: [0, 1], y: [1, 2] }], layout: {} },
            },
          ],
        },
      });
    } else {
      await route.fallback();
    }
  });
  await mockSettingsApi(page, { plots: { plottingBehaviour: "none" } });
  await page.goto("/");
  await page.getByPlaceholder("Enter folder path").fill("C:\\data");
  await page.getByTitle("Load folder").click();
  if (count === 1) {
    await page.getByText("run.nc", { exact: true }).dblclick();
  } else {
    await page.getByText("run.nc", { exact: true }).click();
    await page.keyboard.press("Control+KeyA");
    await page.getByRole("button", { name: "Add all selected files to basket" }).click();
  }
  await expect(page.getByRole("option")).toHaveCount(count);
  return plotRequests;
}

const chip = (page: Page, name: string) =>
  page.getByRole("option").getByText(name, { exact: true });
const dropZone = (page: Page, axis: "X" | "Y") =>
  page.locator("[data-tour='composer']").getByText(`${axis}-Axis:`);

test("an independent can be plotted on a LinePlot's Y axis", async ({ page }) => {
  const plotRequests = await openMeasurement(page);

  await chip(page, "round").dblclick();
  await chip(page, "time").dblclick();
  await page.getByRole("button", { name: "Plot", exact: true }).click();

  await expect.poll(() => plotRequests.length).toBe(1);
  expect(plotRequests[0]).toMatchObject({
    plotType: "LinePlot",
    indeps: ["round"],
    deps: ["time"],
  });
});

test("several X fields draw a plot for each", async ({ page }) => {
  const plotRequests = await openMeasurement(page);

  await chip(page, "round").dragTo(dropZone(page, "X"));
  await chip(page, "time").dragTo(dropZone(page, "X"));
  await chip(page, "current").dragTo(dropZone(page, "Y"));
  await page.getByRole("button", { name: "Plot", exact: true }).click();

  await expect.poll(() => plotRequests.length).toBe(2);
  expect(plotRequests.map((request) => request.indeps[0]).sort()).toEqual(["round", "time"]);
});

test("a Composer chip can be dragged to another axis", async ({ page }) => {
  await openMeasurement(page);
  const composer = page.locator("[data-tour='composer']");

  await chip(page, "round").dblclick();
  await expect(composer.getByRole("button", { name: "Remove round from x-axis" })).toBeVisible();
  await composer.getByText("round", { exact: true }).dragTo(dropZone(page, "Y"));

  await expect(composer.getByRole("button", { name: "Remove round from y-axis" })).toBeVisible();
  await expect(composer.getByRole("button", { name: "Remove round from x-axis" })).toHaveCount(0);
});

test("asks before drawing more than 30 plots at once", async ({ page }) => {
  const plotRequests = await openMeasurement(page, 16);
  await page.getByRole("option").first().click();
  await page.keyboard.press("Control+KeyA");
  await expect(page.getByRole("option", { selected: true })).toHaveCount(16);

  await chip(page, "round").first().dragTo(dropZone(page, "X"));
  await chip(page, "time").first().dragTo(dropZone(page, "X"));
  await chip(page, "current").first().dragTo(dropZone(page, "Y"));
  const plot = page.getByRole("button", { name: "Plot", exact: true });
  const confirm = page.getByRole("alertdialog", { name: "Draw 32 plots?" });

  await plot.click();
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(confirm).toHaveCount(0);
  expect(plotRequests).toHaveLength(0);

  await plot.click();
  await confirm.getByRole("button", { name: "Draw 32 plots" }).click();
  await expect.poll(() => plotRequests.length).toBe(32);
});

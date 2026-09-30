import type { Page } from "@playwright/test";

import { expect, test } from "./coverage";
import { chooseColorscale } from "./colorscale";
import { mockLiveHeatmapApi, openLiveHeatmap } from "./liveHeatmap";
import { mockSettingsApi } from "./settingsMock";

// First colours of the colormaps involved, as Plotly resolves them.
const VIRIDIS = "#440154";
const PLASMA = "#0d0887";
const INFERNO = "#000004";
const CIVIDIS = "#00224e";

const heatmapLook = (page: Page) =>
  page.evaluate(() => {
    const gd = (Array.from(document.querySelectorAll(".js-plotly-plot")) as any[]).find(
      (plot) => plot.data?.[0]?.type === "heatmap",
    );
    if (!gd?._fullLayout?.coloraxis) return null;
    return {
      colorscale: gd._fullLayout.coloraxis.colorscale[0][1] as string,
      grid: Boolean(gd._fullLayout.xaxis.showgrid),
    };
  });

const settingsDialog = (page: Page) => page.getByRole("dialog", { name: "Settings" });
// The Viewer's own width menu, not a plot's.
const viewerWidthButton = (page: Page) =>
  page.getByRole("button", { name: "Plot width", exact: true }).last();

async function openSettings(page: Page, section?: string) {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  if (section) {
    await settingsDialog(page).getByRole("button", { name: section, exact: true }).click();
  }
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
});

test("a heatmap default applies to existing plots, except where a plot overrides it", async ({
  page,
}) => {
  await mockLiveHeatmapApi(page);
  const settings = await mockSettingsApi(page);
  await openLiveHeatmap(page);
  await expect.poll(async () => (await heatmapLook(page))?.colorscale).toBe(VIRIDIS);

  await openSettings(page, "HeatMap");
  await chooseColorscale(page, settingsDialog(page), "Plasma");
  await expect.poll(async () => (await heatmapLook(page))?.colorscale).toBe(PLASMA);
  await expect
    .poll(() => settings.document)
    .toEqual({ appearance: { heatmap: { hmap: { colorscale: "plasma" } } } });
  await settingsDialog(page).getByRole("button", { name: "Close modal" }).click();

  // The plot's own choice wins over later defaults...
  await page.getByTitle("Edit Appearance").first().click();
  await chooseColorscale(page, page, "Inferno");
  await expect.poll(async () => (await heatmapLook(page))?.colorscale).toBe(INFERNO);
  await openSettings(page, "HeatMap");
  await chooseColorscale(page, settingsDialog(page), "Cividis");
  await page.waitForTimeout(500);
  expect((await heatmapLook(page))?.colorscale).toBe(INFERNO);
  await settingsDialog(page).getByRole("button", { name: "Close modal" }).click();

  // ...until the plot is reset, which returns it to the user's defaults.
  await page.getByTitle("Reset", { exact: true }).first().click();
  await expect.poll(async () => (await heatmapLook(page))?.colorscale).toBe(CIVIDIS);
});

test("the grid default is drawn on the plot", async ({ page }) => {
  await mockLiveHeatmapApi(page);
  await mockSettingsApi(page);
  await openLiveHeatmap(page);
  await expect.poll(async () => (await heatmapLook(page))?.grid).toBe(false);

  await openSettings(page, "HeatMap");
  await settingsDialog(page).getByRole("button", { name: "X axis" }).first().click();
  await settingsDialog(page).getByLabel("Show X-axis major grid").check({ force: true });

  await expect.poll(async () => (await heatmapLook(page))?.grid).toBe(true);
});

test("wide Settings sections stay in one column", async ({ page }) => {
  await mockLiveHeatmapApi(page);
  await mockSettingsApi(page);
  await page.goto("/");
  await openSettings(page, "HeatMap");

  const dialog = settingsDialog(page);
  // Resize past the former two-column breakpoint.
  await dialog.evaluate((node) => {
    const frame = node.parentElement;
    if (frame) frame.style.width = "1400px";
  });

  const colorscale = dialog.getByLabel("Heatmap colorscale");
  const tip = dialog.getByText(/Sequential colormaps/);
  const [colorscaleBox, tipBox] = await Promise.all([colorscale.boundingBox(), tip.boundingBox()]);
  expect(colorscaleBox).not.toBeNull();
  expect(tipBox).not.toBeNull();
  expect(tipBox!.y).toBeGreaterThan(colorscaleBox!.y + colorscaleBox!.height);

  await dialog.getByRole("button", { name: "X axis" }).first().click();
  const major = await dialog.getByRole("heading", { name: "Major Grid & Ticks" }).boundingBox();
  const minor = await dialog.getByRole("heading", { name: "Minor Grid & Ticks" }).boundingBox();
  expect(major).not.toBeNull();
  expect(minor).not.toBeNull();
  expect(minor!.y).toBeGreaterThan(major!.y);
  expect(Math.abs(minor!.x - major!.x)).toBeLessThan(4);
});

test("Settings search opens and highlights a matching setting", async ({ page }) => {
  await mockLiveHeatmapApi(page);
  await mockSettingsApi(page);
  await page.goto("/");
  await openSettings(page);

  const dialog = settingsDialog(page);
  const search = dialog.getByRole("textbox", { name: "Search settings" });
  await search.fill("fastest refresh");
  await expect(dialog.getByRole("group", { name: "Settings search results" })).toContainText(
    "Fastest live refresh",
  );
  await search.press("Enter");

  await expect(dialog.getByRole("button", { name: "Live", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(dialog.getByLabel("Fastest live refresh")).toBeVisible();
  await expect(search).toHaveValue("");

  await search.fill("no such setting");
  await expect(dialog).toContainText("No settings found for “no such setting”");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await expect(search).toHaveValue("");
});

test("rail buttons and Settings edit the same saved values", async ({ page }) => {
  await mockLiveHeatmapApi(page);
  const settings = await mockSettingsApi(page, { general: { theme: "light" } });
  await page.goto("/");

  await page.getByRole("button", { name: "Switch to dark theme" }).click();
  await viewerWidthButton(page).click();
  await page.getByRole("menuitemradio", { name: "66% width (all plots)" }).click();
  await expect.poll(() => settings.document).toEqual({ general: { theme: "dark", plotWidth: 66 } });

  await openSettings(page);
  await expect(settingsDialog(page).getByRole("radio", { name: "Dark" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(settingsDialog(page).getByRole("radio", { name: "66%" })).toHaveAttribute(
    "aria-checked",
    "true",
  );

  // The server's copy is the source of truth, not the browser's.
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await viewerWidthButton(page).click();
  await expect(page.getByRole("menuitemradio", { name: "66% width (all plots)" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
});

for (const [behaviour, expected] of [
  [undefined, ["heatmap"]],
  ["both", ["heatmap", "scatter"]],
  ["none", []],
] as const) {
  test(`plotting behaviour ${behaviour ?? "default"} creates ${expected.join(" + ") || "no plots"}`, async ({
    page,
  }) => {
    await mockLiveHeatmapApi(page);
    await mockSettingsApi(page, behaviour ? { plots: { plottingBehaviour: behaviour } } : {});
    await page.goto("/");
    await page.getByRole("button", { name: "Live Measurements" }).click();

    const row = page
      .getByText("live-heat", { exact: true })
      .locator("xpath=ancestor::div[@data-level][1]");
    await page.getByText("live-heat", { exact: true }).dblclick();
    await expect(row).toHaveClass(/border-l-green-500/);

    const plotTypes = () =>
      page.evaluate(() =>
        (Array.from(document.querySelectorAll(".js-plotly-plot")) as any[])
          .map((plot) => plot.data?.[0]?.type)
          .sort(),
      );
    if (expected.length) {
      await expect.poll(plotTypes).toEqual([...expected]);
    }
    await page.waitForTimeout(1_500);
    expect(await plotTypes()).toEqual([...expected]);
  });
}

test("when settings cannot be saved, Settings mentions it and changes still apply locally", async ({
  page,
}) => {
  await mockLiveHeatmapApi(page);
  const settings = await mockSettingsApi(page, { general: { theme: "light" } });
  await page.goto("/");
  await expect(page.locator("html")).not.toHaveClass(/dark/);

  settings.unavailable = "The Qimchi library database is unavailable: disk full";
  await page.getByRole("button", { name: "Switch to dark theme" }).click();

  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(page.getByText(/Settings were not saved: .*disk full/)).toBeVisible();
  await openSettings(page);
  await expect(settingsDialog(page).getByRole("alert")).toContainText("disk full");
});

async function mockGrowingLiveList(page: Page) {
  const measurements: { id: string; name: string; path: string; type: string; tags: string[] }[] =
    [];
  await page.route("**/load-live/", async (route) => {
    await route.fulfill({
      json: { success: true, children: measurements, count: measurements.length },
    });
  });
  return (id: string) =>
    measurements.push({ id, name: id, path: `memory://${id}`, type: "file", tags: ["live"] });
}

for (const autoAdd of [true, false]) {
  test(`a new live measurement ${autoAdd ? "joins" : "stays out of"} the basket when auto-add is ${autoAdd ? "on" : "off"}`, async ({
    page,
  }) => {
    await mockLiveHeatmapApi(page);
    await mockSettingsApi(page, autoAdd ? {} : { live: { autoAddToBasket: false } });
    const startMeasurement = await mockGrowingLiveList(page);
    await page.goto("/");
    await page.getByRole("button", { name: "Live Measurements" }).click();
    await page.waitForTimeout(1_500);

    startMeasurement("live-new");
    const row = page
      .getByText("live-new", { exact: true })
      .locator("xpath=ancestor::div[@data-level][1]");
    await expect(row).toBeVisible({ timeout: 5_000 });
    await page.waitForTimeout(1_500);

    if (autoAdd) await expect(row).toHaveClass(/border-l-green-500/);
    else await expect(row).not.toHaveClass(/border-l-green-500/);
  });
}

test("the Explorer's sort buttons and Settings share one saved order", async ({ page }) => {
  await mockLiveHeatmapApi(page);
  const settings = await mockSettingsApi(page, { explorer: { sortBy: "name" } });
  await page.goto("/");
  await page.getByRole("button", { name: "Live Measurements" }).click();

  await page.getByRole("button", { name: "Choose sort" }).click();
  await page.getByRole("menuitemradio", { name: "size" }).click();
  await expect.poll(() => settings.document).toEqual({ explorer: { sortBy: "size" } });

  await openSettings(page, "Explorer");
  await expect(settingsDialog(page).getByLabel("Sort by")).toHaveValue("size");
  await settingsDialog(page).getByLabel("Sort by").selectOption("timestamp");
  // Back to the default, so nothing is stored.
  await expect.poll(() => settings.document).toEqual({});
});

test("Restore all defaults asks in place before clearing every setting", async ({ page }) => {
  await mockLiveHeatmapApi(page);
  const settings = await mockSettingsApi(page, { general: { zoom: 1.25 } });
  let nativeDialogs = 0;
  page.on("dialog", (dialog) => {
    nativeDialogs += 1;
    void dialog.dismiss();
  });
  await page.goto("/");
  await openSettings(page);
  const dialog = settingsDialog(page);

  await dialog.getByRole("button", { name: "Restore all defaults" }).click();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  expect(settings.document).toEqual({ general: { zoom: 1.25 } });

  await dialog.getByRole("button", { name: "Restore all defaults" }).click();
  await dialog.getByRole("button", { name: "Restore all", exact: true }).click();
  await expect.poll(() => settings.document).toEqual({});
  expect(nativeDialogs).toBe(0);
});

test("settings export to a JSON file and import back", async ({ page }) => {
  await mockLiveHeatmapApi(page);
  const settings = await mockSettingsApi(page, {
    general: { theme: "dark", plotWidth: 66 },
    appearance: { heatmap: { hmap: { colorscale: "plasma" } } },
  });
  await page.goto("/");
  await openSettings(page);
  const dialog = settingsDialog(page);

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    dialog.getByRole("button", { name: "Export settings" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^qimchi-settings-\d{4}-\d{2}-\d{2}\.json$/);
  const exported = JSON.parse(
    await (await download.createReadStream()).toArray().then((c) => Buffer.concat(c).toString()),
  );
  expect(exported).toMatchObject({
    qimchi: "settings",
    formatVersion: 1,
    qimchiVersion: expect.any(String),
    settings: settings.document,
  });

  // Importing replaces everything: values missing from the file go back to
  // their defaults, and invalid ones are dropped rather than saved.
  const file = {
    qimchi: "settings",
    formatVersion: 1,
    settings: { general: { theme: "light", zoom: "huge" }, explorer: { sortBy: "name" } },
  };
  await dialog.getByLabel("Settings file to import").setInputFiles({
    name: "mine.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(file)),
  });
  await expect
    .poll(() => settings.document)
    .toEqual({
      general: { theme: "light" },
      explorer: { sortBy: "name" },
    });
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await expect(page.getByText("Settings imported from mine.json")).toBeVisible();

  await dialog.getByLabel("Settings file to import").setInputFiles({
    name: "theme.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ settings: { line: {} } })),
  });
  await expect(page.getByText("That file is not a Qimchi settings export")).toBeVisible();
  expect(settings.document).toEqual({ general: { theme: "light" }, explorer: { sortBy: "name" } });
});

test("Shift+S toggles Settings, like Shift+H does Help", async ({ page }) => {
  await mockLiveHeatmapApi(page);
  await mockSettingsApi(page);
  await page.goto("/");

  await page.keyboard.press("Shift+S");
  await expect(settingsDialog(page)).toBeVisible();
  await expect(
    settingsDialog(page).getByRole("button", { name: "Import settings" }).locator("svg"),
  ).toHaveClass(/lucide-download/);
  await page.keyboard.press("Shift+S");
  await expect(settingsDialog(page)).toHaveCount(0);
});

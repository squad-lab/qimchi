import type { Page, Request } from "@playwright/test";

import { expect, test } from "./coverage";
import { mockSettingsApi } from "./settingsMock";

const DEMO = {
  folder: "C:\\Users\\me\\.qimchi\\demo",
  logo: "C:\\Users\\me\\.qimchi\\demo\\qimchi_logo.nc",
  reveal: "C:\\Users\\me\\.qimchi\\demo\\measurement2.nc",
};
const LIVE_ID = "qimchi-demo-120000-abcd";

interface DemoApi {
  prepareRequests: Request[];
  liveRequests: Request[];
  stopRequests: Request[];
  plotRequests: Request[];
}

const logoAttrs = {
  independents: ["P2", "P1"],
  dependents: ["signal"],
  variable_independents: { signal: ["P2", "P1"] },
};

const revealAttrs = {
  independents: ["y", "x", "reveal"],
  dependents: ["brightness"],
  variable_independents: { brightness: ["y", "x", "reveal"] },
};

async function mockDemoApi(page: Page): Promise<DemoApi> {
  const state: DemoApi = {
    prepareRequests: [],
    liveRequests: [],
    stopRequests: [],
    plotRequests: [],
  };
  let plotId = 0;

  await page.route("**/*", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;

    if (path === "/health") {
      await route.fulfill({ json: { ok: true, dbReady: false, dbError: "disabled in test" } });
    } else if (path === "/demo/prepare") {
      state.prepareRequests.push(request);
      await route.fulfill({ json: DEMO });
    } else if (path === "/demo/live/start") {
      state.liveRequests.push(request);
      await route.fulfill({
        json: {
          measurementId: LIVE_ID,
          path: `memory://${LIVE_ID}`,
          nodeId: `file-memory-${LIVE_ID}`,
          name: LIVE_ID,
        },
      });
    } else if (path === "/demo/live/stop") {
      state.stopRequests.push(request);
      await route.fulfill({ json: { stopped: true } });
    } else if (path === "/transform-plot") {
      // Return transformed data for the existing plot.
      await route.fulfill({
        json: {
          plot_json: {
            data: [
              {
                type: "heatmap",
                x: [0, 1],
                y: [0, 1],
                z: [
                  [1, 0],
                  [0, 1],
                ],
              },
            ],
            layout: { title: { text: "HeatMap" } },
          },
          plot_ref: request.postDataJSON()?.plot_ref ?? "plot-ref",
          warnings: [],
        },
      });
    } else if (path === "/load/") {
      // Expose the demo folder through the Explorer API.
      await route.fulfill({
        json: [
          {
            id: "demo-logo",
            name: "qimchi_logo.nc",
            path: DEMO.logo,
            type: "file",
            tags: ["netcdf"],
          },
          {
            id: "demo-reveal",
            name: "measurement2.nc",
            path: DEMO.reveal,
            type: "file",
            tags: ["netcdf"],
          },
        ],
      });
    } else if (path === "/load-live/") {
      await route.fulfill({ json: [] });
    } else if (path === "/load-attrs/") {
      const datasetPath = request.postDataJSON()?.path as string;
      await route.fulfill({ json: datasetPath.includes("measurement2") ? revealAttrs : logoAttrs });
    } else if (path === "/plot/") {
      state.plotRequests.push(request);
      const body = request.postDataJSON();
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
              slider_config:
                body.plotType === "LinePlot"
                  ? { P2: { min: -1, max: 1, step: 1, value: -1 } }
                  : body.deps?.includes("brightness")
                    ? {
                        reveal: {
                          min: 0,
                          max: 1,
                          step: 1,
                          value: 0,
                          labels: ["Who's that Poqémon?", "The big reveal"],
                        },
                      }
                    : {},
              plotJson: {
                data:
                  body.plotType === "HeatMap"
                    ? [
                        {
                          type: "heatmap",
                          x: [0, 1],
                          y: [0, 1],
                          z: [
                            [0, 1],
                            [1, 0],
                          ],
                          coloraxis: "coloraxis",
                        },
                      ]
                    : [{ type: "scatter", mode: "lines", x: [0, 1], y: [1, 2] }],
                layout: {
                  title: { text: body.plotType },
                  // Match the backend's shared heat-map coloraxis.
                  coloraxis: { colorscale: "Viridis" },
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

const card = (page: Page) => page.locator(".driver-popover");
const cardTitle = (page: Page) => page.locator(".driver-popover-title");
const cardButton = (page: Page, name: string) => card(page).getByRole("button", { name });
const filtersPanel = (page: Page) => page.locator('[data-tour="filters-panel"]');

// Perform walkthrough tasks through their visible controls.
async function addLogoFromExplorer(page: Page) {
  await page
    .locator('[data-tour="sidebar"]')
    .getByText("qimchi_logo.nc", { exact: true })
    .dblclick();
}

async function openPlotTool(page: Page, tool: "filters" | "appearance") {
  const tile = page.locator("[data-plot-id]").first();
  await tile.hover();
  const name = tool === "filters" ? "Edit filters" : "Edit appearance";
  await tile.getByRole("button", { name }).first().click();
}

async function buildLinePlot(page: Page) {
  const basket = page.locator('[data-tour="basket"]');
  await basket.getByText("P1", { exact: true }).first().dblclick();
  await basket.getByText("signal", { exact: true }).first().dblclick();
  await page.keyboard.press("l");
  await page.keyboard.press("p");
}

async function applyDiffFilter(page: Page) {
  await filtersPanel(page).getByRole("tab", { name: "Diff along Y" }).click();
  await filtersPanel(page).getByText("Apply", { exact: true }).first().click();
}

// Select from the popup rendered outside the highlighted panel.
async function changeAppearance(page: Page) {
  await page.getByRole("button", { name: "Heatmap colorscale" }).click();
  await page.getByRole("option", { name: "Plasma", exact: true }).first().click();
}

async function slideToReveal(page: Page) {
  await filtersPanel(page).getByText("Sliders", { exact: true }).first().click();
  await filtersPanel(page).locator('input[type="range"]').first().focus();
  await page.keyboard.press("End");
}

async function startFromHelp(page: Page) {
  await page.getByRole("button", { name: "Help and tips" }).click();
  // Select the button inside the Help modal rather than the sidebar button.
  await page.getByRole("button", { name: "Take the walkthrough" }).last().click();
  await expect(cardTitle(page)).toHaveText("Welcome to Qimchi");
}

test("walks through the demo measurements from start to finish", async ({ page }) => {
  const api = await mockDemoApi(page);
  const settings = await mockSettingsApi(page);
  await page.goto("/");

  await startFromHelp(page);
  // Starting the walkthrough persists the seen flag.
  await expect
    .poll(() => settings.patches.some((patch) => JSON.stringify(patch).includes("walkthrough")))
    .toBe(true);

  await cardButton(page, "Let's go").click();
  await expect(cardTitle(page)).toHaveText("The Explorer");
  expect(api.prepareRequests).toHaveLength(1);
  await expect(card(page)).toContainText(DEMO.folder);

  await addLogoFromExplorer(page);
  await expect(cardTitle(page)).toHaveText("Your first plot");
  await expect(page.locator("[data-plot-id]")).toHaveCount(1);

  // The highlighted plot must retain Plotly hover interactions.
  const surface = page.locator("[data-plot-id] .nsewdrag").first();
  await expect(surface).toBeVisible();
  // Retry the pointer movement because Plotly may redraw after the first hover.
  await expect(async () => {
    const box = (await surface.boundingBox())!;
    await page.mouse.move(box.x + 5, box.y + 5);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 4 });
    await expect(page.locator(".hoverlayer .hovertext")).not.toHaveCount(0, { timeout: 1000 });
  }).toPass({ timeout: 10000 });

  await cardButton(page, "Next").click();
  await expect(cardTitle(page)).toHaveText("Filters");
  await openPlotTool(page, "filters");
  await expect(cardTitle(page)).toHaveText("Try a filter");
  await expect(page.locator('[data-tour="filters-panel"]')).toBeVisible();

  // Applying the filter satisfies the step and advances it automatically.
  await expect(cardButton(page, "Next")).toHaveClass(/driver-popover-btn-disabled/);
  await applyDiffFilter(page);
  await expect(cardTitle(page)).toHaveText("Appearance");
  // Advancement closes the filters panel.
  await expect(page.locator('[data-tour="filters-panel"]')).toHaveCount(0);
  await openPlotTool(page, "appearance");
  await expect(cardTitle(page)).toHaveText("Make it yours");

  await changeAppearance(page);
  await expect(cardTitle(page)).toHaveText("Build a line plot");
  await buildLinePlot(page);
  await expect(cardTitle(page)).toHaveText("One slice at a time");
  expect(api.plotRequests.map((r) => r.postDataJSON().plotType)).toContain("LinePlot");

  await cardButton(page, "Next").click();
  await expect(cardTitle(page)).toHaveText("Live plotting");
  await cardButton(page, "Start the measurement").click();
  await expect(cardTitle(page)).toHaveText("Watch it fill in");
  expect(api.liveRequests).toHaveLength(1);
  // The live measurement recreates only its default heat map; the custom-plot
  // setting is restored when the walkthrough ends.
  await expect(page.locator("[data-plot-id]")).toHaveCount(3);
  expect(JSON.stringify(settings.document)).toContain('"recreateCustomPlots":false');

  await cardButton(page, "Next").click();
  await expect(cardTitle(page)).toHaveText("Plot your own measurements live");
  await expect(card(page).getByRole("link", { name: "qimchi-connect" })).toHaveAttribute(
    "href",
    "https://gitlab.com/squad-lab/qimchi-connect",
  );

  await cardButton(page, "Next").click();
  await expect(cardTitle(page)).toHaveText("One more thing");
  await cardButton(page, "Show me").click();
  await expect(cardTitle(page)).toHaveText("Who's that Poqémon?");
  await expect(page.locator("[data-plot-id]")).toHaveCount(1);

  await openPlotTool(page, "filters");
  await expect(page.locator('[data-tour="filters-panel"]')).toBeVisible();
  // Disambiguate the two cards that share this title by their body text.
  await expect(card(page)).toContainText("slider all the way to the right");
  await slideToReveal(page);
  await expect(cardTitle(page)).toHaveText("It's Qabbage!");

  // Finish removes earlier demo data before presenting the final cleanup prompt.
  await expect(page.locator("[data-plot-id]")).toHaveCount(1);
  await cardButton(page, "Finish").click();
  await expect(cardTitle(page)).toHaveText("Before you go");
  await cardButton(page, "Keep everything").click();
  await expect(card(page)).toHaveCount(0);
  await expect.poll(() => JSON.stringify(settings.document)).not.toContain("recreateCustomPlots");
  await expect(page.locator("[data-plot-id]")).toHaveCount(1);
  const basket = page.locator('[data-tour="basket"]');
  await expect(basket.getByText(/measurement2/).first()).toBeAttached();
  await expect(basket.getByText(/qimchi_logo|qimchi-demo/)).toHaveCount(0);
});

test("starts from the sidebar rail", async ({ page }) => {
  await mockDemoApi(page);
  await mockSettingsApi(page);
  await page.goto("/");

  await page.getByRole("button", { name: "Take the walkthrough" }).click();
  await expect(cardTitle(page)).toHaveText("Welcome to Qimchi");
});

test("starting clears the Composer, so its steps can be done", async ({ page }) => {
  await mockDemoApi(page);
  await mockSettingsApi(page);
  await page.goto("/");

  await startFromHelp(page);
  await cardButton(page, "Let's go").click();
  await addLogoFromExplorer(page);
  await card(page).locator(".driver-popover-close-btn").click();
  await cardButton(page, "Keep everything").click();

  const composer = page.locator('[data-tour="composer"]');
  await page
    .locator('[data-tour="basket"]')
    .getByText("signal", { exact: true })
    .first()
    .dblclick();
  const signalAxis = composer.getByRole("button", { name: /^Remove signal from/ });
  await expect(signalAxis).toBeVisible();

  await page.getByRole("button", { name: "Take the walkthrough" }).click();
  await expect(cardTitle(page)).toHaveText("Welcome to Qimchi");
  await expect(signalAxis).toHaveCount(0);
});

test("can be left at any step with the close button", async ({ page }) => {
  await mockDemoApi(page);
  await mockSettingsApi(page);
  await page.goto("/");

  await startFromHelp(page);
  await cardButton(page, "Let's go").click();
  await expect(cardTitle(page)).toHaveText("The Explorer");

  await addLogoFromExplorer(page);
  await expect(page.locator("[data-plot-id]")).toHaveCount(1);

  await card(page).locator(".driver-popover-close-btn").click();
  await expect(cardTitle(page)).toHaveText("Before you go");
  await cardButton(page, "Tidy up").click();

  await expect(card(page)).toHaveCount(0);
  await expect(page.locator("[data-plot-id]")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Clear basket" })).toBeDisabled();
  await expect(page.getByPlaceholder("Enter folder path")).toHaveValue("");
});

test("closing before anything was added just closes", async ({ page }) => {
  await mockDemoApi(page);
  await mockSettingsApi(page);
  await page.goto("/");

  await startFromHelp(page);
  await card(page).locator(".driver-popover-close-btn").click();
  await expect(card(page)).toHaveCount(0);
});

test("steps aside while Help is open and comes back where it was", async ({ page }) => {
  await mockDemoApi(page);
  await mockSettingsApi(page);
  await page.goto("/");

  await startFromHelp(page);
  await cardButton(page, "Let's go").click();
  await expect(cardTitle(page)).toHaveText("The Explorer");

  await page.locator("body").press("Shift+H");
  const help = page.getByRole("dialog", { name: "Help & Tips" });
  await expect(help).toBeVisible();
  await expect(card(page)).toHaveCount(0);
  // Pausing the walkthrough removes its interaction overlay.
  await help.getByRole("button", { name: "Viewer", exact: true }).click();
  await expect(help.getByRole("heading", { name: "Viewer" })).toBeVisible();

  await help.getByRole("button", { name: "Back to the walkthrough" }).click();
  await expect(help).toBeHidden();
  await expect(cardTitle(page)).toHaveText("The Explorer");
});

test("starting from the rail closes Help", async ({ page }) => {
  await mockDemoApi(page);
  await mockSettingsApi(page);
  await page.goto("/");

  await page.locator("body").press("Shift+H");
  const help = page.getByRole("dialog", { name: "Help & Tips" });
  await expect(help).toBeVisible();

  // Select the rail button outside the Help dialog.
  await page
    .getByRole("button", { name: "Take the walkthrough" })
    .and(page.locator(":not([role=dialog] *)"))
    .click();
  await expect(help).toBeHidden();
  await expect(cardTitle(page)).toHaveText("Welcome to Qimchi");
});

test("Esc leaves the tour and asks about tidying up", async ({ page }) => {
  await mockDemoApi(page);
  await mockSettingsApi(page);
  await page.goto("/");

  await startFromHelp(page);
  await cardButton(page, "Let's go").click();
  await addLogoFromExplorer(page);
  await expect(page.locator("[data-plot-id]")).toHaveCount(1);

  await page.keyboard.press("Escape");
  await expect(cardTitle(page)).toHaveText("Before you go");

  // A second Esc keeps everything.
  await page.keyboard.press("Escape");
  await expect(card(page)).toHaveCount(0);
  await expect(page.locator("[data-plot-id]")).toHaveCount(1);
});

test("Esc closes what is open before it closes the tour", async ({ page }) => {
  await mockDemoApi(page);
  await mockSettingsApi(page);
  await page.goto("/");

  await startFromHelp(page);
  await cardButton(page, "Let's go").click();
  await expect(cardTitle(page)).toHaveText("The Explorer");

  // Shift+F opens the Explorer across the window; Esc should only close that.
  await page.locator("body").press("Shift+F");
  const exitFullWindow = page.getByRole("button", { name: "Exit full window" });
  await expect(exitFullWindow).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(exitFullWindow).toBeHidden();
  await expect(cardTitle(page)).toHaveText("The Explorer");

  await page.keyboard.press("Escape");
  await expect(cardTitle(page)).toHaveText("Before you go");
});

test("keeps the second demo measurement a surprise until its step", async ({ page }) => {
  await mockDemoApi(page);
  await mockSettingsApi(page);
  await page.goto("/");

  await startFromHelp(page);
  await cardButton(page, "Let's go").click();
  await expect(cardTitle(page)).toHaveText("The Explorer");

  await page
    .locator('[data-tour="sidebar"]')
    .getByText("measurement2.nc", { exact: true })
    .dblclick();
  await expect(page.getByText("This one is a surprise for later").first()).toBeVisible();
  await expect(page.locator('[data-tour="basket"]').getByText(/measurement2/)).toHaveCount(0);

  await addLogoFromExplorer(page);
  await expect(page.locator("[data-plot-id]")).toHaveCount(1);
});

test("puts back a demo plot that was removed by hand", async ({ page }) => {
  await mockDemoApi(page);
  await mockSettingsApi(page);
  await page.goto("/");

  await startFromHelp(page);
  await cardButton(page, "Let's go").click();
  await addLogoFromExplorer(page);
  await expect(cardTitle(page)).toHaveText("Your first plot");

  const plot = page.locator("[data-plot-id]");
  await plot.hover();
  await plot.getByRole("button", { name: "Close plot" }).click();
  await expect(plot).toHaveCount(0);

  // The repair loop recreates a heat map removed during its required step.
  await expect(plot).toHaveCount(1);
  const basket = page.locator('[data-tour="basket"]');
  await expect(basket.getByText(/qimchi_logo/)).toHaveCount(1);
});

test.describe("on first launch", () => {
  // Override WebDriver detection to test first-launch behavior.
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() =>
      Object.defineProperty(navigator, "webdriver", { get: () => false }),
    );
    await mockDemoApi(page);
  });

  test("opens by itself when it has not been seen", async ({ page }) => {
    await mockSettingsApi(page);
    await page.goto("/");

    await expect(cardTitle(page)).toHaveText("Welcome to Qimchi");
  });

  test("stays closed once it has been seen", async ({ page }) => {
    await mockSettingsApi(page, { general: { walkthroughSeen: true } });
    await page.goto("/");

    await expect(page.getByRole("button", { name: "Help and tips" })).toBeVisible();
    await page.waitForTimeout(1000);
    await expect(card(page)).toHaveCount(0);
  });
});

test("Back undoes what the step did, so it can be done again", async ({ page }) => {
  const api = await mockDemoApi(page);
  await mockSettingsApi(page);
  await page.goto("/");
  const plots = page.locator("[data-plot-id]");
  const next = () => cardButton(page, "Next").click();
  const back = () => cardButton(page, "Back").click();

  await startFromHelp(page);
  await cardButton(page, "Let's go").click();
  await addLogoFromExplorer(page);
  await expect(cardTitle(page)).toHaveText("Your first plot");

  // Returning to Explorer removes the logo and prevents automatic re-advancement.
  await back();
  await expect(cardTitle(page)).toHaveText("The Explorer");
  await expect(plots).toHaveCount(0);
  await page.waitForTimeout(1000);
  await expect(cardTitle(page)).toHaveText("The Explorer");
  await addLogoFromExplorer(page);
  await expect(cardTitle(page)).toHaveText("Your first plot");

  // Returning to Filters closes its panel and resets the completion condition.
  await next();
  await openPlotTool(page, "filters");
  await expect(cardTitle(page)).toHaveText("Try a filter");
  await back();
  await expect(page.locator('[data-tour="filters-panel"]')).toHaveCount(0);
  await expect(cardTitle(page)).toHaveText("Filters");

  // Returning to Composer removes the line plot created by that step.
  await openPlotTool(page, "filters");
  await expect(cardTitle(page)).toHaveText("Try a filter");
  await applyDiffFilter(page);
  await expect(cardTitle(page)).toHaveText("Appearance");
  await openPlotTool(page, "appearance");
  await expect(cardTitle(page)).toHaveText("Make it yours");
  await changeAppearance(page);
  await expect(cardTitle(page)).toHaveText("Build a line plot");
  await buildLinePlot(page);
  await expect(cardTitle(page)).toHaveText("One slice at a time");
  await expect(plots).toHaveCount(2);
  await back();
  await expect(cardTitle(page)).toHaveText("Build a line plot");
  await expect(plots).toHaveCount(1);
  await buildLinePlot(page);
  await expect(cardTitle(page)).toHaveText("One slice at a time");

  // Returning to Live plotting stops and removes the live measurement.
  await next();
  await cardButton(page, "Start the measurement").click();
  await expect(cardTitle(page)).toHaveText("Watch it fill in");
  await expect(plots).toHaveCount(3);
  await back();
  await expect(cardTitle(page)).toHaveText("Live plotting");
  await expect(plots).toHaveCount(2);
  await expect.poll(() => api.stopRequests.length).toBe(1);

  // Returning from the reveal step restores its plot snapshot.
  await cardButton(page, "Start the measurement").click();
  await expect(plots).toHaveCount(3);
  await next();
  await next();
  await cardButton(page, "Show me").click();
  await expect(cardTitle(page)).toHaveText("Who's that Poqémon?");
  await expect(plots).toHaveCount(1);
  await back();
  await expect(cardTitle(page)).toHaveText("One more thing");
  await expect(plots).toHaveCount(3);
});

test("the colour scale picker previews a scale without applying it", async ({ page }) => {
  await mockDemoApi(page);
  await mockSettingsApi(page);
  await page.goto("/");

  // Use the walkthrough fixture to create the heat map under test.
  await startFromHelp(page);
  await cardButton(page, "Let's go").click();
  await addLogoFromExplorer(page);
  await expect(cardTitle(page)).toHaveText("Your first plot");
  await card(page).locator(".driver-popover-close-btn").click();
  await cardButton(page, "Keep everything").click();

  const firstColour = () =>
    page.evaluate(() => {
      const gd = document.querySelector(".js-plotly-plot") as unknown as {
        _fullLayout?: { coloraxis?: { colorscale: [number, string][] } };
      } | null;
      return gd?._fullLayout?.coloraxis?.colorscale[0][1] ?? null;
    });
  const saved = () => page.evaluate(() => localStorage.getItem("plot-states-storage") ?? "");
  const VIRIDIS = "#440154";
  const PLASMA = "#0d0887";

  await page.locator("[data-plot-id]").hover();
  await page.getByRole("button", { name: "Edit appearance" }).first().click();
  await expect.poll(firstColour).toBe(VIRIDIS);

  // Hover previews Plasma without persisting it.
  await page.getByRole("button", { name: "Heatmap colorscale" }).click();
  await page.getByRole("option", { name: "Plasma", exact: true }).first().hover();
  await expect.poll(firstColour).toBe(PLASMA);
  expect(await saved()).not.toContain("plasma");

  // Escape cancels the preview.
  await page.keyboard.press("Escape");
  await expect.poll(firstColour).toBe(VIRIDIS);

  // Keyboard navigation previews options; Enter applies the selection.
  await page.getByRole("button", { name: "Heatmap colorscale" }).focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await expect.poll(firstColour).not.toBe(VIRIDIS);
  expect(await saved()).not.toContain("colorscale");
  await page.keyboard.press("Enter");
  await expect.poll(saved).toContain("colorscale");
});

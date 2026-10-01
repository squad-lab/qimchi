import type { Page } from "@playwright/test";

import { expect, test } from "./coverage";
import { heatmapState, mockLiveHeatmapApi } from "./liveHeatmap";

type Preset = {
  id: number;
  name: string;
  filters: { name: string; options?: unknown }[];
  updatedAt: string;
};

// In-memory /library/filter-presets API with an available database.
async function mockPresetsApi(page: Page) {
  const state = { presets: [] as Preset[], nextId: 1, requests: [] as string[] };
  await page.route("**/health", (route) =>
    route.fulfill({ json: { ok: true, dbReady: true, dbError: null } }),
  );
  await page.route("**/library/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    if (!url.pathname.startsWith("/library/filter-presets")) {
      const list = url.pathname.endsWith("/states") || url.pathname.endsWith("/tags");
      await route.fulfill({ json: list ? [] : { uuid: null, hearted: false, trashed: false } });
      return;
    }
    state.requests.push(method);
    const id = Number(url.pathname.split("/").pop());
    const now = new Date().toISOString();
    if (method === "GET") {
      await route.fulfill({ json: state.presets });
    } else if (method === "POST") {
      const body = request.postDataJSON();
      if (state.presets.some((preset) => preset.name === body.name)) {
        await route.fulfill({
          status: 409,
          json: { detail: `A preset named '${body.name}' already exists` },
        });
        return;
      }
      const preset = { id: state.nextId++, updatedAt: now, ...body };
      state.presets.push(preset);
      await route.fulfill({ json: preset });
    } else if (method === "PATCH") {
      const preset = state.presets.find((item) => item.id === id)!;
      Object.assign(preset, request.postDataJSON(), { updatedAt: now });
      await route.fulfill({ json: preset });
    } else if (method === "DELETE") {
      state.presets = state.presets.filter((item) => item.id !== id);
      await route.fulfill({ json: { deleted: id } });
    }
  });
  return state;
}

test("a preset stays linked to the plot's filters until it is explicitly let go", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1600, height: 1000 });
  const heatmap = await mockLiveHeatmapApi(page);
  const presets = await mockPresetsApi(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Live Measurements" }).click();
  // Move the rail tooltip away from the measurement.
  await page.mouse.move(800, 800);
  await page.getByText("live-heat", { exact: true }).dblclick();
  await expect.poll(() => heatmapState(page)).not.toBeNull();

  const openFilters = () => page.getByRole("button", { name: "Edit filters" }).first().click();
  await openFilters();
  const panel = page.locator('[data-tour="filters-panel"]');
  const tab = (name: RegExp | string) => panel.getByRole("tab", { name }).click();
  const applyFilter = async (name: string) => {
    await tab(name);
    await panel.getByText("Apply", { exact: true }).click();
  };
  const remove = (name: string) => panel.getByRole("button", { name: `Remove ${name}` }).click();
  const linked = panel.getByRole("region", { name: "Linked preset" });
  const lastOrder = () => heatmap.transformRequests.at(-1)?.filters_order;

  // Saving also links the filters to the new preset.
  await applyFilter("Diff along Y");
  await tab(/^Applied/);
  await panel.getByRole("button", { name: "Save as preset" }).click();
  await panel.getByLabel("Preset name").fill("Derivative");
  await panel.getByRole("button", { name: "Save", exact: true }).click();
  await expect(linked).toContainText("Derivative");
  await expect(linked).toContainText("Matches");
  expect(presets.presets[0].filters.map((f) => f.name)).toEqual(["diff_x"]);

  // The link persists after closing the panel.
  await page.getByRole("button", { name: "Close modal" }).first().click();
  await openFilters();
  await tab(/^Applied/);
  await expect(linked).toContainText("Derivative");

  // Edits are listed and require confirmation before saving.
  await applyFilter("Flip Heatmap");
  await tab(/^Applied/);
  await expect(linked).toContainText("Edited");
  await expect(linked).toContainText("Added Flip Heatmap");
  await linked.getByRole("button", { name: "Update “Derivative”" }).click();
  await expect(linked).toContainText("Diff along Y → Flip Heatmap");
  if (process.env.SHOT_DIR) await panel.screenshot({ path: `${process.env.SHOT_DIR}/p-ask.png` });
  await linked.getByRole("button", { name: "Replace" }).click();
  await expect
    .poll(() => presets.presets[0].filters.map((f) => f.name))
    .toEqual(["diff_x", "flip"]);
  await expect(linked).toContainText("Matches");

  // Revert restores the saved filters.
  await remove("Flip Heatmap");
  await expect(linked).toContainText("Removed Flip Heatmap");
  await linked.getByRole("button", { name: "Revert" }).click();
  await expect.poll(lastOrder).toEqual(["diff_x", "flip"]);
  await expect(linked).toContainText("Matches");

  // Clearing all filters removes the preset link.
  await remove("Diff along Y");
  await remove("Flip Heatmap");
  await expect(panel.getByText(/No filters applied/)).toBeVisible();
  await applyFilter("Normalize");
  await tab(/^Applied/);
  await expect(linked).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "Save as preset" })).toBeVisible();

  // Replace a preset after confirmation.
  await tab(/^Saved Presets/);
  const row = panel.getByRole("listitem").filter({ hasText: "Derivative" });
  await expect(row).not.toContainText("Applied");
  await row
    .getByRole("button", { name: "Replace preset Derivative with the current filters" })
    .click();
  if (process.env.SHOT_DIR)
    await panel.screenshot({ path: `${process.env.SHOT_DIR}/p-replace.png` });
  await row.getByRole("button", { name: "Replace", exact: true }).click();
  await expect.poll(() => presets.presets[0].filters.map((f) => f.name)).toEqual(["normalize"]);
  await expect(row).toContainText("Applied");

  // Reject duplicate names.
  await panel.getByRole("button", { name: "Save current filters as preset" }).click();
  await panel.getByLabel("Preset name").fill("Derivative");
  await panel.getByRole("button", { name: "Save", exact: true }).click();
  await expect(panel.getByRole("alert")).toContainText("already exists");
  await panel.getByRole("button", { name: "Cancel" }).click();

  await row.getByRole("button", { name: "Rename preset Derivative" }).click();
  await panel.getByLabel("Rename preset Derivative").fill("Normalised");
  await panel.getByRole("button", { name: "Rename", exact: true }).click();
  const renamed = panel.getByRole("listitem").filter({ hasText: "Normalised" });
  await expect(renamed).toContainText("Applied");
  if (process.env.SHOT_DIR) await panel.screenshot({ path: `${process.env.SHOT_DIR}/p-list.png` });

  // Removing a preset unlinks its plots.
  await renamed.getByRole("button", { name: "Remove preset Normalised" }).click();
  await renamed.getByRole("button", { name: "Remove", exact: true }).click();
  await expect.poll(() => presets.presets.length).toBe(0);
  await expect(panel.getByText(/No presets yet/)).toBeVisible();
  await tab(/^Applied/);
  await expect(linked).toHaveCount(0);
});

test("updating a preset after a settings change names the setting, not the order", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await mockLiveHeatmapApi(page);
  const presets = await mockPresetsApi(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Live Measurements" }).click();
  await page.mouse.move(800, 800);
  await page.getByText("live-heat", { exact: true }).dblclick();
  await expect.poll(() => heatmapState(page)).not.toBeNull();

  await page.getByRole("button", { name: "Edit filters" }).first().click();
  const panel = page.locator('[data-tour="filters-panel"]');
  await panel.getByRole("tab", { name: "R_in Correction" }).click();
  await panel.getByText("Apply", { exact: true }).click();
  await panel.getByRole("tab", { name: /^Applied/ }).click();
  await panel.getByRole("button", { name: "Save as preset" }).click();
  await panel.getByLabel("Preset name").fill("Bias");
  await panel.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => presets.presets.length).toBe(1);

  await panel.getByRole("tab", { name: "R_in Correction" }).click();
  await panel.getByLabel("Inline resistance", { exact: true }).fill("12");
  await panel.getByRole("tab", { name: /^Saved Presets/ }).click();
  const row = panel.getByRole("listitem").filter({ hasText: "Bias" });
  await row.getByRole("button", { name: "Replace preset Bias with the current filters" }).click();

  // The filters and their order are unchanged, so only the setting is shown.
  await expect(row.getByRole("list", { name: "What changes" })).toHaveText(
    "Changed R_in Correction: r_in 0 → 12",
  );
  await expect(row.getByText("Now", { exact: true })).toHaveCount(0);
  await row.getByRole("button", { name: "Replace", exact: true }).click();
  await expect.poll(() => presets.presets[0].filters[0].options).toMatchObject({ r_in: 12 });
});

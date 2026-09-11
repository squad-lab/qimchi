import type { Page } from "@playwright/test";

import { expect, test } from "./coverage";

const liveMeasurement = (id: string) => ({
  id,
  name: id,
  path: `memory://${id}`,
  type: "file",
  timestamp: "2026-09-09T09:00:00Z",
  tags: ["live", "zarr"],
});

async function mockLiveApi(page: Page) {
  const state = {
    measurements: [liveMeasurement("live-one"), liveMeasurement("live-two")],
  };

  await page.route("**/*", async (route) => {
    const path = new URL(route.request().url()).pathname;

    if (path === "/health") {
      await route.fulfill({ json: { ok: true, dbReady: false, dbError: "disabled in test" } });
    } else if (path === "/load/") {
      await route.fulfill({
        json: [
          {
            id: "saved-run",
            name: "saved-run.zarr",
            path: "C:\\measurements\\saved-run.zarr",
            type: "file",
            tags: ["zarr"],
          },
        ],
      });
    } else if (path === "/load-live/") {
      await route.fulfill({
        json: {
          success: true,
          children: state.measurements,
          count: state.measurements.length,
        },
      });
    } else {
      await route.fallback();
    }
  });

  return state;
}

test("hides, restores, and eventually forgets live measurement dismissals", async ({ page }) => {
  const state = await mockLiveApi(page);
  await page.goto("/");

  await page.getByPlaceholder("Enter folder path").fill("C:\\measurements");
  await page.getByTitle("Load folder").click();
  await expect(page.getByText("saved-run.zarr", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Live Measurements" }).click();
  await expect(page.getByText("live-one", { exact: true })).toBeVisible();
  await expect(page.getByText("live-two", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Hide live-one from Live Measurements" }).click();
  await expect(page.getByText("live-one", { exact: true })).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Restore hidden live measurements" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText("live-one", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Hide live-one from Live Measurements" }).click();

  // Polling and a full reload must not bring an ignored ongoing run back.
  await page.waitForTimeout(1_100);
  await expect(page.getByText("live-one", { exact: true })).toBeHidden();
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByText("live-one", { exact: true })).toBeHidden();

  await page.getByRole("button", { name: "Restore hidden live measurements" }).click();
  await expect(page.getByText("live-one", { exact: true })).toBeVisible();

  // Once the backend stops reporting the run, its persisted dismissal is
  // pruned instead of being inherited by a future registration.
  await page.getByRole("button", { name: "Hide live-one from Live Measurements" }).click();
  state.measurements = [liveMeasurement("live-two")];
  await expect(page.getByRole("button", { name: "Restore hidden live measurements" })).toBeHidden({
    timeout: 2_500,
  });
});

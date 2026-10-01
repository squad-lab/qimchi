import type { Page } from "@playwright/test";

import { expect, test } from "./coverage";
import { mockLiveHeatmapApi } from "./liveHeatmap";
import { mockSettingsApi } from "./settingsMock";

async function openDeveloperSettings(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  await settings.getByRole("button", { name: "Developer", exact: true }).click();
  return settings;
}

test("a browser includes recent crash reports by default", async ({ page }) => {
  await mockLiveHeatmapApi(page);
  await mockSettingsApi(page);
  const requests: unknown[] = [];
  await page.route("**/diagnostics/bundle", async (route) => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({
      body: Buffer.from("PK\u0005\u0006" + "\u0000".repeat(18)),
      headers: {
        "content-type": "application/zip",
        "content-disposition": 'attachment; filename="qimchi-logs-20260930.zip"',
      },
    });
  });

  const settings = await openDeveloperSettings(page);
  await expect(settings.getByLabel(/Include recent crash reports/)).toBeChecked();
  const download = page.waitForEvent("download");
  await settings.getByRole("button", { name: "Save logs", exact: true }).click();

  expect((await download).suggestedFilename()).toBe("qimchi-logs-20260930.zip");
  expect(requests).toEqual([{ include_crash_reports: true }]);
  await expect(settings.getByText("Downloaded the logs.")).toBeVisible();
});

test("the desktop app saves the bundle and can show it in its folder", async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __revealed: string[]; pywebview: unknown };
    w.__revealed = [];
    w.pywebview = {
      api: {
        open_folder_dialog: async () => "",
        open_log_terminal: async () => true,
        save_text_file: async () => "",
        reveal_file: async (path: string) => {
          w.__revealed.push(path);
          return true;
        },
      },
    };
  });
  await mockLiveHeatmapApi(page);
  await mockSettingsApi(page);
  const saved = String.raw`C:\Users\me\Downloads\qimchi-logs-20260930.zip`;
  await page.route("**/diagnostics/bundle", (route) =>
    route.fulfill({ json: { path: saved, logs: ["qimchi.log"], crash_reports: [] } }),
  );

  const settings = await openDeveloperSettings(page);
  await settings.getByRole("button", { name: "Save logs", exact: true }).click();
  await expect(settings.getByText(saved)).toBeVisible();
  await settings.getByRole("button", { name: "Show in folder" }).click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __revealed: string[] }).__revealed))
    .toEqual([saved]);
});

test("the bug-report button opens instructions and log collection", async ({ page }) => {
  await mockLiveHeatmapApi(page);
  await mockSettingsApi(page, { general: { theme: "dark" } });
  await page.route("**/diagnostics/bundle", (route) =>
    route.fulfill({
      body: Buffer.from("PK\u0005\u0006" + "\u0000".repeat(18)),
      headers: {
        "content-type": "application/zip",
        "content-disposition": 'attachment; filename="qimchi-logs.zip"',
      },
    }),
  );
  await page.goto("/");

  await page.getByRole("button", { name: "Report a bug" }).click();
  const dialog = page.getByRole("dialog", { name: "Report a bug" });
  await expect(dialog.getByRole("button", { name: "Save logs", exact: true })).toBeVisible();
  await expect(dialog.getByLabel(/Include recent crash reports/)).toBeChecked();
  await expect(dialog).toContainText("Attach the logs zip to the issue.");
  await expect(dialog).toContainText("steps to reproduce");
  await expect
    .poll(async () => {
      const sizes = await Promise.all(
        [
          dialog.getByText("Reproduce the problem, then save the logs below."),
          dialog.getByText("Creates one zip file to attach to a bug report. It includes:"),
          dialog.locator("label").filter({ hasText: "Include recent crash reports" }),
        ].map((locator) => locator.evaluate((node) => getComputedStyle(node).fontSize)),
      );
      return new Set(sizes).size;
    })
    .toBe(1);
  await expect
    .poll(() => dialog.evaluate((node) => getComputedStyle(node).backgroundColor))
    .toBe("rgb(40, 44, 52)");
  const issueLink = dialog.getByRole("link", { name: "Open a new GitLab issue" });
  await expect(issueLink).toHaveAttribute("aria-disabled", "true");
  await expect(issueLink).toHaveAttribute("href", /gitlab\.com\/squad-lab\/qimchi\/.+new/);

  const download = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Save logs", exact: true }).click();
  await download;
  await expect(issueLink).toHaveAttribute("aria-disabled", "false");

  await page.getByTestId("bug-report-backdrop").click({ position: { x: 2, y: 2 } });
  await expect(dialog).toHaveCount(0);
});

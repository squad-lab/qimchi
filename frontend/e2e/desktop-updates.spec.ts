import type { Page } from "@playwright/test";

import { expect, test } from "./coverage";
import { mockLiveHeatmapApi } from "./liveHeatmap";
import { mockSettingsApi } from "./settingsMock";

// A stand-in for the desktop launcher's update API: the page only ever sees
// these calls and the `qimchi-update` events they cause.
async function fakeDesktopUpdater(page: Page, initial: Record<string, unknown>) {
  await page.addInitScript((start) => {
    const calls: string[] = [];
    let state = {
      status: "idle",
      current: "v0.7.0-rc.8",
      tag: null,
      notes: "",
      platform: "windows",
      progress: 0,
      error: null,
      prompt: null,
      checkedAt: null,
      ...start,
    };
    const push = (changes: Record<string, unknown>) => {
      state = { ...state, ...changes };
      window.dispatchEvent(new CustomEvent("qimchi-update", { detail: state }));
      return state;
    };
    const w = window as any;
    w.__updateCalls = calls;
    w.__pushUpdate = push;
    w.pywebview = {
      api: {
        open_folder_dialog: async () => "",
        open_log_terminal: async () => true,
        save_text_file: async () => "",
        update_status: async () => state,
        check_for_updates: async () => {
          calls.push("check");
          return push({ status: "available", tag: "v0.7.0-rc.9", notes: "Release notes" });
        },
        download_update: async () => {
          calls.push("download");
          return push({ status: "downloading", progress: 0, prompt: null });
        },
        install_update: async () => {
          calls.push("install");
          return push({ status: "installing", prompt: null });
        },
        remind_update_at_next_launch: async () => {
          calls.push("remind");
          return push({ prompt: null });
        },
        dismiss_update_prompt: async () => {
          calls.push("dismiss");
          return push({ prompt: null });
        },
      },
    };
  }, initial);
}

const calls = (page: Page) => page.evaluate(() => (window as any).__updateCalls as string[]);
const push = (page: Page, changes: Record<string, unknown>) =>
  page.evaluate((c) => (window as any).__pushUpdate(c), changes);

test.beforeEach(async ({ page }) => {
  await mockLiveHeatmapApi(page);
  await mockSettingsApi(page);
});

test("an update downloads in the background and asks to install when ready", async ({ page }) => {
  await fakeDesktopUpdater(page, {
    status: "available",
    tag: "v0.7.0-rc.9",
    notes: "# Qimchi v0.7.0-rc.9",
    prompt: "available",
  });
  await page.goto("/");

  const dialog = page.getByRole("dialog", { name: "Qimchi v0.7.0-rc.9 is available" });
  await expect(dialog).toContainText("You are running v0.7.0-rc.8");
  await dialog.getByRole("button", { name: "Download in background" }).click();
  await expect(dialog).toHaveCount(0);

  // The app stays usable while it downloads; the rail shows the progress.
  await push(page, { progress: 0.42 });
  await expect(page.getByRole("button", { name: "Downloading update, 42%" })).toBeVisible();
  await page.getByRole("button", { name: "Live Measurements" }).click();
  await expect(page.getByText("live-heat", { exact: true })).toBeVisible();

  await push(page, { status: "downloaded", progress: 1, prompt: "ready" });
  const ready = page.getByRole("dialog", { name: "Qimchi v0.7.0-rc.9 is ready to install" });
  await ready.getByRole("button", { name: "Remind me at next launch" }).click();
  await expect(ready).toHaveCount(0);

  // The rail keeps the downloaded update one click away.
  await page.getByRole("button", { name: "Install downloaded update" }).click();
  await ready.getByRole("button", { name: "Install now" }).click();
  await expect.poll(() => calls(page)).toEqual(["download", "remind", "install"]);
});

test("Settings > Updates checks, downloads and installs on demand", async ({ page }) => {
  await fakeDesktopUpdater(page, {});
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  await settings.getByRole("button", { name: "Updates", exact: true }).click();

  await expect(settings.getByText("Qimchi v0.7.0-rc.8")).toBeVisible();
  await settings.getByRole("button", { name: "Check for updates" }).click();
  await expect(settings.getByText("Qimchi v0.7.0-rc.9 is available.")).toBeVisible();
  // A manual check does not pop the dialog up over Settings.
  await expect(page.getByRole("dialog", { name: /is available/ })).toHaveCount(0);

  await settings.getByRole("button", { name: "Download", exact: true }).click();
  await push(page, { progress: 0.5 });
  await expect(settings.getByRole("progressbar", { name: "Update download" })).toHaveAttribute(
    "aria-valuenow",
    "50",
  );

  await push(page, { status: "downloaded", progress: 1 });
  await settings.getByRole("button", { name: "Install now" }).click();
  await expect.poll(() => calls(page)).toEqual(["check", "download", "install"]);
  await expect(settings.getByLabel("Check for updates at startup")).toBeChecked();
});

test("the browser build has no Updates section", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  await expect(settings.getByRole("button", { name: "General", exact: true })).toBeVisible();
  await expect(settings.getByRole("button", { name: "Updates", exact: true })).toHaveCount(0);
});

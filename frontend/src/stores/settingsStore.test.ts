import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  getSettings: vi.fn(),
  patchSettings: vi.fn(),
  replaceSettings: vi.fn(),
  resetSettings: vi.fn(),
}));

vi.mock("../services/settingsAPI", () => ({
  ...api,
  settingsErrorMessage: (error: unknown) => (error as Error).message,
}));

import { resetSettingsQueueForTests, useSettingsStore } from "./settingsStore";
import { resolveSettings } from "../settings/userSettings";

beforeEach(() => {
  vi.useFakeTimers();
  resetSettingsQueueForTests();
  useSettingsStore.setState({
    stored: {},
    settings: resolveSettings({}),
    available: true,
    unavailableReason: null,
    saveError: null,
  });
  api.patchSettings.mockImplementation(async (patch: Record<string, unknown>) => ({
    settings: patch,
    updatedAt: null,
  }));
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("settingsStore", () => {
  it("applies a change at once and sends quick successive changes together", async () => {
    const { update } = useSettingsStore.getState();

    update(["general", "zoom"], 1.1);
    update(["general", "zoom"], 1.25);
    update(["general", "plotWidth"], 66);
    expect(useSettingsStore.getState().settings.general.zoom).toBe(1.25);
    expect(api.patchSettings).not.toHaveBeenCalled();

    await vi.runAllTimersAsync();

    expect(api.patchSettings).toHaveBeenCalledTimes(1);
    expect(api.patchSettings).toHaveBeenCalledWith({ general: { zoom: 1.25, plotWidth: 66 } });
  });

  it("does not let a load overwrite a change that is still being saved", async () => {
    api.getSettings.mockResolvedValue({ settings: {}, updatedAt: null });

    useSettingsStore.getState().update(["general", "theme"], "dark");
    await useSettingsStore.getState().load();

    expect(api.getSettings).not.toHaveBeenCalled();
    expect(useSettingsStore.getState().settings.general.theme).toBe("dark");
  });

  it("keeps a change locally and reports once when the database is down", async () => {
    api.patchSettings.mockRejectedValue(new Error("disk full"));
    const { update } = useSettingsStore.getState();

    update(["general", "theme"], "dark");
    await vi.runAllTimersAsync();
    expect(useSettingsStore.getState()).toMatchObject({
      available: false,
      saveError: "disk full",
    });
    expect(useSettingsStore.getState().settings.general.theme).toBe("dark");

    useSettingsStore.getState().clearSaveError();
    update(["general", "zoom"], 1.5);
    await vi.runAllTimersAsync();
    expect(useSettingsStore.getState().saveError).toBeNull();
  });

  it("takes the server's copy on load", async () => {
    api.getSettings.mockResolvedValue({ settings: { general: { zoom: 2 } }, updatedAt: null });

    await useSettingsStore.getState().load();

    expect(useSettingsStore.getState().settings.general.zoom).toBe(2);
  });

  it("imports a file in place of unsent changes, keeping only valid non-default values", async () => {
    api.replaceSettings.mockImplementation(async (document: Record<string, unknown>) => ({
      settings: document,
      updatedAt: null,
    }));
    const { update, replaceAll } = useSettingsStore.getState();

    update(["general", "zoom"], 1.5);
    await replaceAll({ general: { theme: "dark", zoom: 1, plotWidth: 7 }, unknown: true });
    await vi.runAllTimersAsync();

    expect(api.patchSettings).not.toHaveBeenCalled();
    expect(api.replaceSettings).toHaveBeenCalledWith({ general: { theme: "dark" } });
    expect(useSettingsStore.getState().stored).toEqual({ general: { theme: "dark" } });
    expect(useSettingsStore.getState().settings.general.zoom).toBe(1);
  });

  it("reports a failed restore of all defaults", async () => {
    api.resetSettings.mockRejectedValue(new Error("read-only"));
    useSettingsStore.setState({ stored: { general: { theme: "dark" } } });

    await useSettingsStore.getState().resetAll();

    expect(useSettingsStore.getState()).toMatchObject({
      stored: {},
      available: false,
      unavailableReason: "read-only",
      saveError: "read-only",
    });
  });
});

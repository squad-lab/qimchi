import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/settingsAPI", () => ({
  getSettings: vi.fn(),
  patchSettings: vi.fn(async (patch: Record<string, unknown>) => ({
    settings: patch,
    updatedAt: null,
  })),
  resetSettings: vi.fn(),
  settingsErrorMessage: () => "offline",
}));

import { useSettingsStore } from "./settingsStore";
import { useThemeStore } from "./themeStore";

beforeEach(() => {
  useSettingsStore.getState().update(["general", "theme"], "light");
});

describe("themeStore", () => {
  it("toggles between the two themes", () => {
    useThemeStore.getState().toggleTheme();
    expect(useThemeStore.getState().theme).toBe("dark");

    useThemeStore.getState().toggleTheme();
    expect(useThemeStore.getState().theme).toBe("light");
  });

  it("sets a theme directly", () => {
    useThemeStore.getState().setTheme("dark");
    expect(useThemeStore.getState().theme).toBe("dark");

    // Setting the theme it already has is not a toggle.
    useThemeStore.getState().setTheme("dark");
    expect(useThemeStore.getState().theme).toBe("dark");
  });

  it("saves the choice as a user setting", () => {
    useThemeStore.getState().setTheme("dark");

    expect(useSettingsStore.getState().settings.general.theme).toBe("dark");
  });
});

import { beforeEach, describe, expect, it } from "vitest";

import { useThemeStore } from "./themeStore";

beforeEach(() => {
  useThemeStore.setState({ theme: "light" });
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

  it("persists the choice under its own key", () => {
    useThemeStore.getState().setTheme("dark");

    expect(JSON.parse(localStorage.getItem("theme-store") ?? "{}").state.theme).toBe("dark");
  });
});

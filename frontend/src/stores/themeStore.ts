import { create } from "zustand";

import { resolveTheme } from "../settings/userSettings";
import { useSettingsStore } from "./settingsStore";

export type AppTheme = "light" | "dark";

interface ThemeState {
  /** The theme in effect, with "system" already resolved. */
  theme: AppTheme;
  setTheme: (theme: AppTheme) => void;
  toggleTheme: () => void;
}

// The preference lives in the user's settings; this store only resolves it,
// so the many components that read the theme need not know about settings.
const effectiveTheme = () => resolveTheme(useSettingsStore.getState().settings.general.theme);

export const useThemeStore = create<ThemeState>()((_set, get) => ({
  theme: effectiveTheme(),

  setTheme: (theme) => useSettingsStore.getState().update(["general", "theme"], theme),

  toggleTheme: () => get().setTheme(get().theme === "dark" ? "light" : "dark"),
}));

const syncTheme = () => {
  const theme = effectiveTheme();
  if (useThemeStore.getState().theme !== theme) useThemeStore.setState({ theme });
};

useSettingsStore.subscribe(syncTheme);
if (typeof window !== "undefined") {
  window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener?.("change", syncTheme);
}

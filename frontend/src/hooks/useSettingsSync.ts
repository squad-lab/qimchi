import { useEffect } from "react";

import { useSettingsStore } from "../stores/settingsStore";
import { useToast } from "./useToast";

// Theme and zoom were kept in the browser before settings moved to the
// database. Carried over once, so an upgrade keeps the user's choice.
const LEGACY_SEEDED_KEY = "qimchi-settings-seeded";

const readLegacy = (key: string): Record<string, unknown> | null => {
  try {
    const raw = localStorage.getItem(key);
    const state = raw ? JSON.parse(raw)?.state : null;
    return state && typeof state === "object" ? state : null;
  } catch {
    return null;
  }
};

const seedLegacyPreferences = () => {
  try {
    if (localStorage.getItem(LEGACY_SEEDED_KEY)) return;
    localStorage.setItem(LEGACY_SEEDED_KEY, "1");
  } catch {
    return;
  }
  const { stored, update } = useSettingsStore.getState();
  const general = (stored.general ?? {}) as Record<string, unknown>;
  const theme = readLegacy("theme-store")?.theme;
  if (general.theme === undefined && (theme === "light" || theme === "dark")) {
    update(["general", "theme"], theme);
  }
  const zoom = readLegacy("sidebar-store")?.zoomLevel;
  if (general.zoom === undefined && typeof zoom === "number" && zoom !== 1) {
    update(["general", "zoom"], zoom);
  }
};

/**
 * Keep the settings in step with the database: load them on start, reload when
 * the window regains focus (another client may have changed them), and report
 * a save that did not go through.
 */
export const useSettingsSync = () => {
  const { showToast } = useToast();
  const saveError = useSettingsStore((state) => state.saveError);

  useEffect(() => {
    const store = useSettingsStore.getState();
    void store.load().then(() => {
      if (useSettingsStore.getState().available) seedLegacyPreferences();
    });

    const reload = () => {
      if (document.visibilityState === "visible") void useSettingsStore.getState().load();
    };
    window.addEventListener("focus", reload);
    document.addEventListener("visibilitychange", reload);
    return () => {
      window.removeEventListener("focus", reload);
      document.removeEventListener("visibilitychange", reload);
    };
  }, []);

  useEffect(() => {
    if (!saveError) return;
    showToast(`Settings were not saved: ${saveError}`, "error", 6000, "Settings");
    useSettingsStore.getState().clearSaveError();
  }, [saveError, showToast]);
};

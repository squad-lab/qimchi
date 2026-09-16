import { create } from "zustand";
import { persist } from "zustand/middleware";

import {
  getSettings,
  patchSettings,
  resetSettings,
  settingsErrorMessage,
  type StoredSettings,
} from "../services/settingsAPI";
import { applyPatch, patchFor, resolveSettings, type UserSettings } from "../settings/userSettings";

type Json = Record<string, unknown>;

interface SettingsState {
  /** The stored document: only the values that differ from the defaults. */
  stored: Json;
  /** The effective settings every consumer reads. */
  settings: UserSettings;
  /** False while the database cannot be reached; changes then stay local. */
  available: boolean;
  unavailableReason: string | null;
  /** A save that failed while the database was thought reachable, reported once. */
  saveError: string | null;
  load: () => Promise<void>;
  update: (path: string[], value: unknown) => void;
  resetAll: () => Promise<void>;
  clearSaveError: () => void;
}

// Writes run one after another, so an older response never lands after a
// newer one. A load while writes are pending is skipped for the same reason.
let writeQueue: Promise<void> = Promise.resolve();
let pendingWrites = 0;

// Changes arriving in quick succession (a slider being dragged) are sent as one.
const FLUSH_DELAY_MS = 250;
let pendingPatch: Json = {};
let flushTimer: ReturnType<typeof setTimeout> | null = null;

const isObject = (value: unknown): value is Json =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const mergePatches = (earlier: Json, later: Json): Json => {
  const out: Json = { ...earlier };
  for (const [key, value] of Object.entries(later)) {
    out[key] =
      isObject(value) && isObject(out[key]) ? mergePatches(out[key] as Json, value) : value;
  }
  return out;
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => {
      // Swap the whole document: drop any unsent changes, show the new one at
      // once, and let the server's answer settle it.
      const replaceWith = async (stored: Json, request: () => Promise<StoredSettings>) => {
        if (flushTimer) {
          clearTimeout(flushTimer);
          flushTimer = null;
          pendingPatch = {};
          pendingWrites -= 1;
        }
        set({ stored, settings: resolveSettings(stored) });
        pendingWrites += 1;
        await writeQueue;
        try {
          const { settings } = await request();
          pendingWrites -= 1;
          set({
            available: true,
            unavailableReason: null,
            ...(pendingWrites === 0
              ? { stored: settings, settings: resolveSettings(settings) }
              : {}),
          });
        } catch (error) {
          pendingWrites -= 1;
          const reason = settingsErrorMessage(error);
          set({
            available: false,
            unavailableReason: reason,
            saveError: get().available ? reason : null,
          });
        }
      };

      return {
        stored: {},
        settings: resolveSettings({}),
        available: true,
        unavailableReason: null,
        saveError: null,

        load: async () => {
          if (pendingWrites > 0) return;
          try {
            const { settings } = await getSettings();
            if (pendingWrites > 0) return;
            set({
              stored: settings,
              settings: resolveSettings(settings),
              available: true,
              unavailableReason: null,
            });
          } catch (error) {
            set({ available: false, unavailableReason: settingsErrorMessage(error) });
          }
        },

        update: (path, value) => {
          const patch = patchFor(path, value);
          const stored = applyPatch(get().stored, patch);
          set({ stored, settings: resolveSettings(stored) });

          const send = async (batch: Json) => {
            try {
              const response = await patchSettings(batch);
              pendingWrites -= 1;
              const settled = pendingWrites === 0;
              set({
                available: true,
                unavailableReason: null,
                ...(settled
                  ? { stored: response.settings, settings: resolveSettings(response.settings) }
                  : {}),
              });
            } catch (error) {
              pendingWrites -= 1;
              const reason = settingsErrorMessage(error);
              // Report the first failure only; while the database stays down,
              // every later change would otherwise raise the same message.
              set({
                available: false,
                unavailableReason: reason,
                saveError: get().available ? reason : null,
              });
            }
          };

          pendingPatch = mergePatches(pendingPatch, patch);
          if (flushTimer) clearTimeout(flushTimer);
          else pendingWrites += 1;
          flushTimer = setTimeout(() => {
            flushTimer = null;
            const batch = pendingPatch;
            pendingPatch = {};
            writeQueue = writeQueue.then(() => send(batch));
          }, FLUSH_DELAY_MS);
        },

        resetAll: () => replaceWith({}, resetSettings),

        clearSaveError: () => set({ saveError: null }),
      };
    },
    {
      // A local copy so the theme and zoom apply before the server answers.
      // The server's copy always replaces it on load.
      name: "user-settings",
      version: 1,
      partialize: (state) => ({ stored: state.stored }),
      merge: (persisted, current) => {
        const stored = ((persisted as { stored?: Json } | undefined)?.stored ?? {}) as Json;
        return { ...current, stored, settings: resolveSettings(stored) };
      },
    },
  ),
);

/** Test hook: forget queued writes between tests. */
export const resetSettingsQueueForTests = () => {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
  pendingPatch = {};
  writeQueue = Promise.resolve();
  pendingWrites = 0;
};

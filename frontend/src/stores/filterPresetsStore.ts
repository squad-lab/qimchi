import { create } from "zustand";

import {
  createFilterPreset,
  deleteFilterPreset,
  getFilterPresets,
  libraryErrorMessage,
  updateFilterPreset,
  type FilterPreset,
  type PresetFilter,
} from "../services/libraryAPI";
import { usePlotStore } from "./plotStore";

/** Successful preset result or an error message. */
type Result = { preset: FilterPreset; error?: undefined } | { preset?: undefined; error: string };

interface FilterPresetsState {
  /** Null until the first load. */
  presets: FilterPreset[] | null;
  error: string | null;
  load: () => Promise<void>;
  create: (name: string, filters: PresetFilter[]) => Promise<Result>;
  update: (
    id: number,
    changes: { name?: string; filters?: PresetFilter[] },
    failure: string,
  ) => Promise<Result>;
  remove: (id: number) => Promise<string | null>;
}

const byName = (a: FilterPreset, b: FilterPreset) => a.name.localeCompare(b.name);

// Share one load request across open Filters panels.
let loading: Promise<void> | null = null;

/** Filter presets shared by all open Filters panels. */
export const useFilterPresetsStore = create<FilterPresetsState>()((set) => {
  const upsert = (preset: FilterPreset) =>
    set((state) => ({
      presets: [...(state.presets ?? []).filter((p) => p.id !== preset.id), preset].sort(byName),
    }));

  return {
    presets: null,
    error: null,

    load: () => {
      loading ??= getFilterPresets()
        .then((presets) => set({ presets: [...presets].sort(byName), error: null }))
        .catch((error) =>
          set({ error: libraryErrorMessage(error, "Presets could not be loaded.") }),
        )
        .finally(() => {
          loading = null;
        });
      return loading;
    },

    create: async (name, filters) => {
      try {
        const preset = await createFilterPreset(name, filters);
        upsert(preset);
        return { preset };
      } catch (error) {
        return { error: libraryErrorMessage(error, "The preset could not be saved.") };
      }
    },

    update: async (id, changes, failure) => {
      try {
        const preset = await updateFilterPreset(id, changes);
        upsert(preset);
        return { preset };
      } catch (error) {
        return { error: libraryErrorMessage(error, failure) };
      }
    },

    remove: async (id) => {
      try {
        await deleteFilterPreset(id);
        set((state) => ({ presets: (state.presets ?? []).filter((p) => p.id !== id) }));
        // Clear links to the deleted preset.
        usePlotStore.getState().unlinkPreset(id);
        return null;
      } catch (error) {
        return libraryErrorMessage(error, "The preset could not be removed.");
      }
    },
  };
});

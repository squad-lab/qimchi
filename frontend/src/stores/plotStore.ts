import { create } from "zustand";
import { persist } from "zustand/middleware";

// Local imports
import type { AppliedFilter, SliderConfig, PlotPersistentState } from "../components/interfaces";
import { withMarkerSet, type PlotMarker } from "../utils/plotMarkers";

interface PlotStoreState {
  plotStates: Record<string, PlotPersistentState>;
  /** Store the plot's appearance as its differences from the user's defaults. */
  setPlotAppearance: (plotId: string, overrides: Record<string, unknown>) => void;
  /** Set filters; an empty list also clears the preset link. */
  setPlotFilters: (plotId: string, filters: AppliedFilter[]) => void;
  /** Set or clear the plot's preset link. */
  setPlotPresetLink: (plotId: string, presetId: number | null) => void;
  /** Clear a preset link from all plots. */
  unlinkPreset: (presetId: number) => void;
  setPlotSliders: (plotId: string, sliders: Record<string, SliderConfig>) => void;
  setPlotAxesSwapped: (plotId: string, swapped: boolean) => void;
  /** Replace one set of LineCut markers; an empty list removes it. */
  setLineCutMarkers: (plotId: string, key: string, markers: PlotMarker[]) => void;
  getPlotState: (plotId: string) => PlotPersistentState | undefined;
  removePlotState: (plotId: string) => void;
  /** Restore a closed plot's state, clearing any existing state if none was saved. */
  restorePlotState: (plotId: string, state: PlotPersistentState | undefined) => void;
  clearAllStates: () => void;
  /** Remove saved state for plots outside the supplied set. */
  keepOnly: (plotIds: string[]) => void;
}

export const usePlotStore = create<PlotStoreState>()(
  persist(
    (set, get) => ({
      plotStates: {},

      setPlotAppearance: (plotId: string, overrides: Record<string, unknown>) => {
        set((state) => {
          const previous = { ...state.plotStates[plotId] };
          delete previous.appearance_settings;
          return {
            plotStates: {
              ...state.plotStates,
              [plotId]: { ...previous, id: plotId, appearance_overrides: overrides },
            },
          };
        });
      },

      setPlotFilters: (plotId: string, filters: AppliedFilter[]) => {
        set((state) => {
          const next: PlotPersistentState = {
            ...state.plotStates[plotId],
            id: plotId,
            applied_filters: filters,
          };
          // A preset link is invalid without filters.
          if (filters.length === 0) delete next.filter_preset_id;
          return { plotStates: { ...state.plotStates, [plotId]: next } };
        });
      },

      setPlotPresetLink: (plotId: string, presetId: number | null) => {
        set((state) => {
          const next: PlotPersistentState = { ...state.plotStates[plotId], id: plotId };
          if (presetId === null) delete next.filter_preset_id;
          else next.filter_preset_id = presetId;
          return { plotStates: { ...state.plotStates, [plotId]: next } };
        });
      },

      unlinkPreset: (presetId: number) => {
        set((state) => {
          const linked = Object.values(state.plotStates).filter(
            (plot) => plot.filter_preset_id === presetId,
          );
          if (linked.length === 0) return state;
          const plotStates = { ...state.plotStates };
          for (const plot of linked) {
            const next = { ...plot };
            delete next.filter_preset_id;
            plotStates[plot.id] = next;
          }
          return { plotStates };
        });
      },

      setPlotSliders: (plotId: string, sliders: Record<string, SliderConfig>) => {
        set((state) => ({
          plotStates: {
            ...state.plotStates,
            [plotId]: {
              ...state.plotStates[plotId],
              id: plotId,
              slider_settings: sliders,
            },
          },
        }));
      },

      setPlotAxesSwapped: (plotId: string, swapped: boolean) => {
        set((state) => ({
          plotStates: {
            ...state.plotStates,
            [plotId]: {
              ...state.plotStates[plotId],
              id: plotId,
              axes_swapped: swapped,
            },
          },
        }));
      },

      setLineCutMarkers: (plotId: string, key: string, markers: PlotMarker[]) => {
        set((state) => {
          const next: PlotPersistentState = { ...state.plotStates[plotId], id: plotId };
          const sets = withMarkerSet(next.linecut_markers, key, markers);
          if (sets) next.linecut_markers = sets;
          else delete next.linecut_markers;
          return { plotStates: { ...state.plotStates, [plotId]: next } };
        });
      },

      getPlotState: (plotId: string) => {
        return get().plotStates[plotId];
      },

      removePlotState: (plotId: string) => {
        set((state) => {
          const newStates = { ...state.plotStates };
          delete newStates[plotId];
          return { plotStates: newStates };
        });
      },

      restorePlotState: (plotId: string, saved: PlotPersistentState | undefined) => {
        set((state) => {
          const plotStates = { ...state.plotStates };
          if (saved) plotStates[plotId] = { ...saved, id: plotId };
          else delete plotStates[plotId];
          return { plotStates };
        });
      },

      clearAllStates: () => {
        set({ plotStates: {} });
      },

      keepOnly: (plotIds: string[]) => {
        const keep = new Set(plotIds);
        set((state) => ({
          plotStates: Object.fromEntries(
            Object.entries(state.plotStates).filter(([id]) => keep.has(id)),
          ),
        }));
      },
    }),
    {
      name: "plot-states-storage",
      version: 1,
    },
  ),
);

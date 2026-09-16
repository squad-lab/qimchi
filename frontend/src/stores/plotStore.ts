import { create } from "zustand";
import { persist } from "zustand/middleware";

// Local imports
import type { AppliedFilter, SliderConfig, PlotPersistentState } from "../components/interfaces";

interface PlotStoreState {
  plotStates: Record<string, PlotPersistentState>;
  /** Store the plot's appearance as its differences from the user's defaults. */
  setPlotAppearance: (plotId: string, overrides: Record<string, unknown>) => void;
  setPlotFilters: (plotId: string, filters: AppliedFilter[]) => void;
  setPlotSliders: (plotId: string, sliders: Record<string, SliderConfig>) => void;
  setPlotAxesSwapped: (plotId: string, swapped: boolean) => void;
  getPlotState: (plotId: string) => PlotPersistentState | undefined;
  removePlotState: (plotId: string) => void;
  clearAllStates: () => void;
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
        set((state) => ({
          plotStates: {
            ...state.plotStates,
            [plotId]: {
              ...state.plotStates[plotId],
              id: plotId,
              applied_filters: filters,
            },
          },
        }));
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

      clearAllStates: () => {
        set({ plotStates: {} });
      },
    }),
    {
      name: "plot-states-storage",
      version: 1,
    },
  ),
);

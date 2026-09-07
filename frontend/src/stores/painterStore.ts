import { create } from "zustand";

// Local imports
import type { PlotAppearanceSettings } from "../components/types";
import type { AppliedFilter } from "../components/interfaces";

type PainterMode = "none" | "theme" | "filter";

interface PainterState {
  mode: PainterMode;
  sourcePlotId?: string;
  sourcePlotType?: string; // 'line' | 'heatmap'
  sourceAppearance?: PlotAppearanceSettings | null;
  sourceFilters?: AppliedFilter[] | undefined;
  sourceSliders?: Record<string, unknown> | undefined;
  shiftHeld: boolean;
  activateTheme: (
    sourcePlotId: string,
    sourcePlotType: string,
    appearance: PlotAppearanceSettings,
  ) => void;
  activateFilter: (
    sourcePlotId: string,
    sourcePlotType: string,
    filters: AppliedFilter[],
    sliders?: Record<string, unknown>,
  ) => void;
  deactivate: () => void;
  setShiftHeld: (v: boolean) => void;
}

export const usePainterStore = create<PainterState>((set) => ({
  mode: "none",
  sourcePlotId: undefined,
  sourcePlotType: undefined,
  sourceAppearance: null,
  sourceFilters: undefined,
  sourceSliders: undefined,
  shiftHeld: false,

  activateTheme: (sourcePlotId, sourcePlotType, appearance) =>
    set(() => ({
      mode: "theme",
      sourcePlotId,
      sourcePlotType,
      sourceAppearance: appearance,
      sourceFilters: undefined,
      sourceSliders: undefined,
    })),

  activateFilter: (sourcePlotId, sourcePlotType, filters, sliders) =>
    set(() => ({
      mode: "filter",
      sourcePlotId,
      sourcePlotType,
      sourceAppearance: null,
      sourceFilters: filters,
      sourceSliders: sliders,
    })),

  deactivate: () =>
    set(() => ({
      mode: "none",
      sourcePlotId: undefined,
      sourcePlotType: undefined,
      sourceAppearance: null,
      sourceFilters: undefined,
      sourceSliders: undefined,
    })),

  setShiftHeld: (v: boolean) =>
    set(() => {
      if (!v) {
        return {
          shiftHeld: false,
          mode: "none",
          sourcePlotId: undefined,
          sourcePlotType: undefined,
          sourceAppearance: null,
          sourceFilters: undefined,
          sourceSliders: undefined,
        } as PainterState;
      }
      return { shiftHeld: true } as Partial<PainterState> as PainterState;
    }),
}));

export default usePainterStore;

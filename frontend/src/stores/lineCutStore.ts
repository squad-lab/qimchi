import { create } from "zustand";

/** Identifies the single plot that owns LineCut and its global shortcuts. */
interface LineCutState {
  activePlotId: string | null;
  setActivePlot: (id: string | null) => void;
}

export const useLineCutStore = create<LineCutState>()((set) => ({
  activePlotId: null,
  setActivePlot: (id) => set({ activePlotId: id }),
}));

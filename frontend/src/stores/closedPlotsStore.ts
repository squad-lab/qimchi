import { create } from "zustand";

import type { PlotConfiguration, PlotPersistentState } from "../components/interfaces";
import { readSessionValue, SESSION_KEYS, writeSessionValue } from "../utils/sessionRestore";
import { useSettingsStore } from "./settingsStore";

/** Maximum retained plots across all close actions, configured in Settings > Plots. */
const limit = () => useSettingsStore.getState().settings.plots.closedPlotsLimit;

/** Configuration, state and position needed to reopen a plot, excluding figure data. */
export interface ClosedPlot {
  config: PlotConfiguration;
  /** Viewer index at the time of closing. */
  index: number;
  state?: PlotPersistentState;
  /** Per-plot width override, if set. */
  width?: number;
  closedAt: number;
}

/** Plots closed together by one action and reopened together by Undo. */
export interface ClosedAction {
  id: string;
  plots: ClosedPlot[];
}

interface ClosedPlotsState {
  /** Newest first. */
  actions: ClosedAction[];
  /** Record a close action and discard the oldest plots beyond the limit. */
  record: (plots: ClosedPlot[]) => string | null;
  /** Remove and return the specified close action, or the newest if no ID is given. */
  take: (actionId?: string) => ClosedAction | null;
  /** Remove and return a plot from its close action. */
  takePlot: (plotId: string) => ClosedPlot | null;
  clear: () => void;
}

/** Label a closed plot by its dependent and independent variables. */
export const closedPlotLabel = (config: PlotConfiguration): string =>
  `${config.deps.join(", ")} vs ${config.indeps.join(", ")}`;

let counter = 0;

const capped = (actions: ClosedAction[], max = limit()): ClosedAction[] => {
  let room = max;
  const kept: ClosedAction[] = [];
  for (const action of actions) {
    if (room <= 0) break;
    const plots = action.plots.slice(0, room);
    room -= plots.length;
    kept.push(plots.length === action.plots.length ? action : { ...action, plots });
  }
  return kept;
};

const isClosedAction = (value: unknown): value is ClosedAction =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as ClosedAction).id === "string" &&
  Array.isArray((value as ClosedAction).plots);

export const useClosedPlotsStore = create<ClosedPlotsState>()((set, get) => ({
  actions: capped(readSessionValue<unknown[]>(SESSION_KEYS.closedPlots, []).filter(isClosedAction)),

  record: (plots) => {
    if (plots.length === 0) return null;
    const id = `closed-${Date.now().toString(36)}-${(counter++).toString(36)}`;
    // Preserve Viewer order when restoring plots from the same action.
    const sorted = [...plots].sort((a, b) => a.index - b.index);
    set((state) => ({ actions: capped([{ id, plots: sorted }, ...state.actions]) }));
    return id;
  },

  take: (actionId) => {
    const { actions } = get();
    const action = actionId ? actions.find((a) => a.id === actionId) : actions[0];
    if (!action) return null;
    set({ actions: actions.filter((a) => a !== action) });
    return action;
  },

  takePlot: (plotId) => {
    const { actions } = get();
    for (const action of actions) {
      const plot = action.plots.find((p) => p.config.id === plotId);
      if (!plot) continue;
      const rest = action.plots.filter((p) => p !== plot);
      set({
        actions: rest.length
          ? actions.map((a) => (a === action ? { ...a, plots: rest } : a))
          : actions.filter((a) => a !== action),
      });
      return plot;
    }
    return null;
  },

  clear: () => set({ actions: [] }),
}));

// Apply a reduced history limit immediately, discarding the oldest plots.
useSettingsStore.subscribe((settings, previous) => {
  const max = settings.settings.plots.closedPlotsLimit;
  if (max === previous.settings.plots.closedPlotsLimit) return;
  const { actions } = useClosedPlotsStore.getState();
  const trimmed = capped(actions, max);
  if (trimmed.some((action, i) => action !== actions[i]) || trimmed.length !== actions.length) {
    useClosedPlotsStore.setState({ actions: trimmed });
  }
});

useClosedPlotsStore.subscribe((state, previous) => {
  if (state.actions !== previous.actions) {
    writeSessionValue(SESSION_KEYS.closedPlots, state.actions);
  }
});

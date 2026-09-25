import { create } from "zustand";

import { useSettingsStore } from "../stores/settingsStore";

import type { BasketItem } from "../components/Basket";
import type { PlotConfiguration } from "../components/interfaces";
import type { DemoFiles, LiveDemo } from "../services/demoAPI";

/** Callbacks registered by the mounted App and Viewer for basket and plot state. */
export interface WalkthroughBridge {
  /** Add a measurement to the Basket and load its variables. */
  addToBasket: (item: BasketItem) => void;
  basketItems: () => BasketItem[];
  removeFromBasket: (id: string) => void;
  clearBasket: () => void;
  plots: () => PlotConfiguration[];
  addPlot: (config: Omit<PlotConfiguration, "id">) => void;
  removePlot: (id: string) => void;
  clearPlots: () => void;
  clearComposer: () => void;
}

interface ExplorerLocation {
  path: string;
  submittedPath: string;
}

interface WalkthroughState {
  active: boolean;
  stepIndex: number;
  /** Whether the final cleanup prompt is open. */
  closing: boolean;
  /** Whether the walkthrough is temporarily hidden without resetting its step. */
  paused: boolean;
  setPaused: (paused: boolean) => void;
  /** Whether navigation to the current step was backward. */
  cameBack: boolean;
  demo: DemoFiles | null;
  live: LiveDemo | null;
  /** Explorer location saved before opening the demo folder. */
  previousExplorer: ExplorerLocation | null;
  /** Saved value of `recreateCustomPlots` while the walkthrough disables it. */
  savedRecreateCustomPlots: boolean | null;
  /** Disable custom-plot recreation and save its previous value. */
  onlyRecreateDefaultPlots: () => void;
  bridge: Partial<WalkthroughBridge>;
  registerBridge: (part: Partial<WalkthroughBridge>) => () => void;
  start: () => void;
  /** Open the cleanup prompt if the demo was prepared; otherwise stop immediately. */
  requestClose: () => void;
  stop: () => void;
  goTo: (index: number) => void;
  back: () => void;
  clearCameBack: () => void;
  setDemo: (demo: DemoFiles) => void;
  setLive: (live: LiveDemo | null) => void;
  setPreviousExplorer: (location: ExplorerLocation) => void;
}

export const useWalkthroughStore = create<WalkthroughState>()((set, get) => ({
  active: false,
  stepIndex: 0,
  closing: false,
  paused: false,
  cameBack: false,
  demo: null,
  live: null,
  previousExplorer: null,
  savedRecreateCustomPlots: null,
  bridge: {},

  registerBridge: (part) => {
    set({ bridge: { ...get().bridge, ...part } });
    return () => {
      const bridge = { ...get().bridge };
      for (const key of Object.keys(part) as (keyof WalkthroughBridge)[]) {
        if (bridge[key] === part[key]) delete bridge[key];
      }
      set({ bridge });
    };
  },

  start: () =>
    set({
      active: true,
      stepIndex: 0,
      closing: false,
      demo: null,
      live: null,
      previousExplorer: null,
    }),
  setPaused: (paused) => set({ paused }),
  requestClose: () => (get().demo ? set({ closing: true }) : get().stop()),
  stop: () => {
    const saved = get().savedRecreateCustomPlots;
    if (saved !== null) {
      useSettingsStore.getState().update(["plots", "recreateCustomPlots"], saved);
    }
    set({ active: false, stepIndex: 0, closing: false, savedRecreateCustomPlots: null });
  },
  onlyRecreateDefaultPlots: () => {
    const settings = useSettingsStore.getState();
    if (get().savedRecreateCustomPlots === null) {
      set({ savedRecreateCustomPlots: settings.settings.plots.recreateCustomPlots });
    }
    settings.update(["plots", "recreateCustomPlots"], false);
  },
  goTo: (index) => set({ stepIndex: index, cameBack: false }),
  back: () => set({ stepIndex: Math.max(0, get().stepIndex - 1), cameBack: true }),
  clearCameBack: () => set({ cameBack: false }),
  setDemo: (demo) => set({ demo }),
  setLive: (live) => set({ live }),
  setPreviousExplorer: (location) => set({ previousExplorer: location }),
}));

const normalise = (path: string) => path.replace(/\\/g, "/").toLowerCase();

/** Compare dataset paths after normalizing slash direction and case. */
export const samePath = (a: string, b: string) => normalise(a) === normalise(b);

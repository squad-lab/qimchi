import { create } from "zustand";

export type UpdateStatus =
  | "idle"
  | "checking"
  | "none"
  | "available"
  | "downloading"
  | "downloaded"
  | "installing"
  | "error";

/** The desktop launcher's update state (packaging/qimchi_launcher.py::_Updates). */
export interface UpdateState {
  status: UpdateStatus;
  current: string | null;
  tag: string | null;
  notes: string;
  platform: "windows" | "macos" | "linux" | null;
  /** 0..1 while downloading. */
  progress: number;
  error: string | null;
  /** Which dialog the launcher wants shown, if any. */
  prompt: "available" | "ready" | null;
  checkedAt: string | null;
}

export const INITIAL_UPDATE_STATE: UpdateState = {
  status: "idle",
  current: null,
  tag: null,
  notes: "",
  platform: null,
  progress: 0,
  error: null,
  prompt: null,
  checkedAt: null,
};

interface UpdateStore {
  /** True in the desktop app, whose launcher can check for and install updates. */
  supported: boolean;
  state: UpdateState;
  setSupported: (supported: boolean) => void;
  receive: (state: UpdateState) => void;
  refresh: () => Promise<void>;
  check: () => Promise<void>;
  download: () => Promise<void>;
  install: () => Promise<void>;
  remindAtNextLaunch: () => Promise<void>;
  dismiss: () => Promise<void>;
  /** Reopen the install prompt for an update that is already downloaded. */
  showReady: () => void;
}

const api = () => window.pywebview?.api;

export const useUpdateStore = create<UpdateStore>()((set, get) => {
  const call = async (method: () => Promise<UpdateState> | undefined) => {
    try {
      const state = await method();
      if (state) get().receive(state);
    } catch (error) {
      set((store) => ({
        state: { ...store.state, status: "error", error: String(error), prompt: null },
      }));
    }
  };

  return {
    supported: false,
    state: INITIAL_UPDATE_STATE,
    setSupported: (supported) => set({ supported }),
    receive: (state) => set({ state: { ...INITIAL_UPDATE_STATE, ...state } }),
    refresh: () => call(() => api()?.update_status?.()),
    check: () => call(() => api()?.check_for_updates?.()),
    download: () => call(() => api()?.download_update?.()),
    install: () => call(() => api()?.install_update?.()),
    remindAtNextLaunch: () => call(() => api()?.remind_update_at_next_launch?.()),
    dismiss: () => call(() => api()?.dismiss_update_prompt?.()),
    showReady: () =>
      set((store) =>
        store.state.status === "downloaded" ? { state: { ...store.state, prompt: "ready" } } : {},
      ),
  };
});

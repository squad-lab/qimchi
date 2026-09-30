import { create } from "zustand";
import { persist } from "zustand/middleware";

/** Pinned qanary Parameters Snapshot entries. */
interface PinnedParametersState {
  pinned: string[];
  toggle: (name: string) => void;
  unpin: (name: string) => void;
  clear: () => void;
}

export const usePinnedParametersStore = create<PinnedParametersState>()(
  persist(
    (set) => ({
      pinned: [],
      toggle: (name) =>
        set((state) => ({
          pinned: state.pinned.includes(name)
            ? state.pinned.filter((pinned) => pinned !== name)
            : [...state.pinned, name],
        })),
      unpin: (name) => set((state) => ({ pinned: state.pinned.filter((p) => p !== name) })),
      clear: () => set({ pinned: [] }),
    }),
    { name: "pinned-parameters" },
  ),
);

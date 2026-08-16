// Zustand store for the Qimchi library: per-measurement heart/trash/tag state
// and the DirTree filter toggles. State is keyed by normalized dataset path (the
// backend returns abs_path alongside the uuid). The backend resolves a uuid for
// every readable dataset (qcutils id, QCoDeS guid, or a content signature); a
// dataset it cannot identify comes back without one and its actions are no-ops.
import { create } from "zustand";

import {
  createTag as apiCreateTag,
  deleteTag as apiDeleteTag,
  getDbStatus,
  getLibraryStates,
  getTags,
  registerMeasurement,
  setHeart,
  setTrash,
  tagMeasurement,
  type LibraryState,
  type Tag,
} from "../services/libraryAPI";

/** Normalize a filesystem path for use as a map key (slashes + trailing slash). */
export const normalizePath = (path: string): string =>
  path.replace(/\\/g, "/").replace(/\/+$/, "");

interface PathState {
  uuid: string;
  hearted: boolean;
  trashed: boolean;
  tags: number[];
}

interface LibraryStore {
  // normalized path -> state (measurements that are hearted/trashed/tagged OR
  // registered this session)
  statesByPath: Record<string, PathState>;
  tags: Tag[]; // all of the user's tags
  filterHeartedOnly: boolean;
  hideTrashed: boolean;
  selectedTagIds: number[]; // active tag filter (match ANY)

  // False when the backend's library DB failed to start. Plotting still works;
  // hearts/tags/notes must be visibly disabled rather than failing on click.
  dbAvailable: boolean;
  dbError: string | null;

  checkDbStatus: () => Promise<void>;
  fetchStates: () => Promise<void>;
  register: (
    path: string,
    attrs?: Record<string, unknown>,
  ) => Promise<LibraryState>;
  toggleHeart: (path: string) => Promise<void>;
  toggleTrash: (path: string) => Promise<void>;
  createTag: (name: string) => Promise<Tag | undefined>;
  deleteTag: (id: number) => Promise<void>;
  toggleTag: (path: string, tagId: number) => Promise<void>;

  // Bulk actions over a DirTree multi-selection (set, not toggle).
  applyHeartMany: (paths: string[], hearted: boolean) => Promise<void>;
  applyTrashMany: (paths: string[], trashed: boolean) => Promise<void>;
  applyTagMany: (paths: string[], tagId: number, add: boolean) => Promise<void>;
  /** @internal shared driver for the applyXMany actions */
  _applyMany: (
    paths: string[],
    action: (uuid: string) => Promise<(state: PathState) => PathState>,
  ) => Promise<void>;

  toggleSelectedTag: (id: number) => void;
  clearSelectedTags: () => void;
  getStateForPath: (path: string) => PathState | undefined;
  setFilterHeartedOnly: (value: boolean) => void;
  setHideTrashed: (value: boolean) => void;
}

export const useLibraryStore = create<LibraryStore>((set, get) => ({
  statesByPath: {},
  tags: [],
  filterHeartedOnly: false,
  hideTrashed: false,
  selectedTagIds: [],
  dbAvailable: true,
  dbError: null,

  checkDbStatus: async () => {
    try {
      const status = await getDbStatus();
      set({ dbAvailable: status.dbReady, dbError: status.dbError });
    } catch (error) {
      // The health check itself failing is a backend problem, not a DB verdict;
      // leave the library enabled rather than disabling it on a transient blip.
      console.error("Failed to check library DB status:", error);
    }
  },

  fetchStates: async () => {
    if (!get().dbAvailable) return;
    try {
      const [rows, tags] = await Promise.all([getLibraryStates(), getTags()]);
      const byPath: Record<string, PathState> = {};
      for (const row of rows) {
        if (!row.abs_path) continue;
        byPath[normalizePath(row.abs_path)] = {
          uuid: row.uuid,
          hearted: row.hearted,
          trashed: row.trashed,
          tags: row.tags ?? [],
        };
      }
      // Drop selected filters that reference deleted tags.
      const validIds = new Set(tags.map((t) => t.id));
      set((s) => ({
        statesByPath: byPath,
        tags,
        selectedTagIds: s.selectedTagIds.filter((id) => validIds.has(id)),
      }));
    } catch (error) {
      console.error("Failed to fetch library states:", error);
    }
  },

  register: async (path, attrs) => {
    if (!get().dbAvailable) return { uuid: null, hearted: false, trashed: false };
    const state = await registerMeasurement(path, attrs);
    if (state.uuid) {
      const key = normalizePath(path);
      set((s) => ({
        statesByPath: {
          ...s.statesByPath,
          [key]: {
            uuid: state.uuid as string,
            hearted: state.hearted,
            trashed: state.trashed,
            tags: s.statesByPath[key]?.tags ?? [],
          },
        },
      }));
    }
    return state;
  },

  toggleHeart: async (path) => {
    const key = normalizePath(path);
    let current = get().statesByPath[key];
    if (!current) {
      const registered = await get().register(path);
      if (!registered.uuid) return; // unidentifiable dataset: no-op
      current = get().statesByPath[key];
    }
    if (!current) return;
    const next = !current.hearted;
    set((s) => ({
      statesByPath: { ...s.statesByPath, [key]: { ...current!, hearted: next } },
    }));
    try {
      await setHeart(current.uuid, next);
    } catch (error) {
      console.error("Failed to set heart:", error);
      set((s) => ({
        statesByPath: {
          ...s.statesByPath,
          [key]: { ...current!, hearted: !next },
        },
      }));
    }
  },

  toggleTrash: async (path) => {
    const key = normalizePath(path);
    let current = get().statesByPath[key];
    if (!current) {
      const registered = await get().register(path);
      if (!registered.uuid) return;
      current = get().statesByPath[key];
    }
    if (!current) return;
    const next = !current.trashed;
    set((s) => ({
      statesByPath: { ...s.statesByPath, [key]: { ...current!, trashed: next } },
    }));
    try {
      await setTrash(current.uuid, next);
    } catch (error) {
      console.error("Failed to set trash:", error);
      set((s) => ({
        statesByPath: {
          ...s.statesByPath,
          [key]: { ...current!, trashed: !next },
        },
      }));
    }
  },

  createTag: async (name) => {
    const trimmed = name.trim();
    if (!trimmed) return undefined;
    try {
      const tag = await apiCreateTag(trimmed);
      set((s) =>
        s.tags.some((t) => t.id === tag.id)
          ? s
          : { tags: [...s.tags, tag].sort((a, b) => a.name.localeCompare(b.name)) },
      );
      return tag;
    } catch (error) {
      console.error("Failed to create tag:", error);
      return undefined;
    }
  },

  deleteTag: async (id) => {
    try {
      await apiDeleteTag(id);
    } catch (error) {
      console.error("Failed to delete tag:", error);
      return;
    }
    set((s) => {
      const statesByPath: Record<string, PathState> = {};
      for (const [k, v] of Object.entries(s.statesByPath)) {
        statesByPath[k] = { ...v, tags: v.tags.filter((t) => t !== id) };
      }
      return {
        tags: s.tags.filter((t) => t.id !== id),
        selectedTagIds: s.selectedTagIds.filter((t) => t !== id),
        statesByPath,
      };
    });
  },

  toggleTag: async (path, tagId) => {
    const key = normalizePath(path);
    let current = get().statesByPath[key];
    if (!current) {
      const registered = await get().register(path);
      if (!registered.uuid) return;
      current = get().statesByPath[key];
    }
    if (!current) return;
    const add = !current.tags.includes(tagId);
    try {
      const tags = await tagMeasurement(current.uuid, tagId, add);
      set((s) => ({
        statesByPath: { ...s.statesByPath, [key]: { ...current!, tags } },
      }));
    } catch (error) {
      console.error("Failed to toggle tag:", error);
    }
  },

  // Bulk actions over a DirTree multi-selection
  // These SET rather than toggle each item: with a mixed selection, per-item
  // toggling would flip some on and some off, which is never what you want.
  // The caller decides the target state from the selection (see DirTree).

  applyHeartMany: async (paths, hearted) => {
    await get()._applyMany(paths, async (uuid) => {
      await setHeart(uuid, hearted);
      return (st) => ({ ...st, hearted });
    });
  },

  applyTrashMany: async (paths, trashed) => {
    await get()._applyMany(paths, async (uuid) => {
      await setTrash(uuid, trashed);
      return (st) => ({ ...st, trashed });
    });
  },

  applyTagMany: async (paths, tagId, add) => {
    await get()._applyMany(paths, async (uuid) => {
      const tags = await tagMeasurement(uuid, tagId, add);
      return (st) => ({ ...st, tags });
    });
  },

  /** Resolve each path to a registered uuid, run `action`, then patch state. */
  _applyMany: async (paths, action) => {
    if (!get().dbAvailable) return;
    for (const path of paths) {
      const key = normalizePath(path);
      let current = get().statesByPath[key];
      if (!current) {
        try {
          const registered = await get().register(path);
          if (!registered.uuid) continue; // unidentifiable dataset: skip
        } catch (error) {
          console.error("Failed to register during bulk action:", path, error);
          continue;
        }
        current = get().statesByPath[key];
      }
      if (!current) continue;
      try {
        const patch = await action(current.uuid);
        set((s) => {
          const existing = s.statesByPath[key];
          if (!existing) return s;
          return {
            statesByPath: { ...s.statesByPath, [key]: patch(existing) },
          };
        });
      } catch (error) {
        console.error("Bulk action failed for:", path, error);
      }
    }
  },

  toggleSelectedTag: (id) =>
    set((s) => ({
      selectedTagIds: s.selectedTagIds.includes(id)
        ? s.selectedTagIds.filter((t) => t !== id)
        : [...s.selectedTagIds, id],
    })),

  clearSelectedTags: () => set({ selectedTagIds: [] }),

  getStateForPath: (path) => get().statesByPath[normalizePath(path)],

  setFilterHeartedOnly: (value) => set({ filterHeartedOnly: value }),
  setHideTrashed: (value) => set({ hideTrashed: value }),
}));

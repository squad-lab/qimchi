// Zustand store for the Qimchi library: per-measurement heart/trash/tag state
// and the DirTree filter toggles. State is keyed by normalized dataset path (the
// backend returns abs_path alongside the uuid). The backend resolves a uuid for
// every readable dataset (qanary id, QCoDeS guid, or a content signature); a
// dataset it cannot identify comes back without one and its actions are no-ops.
import { create } from "zustand";

import {
  createTag as apiCreateTag,
  deleteTag as apiDeleteTag,
  renameTag as apiRenameTag,
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
export const normalizePath = (path: string): string => path.replace(/\\/g, "/").replace(/\/+$/, "");

interface PathState {
  uuid: string;
  hearted: boolean;
  trashed: boolean;
  tags: number[];
}

/** A path takes on hearts, trash and tags from its ancestor folders */
export const inheritedState = (
  statesByPath: Record<string, PathState>,
  path: string,
): { hearted: boolean; trashed: boolean; tags: number[] } => {
  const key = normalizePath(path);
  const inherited = { hearted: false, trashed: false, tags: [] as number[] };
  for (const [ancestor, state] of Object.entries(statesByPath)) {
    if (!key.startsWith(`${ancestor}/`)) continue;
    inherited.hearted ||= state.hearted;
    inherited.trashed ||= state.trashed;
    for (const tag of state.tags) if (!inherited.tags.includes(tag)) inherited.tags.push(tag);
  }
  return inherited;
};

/** Resolve the visible heart/trash state, with trash taking precedence. */
export const effectiveState = (
  statesByPath: Record<string, PathState>,
  path: string,
): { hearted: boolean; trashed: boolean } => {
  const own = statesByPath[normalizePath(path)];
  const inherited = inheritedState(statesByPath, path);
  const trashed = Boolean(own?.trashed || inherited.trashed);
  return {
    hearted: !trashed && Boolean(own?.hearted || inherited.hearted),
    trashed,
  };
};

/** Whether a path or any of its parent folders is trashed. */
export const isPathTrashed = (statesByPath: Record<string, PathState>, path: string): boolean => {
  return effectiveState(statesByPath, path).trashed;
};

const withClearedHearts = (
  statesByPath: Record<string, PathState>,
  paths: string[],
): Record<string, PathState> => {
  if (paths.length === 0) return statesByPath;
  const updated = { ...statesByPath };
  for (const path of paths) {
    const key = normalizePath(path);
    const state = updated[key];
    if (state?.hearted) updated[key] = { ...state, hearted: false };
  }
  return updated;
};

interface LibraryStore {
  // normalized path -> state (measurements that are hearted/trashed/tagged OR
  // registered this session)
  statesByPath: Record<string, PathState>;
  tags: Tag[]; // all of the user's tags
  filterHeartedOnly: boolean;
  showTrashed: boolean;
  selectedTagIds: number[]; // active tag filter (match ANY)

  // False when the backend's library DB failed to start. Plotting still works;
  // hearts/tags/notes must be visibly disabled rather than failing on click.
  dbAvailable: boolean;
  dbError: string | null;

  checkDbStatus: () => Promise<void>;
  fetchStates: () => Promise<void>;
  /** `folder` marks a folder rather than a measurement; the backend keys it by path. */
  register: (
    path: string,
    attrs?: Record<string, unknown>,
    folder?: boolean,
  ) => Promise<LibraryState>;
  toggleHeart: (path: string, folder?: boolean) => Promise<void>;
  toggleTrash: (path: string, folder?: boolean) => Promise<void>;
  createTag: (name: string) => Promise<Tag | undefined>;
  deleteTag: (id: number) => Promise<void>;
  /** Rename a tag; returns the error message when the name is taken. */
  renameTag: (id: number, name: string) => Promise<string | undefined>;
  toggleTag: (path: string, tagId: number, folder?: boolean) => Promise<void>;

  // Bulk actions over a DirTree multi-selection (set, not toggle). `folderPaths`
  // says which of `paths` are folders.
  applyHeartMany: (paths: string[], hearted: boolean, folderPaths?: string[]) => Promise<void>;
  applyTrashMany: (paths: string[], trashed: boolean, folderPaths?: string[]) => Promise<void>;
  applyTagMany: (
    paths: string[],
    tagId: number,
    add: boolean,
    folderPaths?: string[],
  ) => Promise<void>;
  /** @internal shared driver for the applyXMany actions */
  _applyMany: (
    paths: string[],
    action: (uuid: string) => Promise<(state: PathState) => PathState>,
    folderPaths?: string[],
  ) => Promise<void>;

  toggleSelectedTag: (id: number) => void;
  clearSelectedTags: () => void;
  getStateForPath: (path: string) => PathState | undefined;
  setFilterHeartedOnly: (value: boolean) => void;
  setShowTrashed: (value: boolean) => void;
}

export const useLibraryStore = create<LibraryStore>((set, get) => ({
  statesByPath: {},
  tags: [],
  filterHeartedOnly: false,
  showTrashed: false,
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

  register: async (path, attrs, folder = false) => {
    if (!get().dbAvailable) return { uuid: null, hearted: false, trashed: false };
    const state = await registerMeasurement(path, attrs, folder);
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

  toggleHeart: async (path, folder = false) => {
    const key = normalizePath(path);
    let current = get().statesByPath[key];
    if (!current) {
      const registered = await get().register(path, undefined, folder);
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

  toggleTrash: async (path, folder = false) => {
    const key = normalizePath(path);
    let current = get().statesByPath[key];
    if (!current) {
      const registered = await get().register(path, undefined, folder);
      if (!registered.uuid) return;
      current = get().statesByPath[key];
    }
    if (!current) return;
    const next = !current.trashed;
    const optimisticHearted = next ? false : current.hearted;
    set((s) => ({
      statesByPath: {
        ...s.statesByPath,
        [key]: { ...current!, hearted: optimisticHearted, trashed: next },
      },
    }));
    try {
      const saved = await setTrash(current.uuid, next);
      set((s) => ({
        statesByPath: withClearedHearts(
          {
            ...s.statesByPath,
            [key]: {
              ...current!,
              hearted: saved?.hearted ?? optimisticHearted,
              trashed: saved?.trashed ?? next,
            },
          },
          saved?.unhearted_paths ?? [],
        ),
      }));
    } catch (error) {
      console.error("Failed to set trash:", error);
      set((s) => ({
        statesByPath: {
          ...s.statesByPath,
          [key]: current!,
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

  renameTag: async (id, name) => {
    try {
      const renamed = await apiRenameTag(id, name);
      set((s) => ({
        tags: s.tags
          .map((t) => (t.id === id ? { ...t, name: renamed.name } : t))
          .sort((a, b) => a.name.localeCompare(b.name)),
      }));
      return undefined;
    } catch (error) {
      // A 409 means another tag already has the name; the popover shows it
      // rather than leaving the rename silently undone.
      const detail = (error as { response?: { data?: { detail?: string } } })?.response?.data
        ?.detail;
      console.error("Failed to rename tag:", error);
      return detail ?? "Could not rename the tag";
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

  toggleTag: async (path, tagId, folder = false) => {
    const key = normalizePath(path);
    let current = get().statesByPath[key];
    if (!current) {
      const registered = await get().register(path, undefined, folder);
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

  applyHeartMany: async (paths, hearted, folderPaths) => {
    await get()._applyMany(
      paths,
      async (uuid) => {
        await setHeart(uuid, hearted);
        return (st) => ({ ...st, hearted });
      },
      folderPaths,
    );
  },

  applyTrashMany: async (paths, trashed, folderPaths) => {
    await get()._applyMany(
      paths,
      async (uuid) => {
        const saved = await setTrash(uuid, trashed);
        if (saved?.unhearted_paths?.length) {
          set((s) => ({
            statesByPath: withClearedHearts(s.statesByPath, saved.unhearted_paths ?? []),
          }));
        }
        return (st) => ({
          ...st,
          hearted: saved?.hearted ?? (trashed ? false : st.hearted),
          trashed: saved?.trashed ?? trashed,
        });
      },
      folderPaths,
    );
  },

  applyTagMany: async (paths, tagId, add, folderPaths) => {
    await get()._applyMany(
      paths,
      async (uuid) => {
        const tags = await tagMeasurement(uuid, tagId, add);
        return (st) => ({ ...st, tags });
      },
      folderPaths,
    );
  },

  /** Resolve each path to a registered uuid, run `action`, then patch state. */
  _applyMany: async (paths, action, folderPaths = []) => {
    if (!get().dbAvailable) return;
    const folders = new Set(folderPaths.map(normalizePath));
    for (const path of paths) {
      const key = normalizePath(path);
      let current = get().statesByPath[key];
      if (!current) {
        try {
          const registered = await get().register(path, undefined, folders.has(key));
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
  setShowTrashed: (value) => set({ showTrashed: value }),
}));

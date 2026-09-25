import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  effectiveState,
  inheritedState,
  isPathTrashed,
  normalizePath,
  useLibraryStore,
} from "./libraryStore";

vi.mock("../services/libraryAPI", () => ({
  createTag: vi.fn(),
  deleteTag: vi.fn(),
  renameTag: vi.fn(),
  getDbStatus: vi.fn(),
  getLibraryStates: vi.fn(),
  getTags: vi.fn(),
  registerMeasurement: vi.fn(),
  setHeart: vi.fn(),
  setTrash: vi.fn(),
  tagMeasurement: vi.fn(),
}));

import {
  createTag as apiCreateTag,
  registerMeasurement,
  setHeart,
  setTrash,
  tagMeasurement,
} from "../services/libraryAPI";

const RUN = "C:\\data\\run.zarr";
const KEY = "C:/data/run.zarr";

beforeEach(() => {
  vi.clearAllMocks();
  useLibraryStore.setState({
    statesByPath: {},
    tags: [],
    filterHeartedOnly: false,
    showTrashed: false,
    selectedTagIds: [],
    dbAvailable: true,
    dbError: null,
  });
});

describe("normalizePath", () => {
  it("makes a Windows path usable as a stable map key", () => {
    // The same dataset reaches the store spelled several ways.
    expect(normalizePath("C:\\data\\run.zarr")).toBe(KEY);
    expect(normalizePath("C:/data/run.zarr/")).toBe(KEY);
    expect(normalizePath("C:/data/run.zarr///")).toBe(KEY);
  });
});

describe("tag filter selection", () => {
  it("toggles a tag in and out of the filter", () => {
    useLibraryStore.getState().toggleSelectedTag(1);
    expect(useLibraryStore.getState().selectedTagIds).toEqual([1]);

    useLibraryStore.getState().toggleSelectedTag(2);
    expect(useLibraryStore.getState().selectedTagIds).toEqual([1, 2]);

    useLibraryStore.getState().toggleSelectedTag(1);
    expect(useLibraryStore.getState().selectedTagIds).toEqual([2]);
  });

  it("clears every selected tag at once", () => {
    useLibraryStore.setState({ selectedTagIds: [1, 2, 3] });

    useLibraryStore.getState().clearSelectedTags();

    expect(useLibraryStore.getState().selectedTagIds).toEqual([]);
  });
});

describe("getStateForPath", () => {
  it("looks up by the normalized key, whatever the caller passes", () => {
    useLibraryStore.setState({
      statesByPath: { [KEY]: { uuid: "u1", hearted: true, trashed: false, tags: [] } },
    });

    expect(useLibraryStore.getState().getStateForPath(RUN)?.hearted).toBe(true);
    expect(useLibraryStore.getState().getStateForPath("C:/data/run.zarr/")?.uuid).toBe("u1");
    expect(useLibraryStore.getState().getStateForPath("C:/data/other.zarr")).toBeUndefined();
  });
});

describe("toggleHeart", () => {
  const seed = (hearted: boolean) =>
    useLibraryStore.setState({
      statesByPath: { [KEY]: { uuid: "u1", hearted, trashed: false, tags: [] } },
    });

  it("updates immediately, before the request settles", async () => {
    seed(false);
    vi.mocked(setHeart).mockResolvedValue(undefined as never);

    await useLibraryStore.getState().toggleHeart(RUN);

    expect(useLibraryStore.getState().statesByPath[KEY].hearted).toBe(true);
    expect(setHeart).toHaveBeenCalledWith("u1", true);
  });

  it("rolls back when the request fails", async () => {
    // Otherwise the row keeps a heart the database never recorded.
    seed(false);
    vi.mocked(setHeart).mockRejectedValue(new Error("503"));

    await useLibraryStore.getState().toggleHeart(RUN);

    expect(useLibraryStore.getState().statesByPath[KEY].hearted).toBe(false);
  });

  it("unhearts an already-hearted measurement", async () => {
    seed(true);
    vi.mocked(setHeart).mockResolvedValue(undefined as never);

    await useLibraryStore.getState().toggleHeart(RUN);

    expect(setHeart).toHaveBeenCalledWith("u1", false);
    expect(useLibraryStore.getState().statesByPath[KEY].hearted).toBe(false);
  });

  it("does nothing for a dataset that cannot be identified", async () => {
    // register() returning no uuid means there is nothing to key state on.
    const register = vi
      .spyOn(useLibraryStore.getState(), "register")
      .mockResolvedValue({ uuid: "", hearted: false, trashed: false, tags: [] } as never);

    await useLibraryStore.getState().toggleHeart("C:/data/mystery.bin");

    expect(setHeart).not.toHaveBeenCalled();
    register.mockRestore();
  });
});

describe("toggleTrash", () => {
  it("unhearts a measurement when trashing it", async () => {
    useLibraryStore.setState({
      statesByPath: { [KEY]: { uuid: "u1", hearted: true, trashed: false, tags: [] } },
    });
    vi.mocked(setTrash).mockResolvedValue({
      uuid: "u1",
      hearted: false,
      trashed: true,
    } as never);

    await useLibraryStore.getState().toggleTrash(RUN);

    expect(useLibraryStore.getState().statesByPath[KEY]).toMatchObject({
      hearted: false,
      trashed: true,
    });
  });

  it("updates immediately and rolls back on failure", async () => {
    useLibraryStore.setState({
      statesByPath: { [KEY]: { uuid: "u1", hearted: false, trashed: false, tags: [] } },
    });
    vi.mocked(setTrash).mockRejectedValue(new Error("503"));

    await useLibraryStore.getState().toggleTrash(RUN);

    expect(setTrash).toHaveBeenCalledWith("u1", true);
    expect(useLibraryStore.getState().statesByPath[KEY].trashed).toBe(false);
  });
});

describe("toggleTag", () => {
  const seed = (tags: number[]) =>
    useLibraryStore.setState({
      statesByPath: { [KEY]: { uuid: "u1", hearted: false, trashed: false, tags } },
    });

  it("adds a tag the measurement does not have", async () => {
    seed([]);
    vi.mocked(tagMeasurement).mockResolvedValue([1] as never);

    await useLibraryStore.getState().toggleTag(RUN, 1);

    expect(tagMeasurement).toHaveBeenCalledWith("u1", 1, true);
    expect(useLibraryStore.getState().statesByPath[KEY].tags).toEqual([1]);
  });

  it("removes a tag it already has", async () => {
    seed([1]);
    vi.mocked(tagMeasurement).mockResolvedValue([] as never);

    await useLibraryStore.getState().toggleTag(RUN, 1);

    expect(tagMeasurement).toHaveBeenCalledWith("u1", 1, false);
  });
});

describe("createTag", () => {
  it("keeps the tag list sorted by name", async () => {
    // The dropdown reads this list in order; an unsorted insert would make
    // a new tag appear at the end rather than where it belongs.
    useLibraryStore.setState({
      tags: [
        { id: 1, name: "cold" },
        { id: 2, name: "warm" },
      ],
    });
    vi.mocked(apiCreateTag).mockResolvedValue({ id: 3, name: "reviewed" } as never);

    await useLibraryStore.getState().createTag("reviewed");

    expect(useLibraryStore.getState().tags.map((t) => t.name)).toEqual([
      "cold",
      "reviewed",
      "warm",
    ]);
  });

  it("refuses a blank name without calling the API", async () => {
    await useLibraryStore.getState().createTag("   ");

    expect(apiCreateTag).not.toHaveBeenCalled();
  });

  it("leaves the list alone when creation fails", async () => {
    useLibraryStore.setState({ tags: [] });
    vi.mocked(apiCreateTag).mockRejectedValue(new Error("503"));

    const created = await useLibraryStore.getState().createTag("reviewed");

    expect(created).toBeUndefined();
    expect(useLibraryStore.getState().tags).toEqual([]);
  });
});

describe("bulk actions", () => {
  const KEY2 = "C:/data/other.zarr";

  beforeEach(() => {
    useLibraryStore.setState({
      statesByPath: {
        [KEY]: { uuid: "u1", hearted: false, trashed: false, tags: [] },
        [KEY2]: { uuid: "u2", hearted: false, trashed: false, tags: [] },
      },
    });
  });

  it("applies one heart value to the whole selection, not a toggle each", async () => {
    // Toggling per row would flip a mixed selection half on and half off.
    useLibraryStore.setState({
      statesByPath: {
        [KEY]: { uuid: "u1", hearted: true, trashed: false, tags: [] },
        [KEY2]: { uuid: "u2", hearted: false, trashed: false, tags: [] },
      },
    });
    vi.mocked(setHeart).mockResolvedValue(undefined as never);

    await useLibraryStore.getState().applyHeartMany([KEY, KEY2], true);

    expect(setHeart).toHaveBeenCalledWith("u1", true);
    expect(setHeart).toHaveBeenCalledWith("u2", true);
    expect(useLibraryStore.getState().statesByPath[KEY2].hearted).toBe(true);
  });

  it("applies a tag across the selection", async () => {
    vi.mocked(tagMeasurement).mockResolvedValue([7] as never);

    await useLibraryStore.getState().applyTagMany([KEY, KEY2], 7, true);

    expect(tagMeasurement).toHaveBeenCalledTimes(2);
    expect(useLibraryStore.getState().statesByPath[KEY].tags).toEqual([7]);
  });

  it("unhearts measurements when moving them to trash", async () => {
    useLibraryStore.setState({
      statesByPath: {
        [KEY]: { uuid: "u1", hearted: true, trashed: false, tags: [] },
        [KEY2]: { uuid: "u2", hearted: true, trashed: false, tags: [] },
      },
    });
    vi.mocked(setTrash).mockImplementation(async (uuid) => ({
      uuid,
      hearted: false,
      trashed: true,
    }));

    await useLibraryStore.getState().applyTrashMany([KEY, KEY2], true);

    expect(useLibraryStore.getState().statesByPath[KEY].hearted).toBe(false);
    expect(useLibraryStore.getState().statesByPath[KEY2].hearted).toBe(false);
  });
});

describe("folders", () => {
  const FOLDER = "C:/data/cooldown";
  const CHILD = `${FOLDER}/day2/run.zarr`;

  it("registers a folder as a folder the first time it is marked", async () => {
    vi.mocked(registerMeasurement).mockResolvedValue({
      uuid: "f1",
      hearted: false,
      trashed: false,
    } as never);
    vi.mocked(setHeart).mockResolvedValue(undefined as never);

    await useLibraryStore.getState().toggleHeart("C:\\data\\cooldown", true);

    expect(registerMeasurement).toHaveBeenCalledWith("C:\\data\\cooldown", undefined, true);
    expect(setHeart).toHaveBeenCalledWith("f1", true);
    expect(useLibraryStore.getState().statesByPath[FOLDER].hearted).toBe(true);
  });

  it("applies descendant hearts cleared by the folder trash request", async () => {
    useLibraryStore.setState({
      statesByPath: {
        [FOLDER]: { uuid: "f1", hearted: false, trashed: false, tags: [] },
        [CHILD]: { uuid: "u1", hearted: true, trashed: false, tags: [] },
      },
    });
    vi.mocked(setTrash).mockResolvedValue({
      uuid: "f1",
      hearted: false,
      trashed: true,
      unhearted_paths: ["C:\\data\\cooldown\\day2\\run.zarr"],
    });

    await useLibraryStore.getState().toggleTrash(FOLDER, true);

    expect(setTrash).toHaveBeenCalledTimes(1);
    expect(useLibraryStore.getState().statesByPath[CHILD].hearted).toBe(false);
  });

  it("registers only the selected folders as folders in a bulk action", async () => {
    vi.mocked(registerMeasurement).mockImplementation(async (path) => ({
      uuid: String(path),
      hearted: false,
      trashed: false,
    }));
    vi.mocked(setHeart).mockResolvedValue(undefined as never);

    await useLibraryStore.getState().applyHeartMany([FOLDER, KEY], true, [FOLDER]);

    expect(registerMeasurement).toHaveBeenCalledWith(FOLDER, undefined, true);
    expect(registerMeasurement).toHaveBeenCalledWith(KEY, undefined, false);
  });

  it("passes a folder's marks to everything inside it", () => {
    const states = {
      [FOLDER]: { uuid: "f1", hearted: true, trashed: false, tags: [3] },
      "C:/data/cooldown/day2": { uuid: "f2", hearted: false, trashed: true, tags: [4] },
    };

    expect(inheritedState(states, "C:\\data\\cooldown\\day2\\run.zarr")).toEqual({
      hearted: true,
      trashed: true,
      tags: [3, 4],
    });
    // A folder does not inherit from itself, nor from a sibling with a longer name.
    expect(inheritedState(states, FOLDER).hearted).toBe(false);
    expect(inheritedState(states, "C:/data/cooldown-old/run.zarr").hearted).toBe(false);
  });

  it("treats a path as trashed when it or any parent folder is trashed", () => {
    const states = {
      [FOLDER]: { uuid: "f1", hearted: false, trashed: true, tags: [] },
      "C:/data/other/run.zarr": { uuid: "u1", hearted: false, trashed: true, tags: [] },
    };

    expect(isPathTrashed(states, "C:/data/cooldown/day2/run.zarr")).toBe(true);
    expect(isPathTrashed(states, "C:/data/other/run.zarr")).toBe(true);
    expect(isPathTrashed(states, "C:/data/cooldown-old/run.zarr")).toBe(false);
  });

  it("suppresses an effective heart below a trashed folder", () => {
    const path = "C:/data/cooldown/day2/run.zarr";
    const states = {
      [FOLDER]: { uuid: "f1", hearted: false, trashed: true, tags: [] },
      [path]: { uuid: "u1", hearted: true, trashed: false, tags: [] },
    };

    expect(effectiveState(states, path)).toEqual({ hearted: false, trashed: true });
    expect(states[path].hearted).toBe(true);
  });
});

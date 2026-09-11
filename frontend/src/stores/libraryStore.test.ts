import { beforeEach, describe, expect, it, vi } from "vitest";

import { normalizePath, useLibraryStore } from "./libraryStore";

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
    hideTrashed: false,
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
});

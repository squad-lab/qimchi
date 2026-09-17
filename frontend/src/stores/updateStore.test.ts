import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { INITIAL_UPDATE_STATE, useUpdateStore, type UpdateState } from "./updateStore";

const state = (changes: Partial<UpdateState>): UpdateState => ({
  ...INITIAL_UPDATE_STATE,
  current: "v0.7.0-rc.8",
  ...changes,
});

beforeEach(() => {
  useUpdateStore.setState({ supported: true, state: INITIAL_UPDATE_STATE });
});

afterEach(() => {
  delete window.pywebview;
});

describe("updateStore", () => {
  it("takes the launcher's answer to each action", async () => {
    const downloading = state({ status: "downloading", tag: "v0.7.0-rc.9" });
    window.pywebview = {
      api: { download_update: vi.fn().mockResolvedValue(downloading) },
    } as unknown as typeof window.pywebview;

    await useUpdateStore.getState().download();

    expect(useUpdateStore.getState().state).toEqual(downloading);
  });

  it("reopens the install prompt only for a downloaded update", () => {
    useUpdateStore.getState().receive(state({ status: "downloading", tag: "v0.7.0-rc.9" }));
    useUpdateStore.getState().showReady();
    expect(useUpdateStore.getState().state.prompt).toBeNull();

    useUpdateStore.getState().receive(state({ status: "downloaded", tag: "v0.7.0-rc.9" }));
    useUpdateStore.getState().showReady();
    expect(useUpdateStore.getState().state.prompt).toBe("ready");
  });

  it("shows a failed call as an error instead of throwing", async () => {
    window.pywebview = {
      api: { check_for_updates: vi.fn().mockRejectedValue(new Error("bridge gone")) },
    } as unknown as typeof window.pywebview;

    await useUpdateStore.getState().check();

    expect(useUpdateStore.getState().state).toMatchObject({ status: "error", prompt: null });
    expect(useUpdateStore.getState().state.error).toContain("bridge gone");
  });
});

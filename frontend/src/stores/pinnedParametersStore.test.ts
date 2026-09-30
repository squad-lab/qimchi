import { beforeEach, describe, expect, it } from "vitest";

import { usePinnedParametersStore } from "./pinnedParametersStore";

describe("pinnedParametersStore", () => {
  beforeEach(() => usePinnedParametersStore.setState({ pinned: [] }));

  it("pins in the order chosen and unpins on a second toggle", () => {
    const { toggle } = usePinnedParametersStore.getState();
    toggle("dmm_v1");
    toggle("dac_ch1");
    expect(usePinnedParametersStore.getState().pinned).toEqual(["dmm_v1", "dac_ch1"]);

    toggle("dmm_v1");
    expect(usePinnedParametersStore.getState().pinned).toEqual(["dac_ch1"]);
  });

  it("unpins one parameter or all of them", () => {
    usePinnedParametersStore.setState({ pinned: ["a", "b", "c"] });
    usePinnedParametersStore.getState().unpin("b");
    expect(usePinnedParametersStore.getState().pinned).toEqual(["a", "c"]);

    usePinnedParametersStore.getState().clear();
    expect(usePinnedParametersStore.getState().pinned).toEqual([]);
  });
});

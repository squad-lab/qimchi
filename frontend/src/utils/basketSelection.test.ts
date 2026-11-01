import { describe, expect, it } from "vitest";

import {
  EMPTY_SELECTION,
  parseSelection,
  reconcileSelection,
  selectAll,
  selectOnly,
  selectRange,
  stepFrom,
  toggleSelected,
} from "./basketSelection";

const order = ["a", "b", "c", "d", "e"];

describe("toggleSelected", () => {
  it("adds and removes one measurement", () => {
    const both = toggleSelected(selectOnly("a"), "c");
    expect(both).toEqual({ ids: ["a", "c"], anchor: "c" });
    expect(toggleSelected(both, "a")).toEqual({ ids: ["c"], anchor: "a" });
  });

  it("keeps the last selected measurement", () => {
    const only = selectOnly("a");
    expect(toggleSelected(only, "a")).toBe(only);
  });
});

describe("selectRange", () => {
  it("selects from the anchor in Basket order, in either direction", () => {
    expect(selectRange(selectOnly("b"), order, "d")).toEqual({ ids: ["b", "c", "d"], anchor: "b" });
    expect(selectRange(selectOnly("d"), order, "b").ids).toEqual(["b", "c", "d"]);
  });

  it("keeps the earlier selection when adding a range", () => {
    const start = { ids: ["e", "b"], anchor: "b" };
    expect(selectRange(start, order, "c", true).ids).toEqual(["e", "b", "c"]);
  });

  it("starts at the clicked measurement when the anchor has gone", () => {
    expect(selectRange({ ids: ["a"], anchor: "gone" }, order, "c")).toEqual(selectOnly("c"));
  });
});

describe("selectAll", () => {
  it("selects every measurement and keeps the anchor", () => {
    expect(selectAll(selectOnly("c"), order)).toEqual({ ids: order, anchor: "c" });
  });
});

describe("stepFrom", () => {
  it("moves one place and stops at either end", () => {
    expect(stepFrom(order, "b", 1)).toBe("c");
    expect(stepFrom(order, "a", -1)).toBe("a");
    expect(stepFrom(order, "e", 1)).toBe("e");
    expect(stepFrom(order, "c", "first")).toBe("a");
    expect(stepFrom(order, "c", "last")).toBe("e");
    expect(stepFrom([], "c", 1)).toBeNull();
  });
});

describe("reconcileSelection", () => {
  it("selects the first measurement added to an empty Basket and keeps it as more arrive", () => {
    const first = reconcileSelection(EMPTY_SELECTION, [], ["a"]);
    expect(first).toEqual(selectOnly("a"));
    const second = reconcileSelection(first, ["a"], ["b", "a"]);
    expect(second).toBe(first);
  });

  it("selects the measurement that takes the removed one's place", () => {
    expect(reconcileSelection(selectOnly("b"), order, ["a", "c", "d", "e"])).toEqual(
      selectOnly("c"),
    );
    expect(reconcileSelection({ ids: ["c", "d"], anchor: "c" }, order, ["a", "b", "e"])).toEqual(
      selectOnly("e"),
    );
  });

  it("falls back to the one before when the last measurement is removed", () => {
    expect(reconcileSelection(selectOnly("e"), order, ["a", "b", "c", "d"])).toEqual(
      selectOnly("d"),
    );
  });

  it("drops removed measurements from a larger selection", () => {
    expect(reconcileSelection({ ids: ["a", "c"], anchor: "c" }, order, ["a", "b"])).toEqual({
      ids: ["a"],
      anchor: "a",
    });
  });

  it("is empty only for an empty Basket", () => {
    expect(reconcileSelection(selectOnly("a"), ["a"], [])).toEqual(EMPTY_SELECTION);
  });

  it("selects the newest measurement of a restored Basket without a saved selection", () => {
    expect(reconcileSelection(EMPTY_SELECTION, [], ["b", "a"])).toEqual(selectOnly("b"));
  });
});

describe("parseSelection", () => {
  it("reads a stored selection and ignores anything else", () => {
    expect(parseSelection({ ids: ["a"], anchor: "a" })).toEqual(selectOnly("a"));
    expect(parseSelection({ ids: [1] })).toEqual(EMPTY_SELECTION);
    expect(parseSelection(null)).toEqual(EMPTY_SELECTION);
  });
});

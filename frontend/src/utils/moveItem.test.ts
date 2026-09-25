import { describe, expect, it } from "vitest";

import { moveItem } from "./moveItem";

describe("moveItem", () => {
  it("moves an entry earlier or later", () => {
    expect(moveItem(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
    expect(moveItem(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
  });

  it("leaves the original list alone", () => {
    const items = ["a", "b"];
    moveItem(items, 0, 1);
    expect(items).toEqual(["a", "b"]);
  });
});

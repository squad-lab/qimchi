import { beforeEach, describe, expect, it } from "vitest";

import type { BasketItem } from "../components/Basket";
import { useBasketStore } from "./basketStore";

const item = (id: string, overrides: Partial<BasketItem> = {}): BasketItem =>
  ({
    id,
    name: `${id}.zarr`,
    path: `C:/data/${id}.zarr`,
    type: "file",
    ...overrides,
  }) as BasketItem;

beforeEach(() => {
  useBasketStore.setState({ items: [] });
});

describe("basketStore", () => {
  it("adds items in order", () => {
    useBasketStore.getState().addItem(item("a"));
    useBasketStore.getState().addItem(item("b"));

    expect(useBasketStore.getState().items.map((i) => i.id)).toEqual(["a", "b"]);
  });

  it("merges rather than duplicating an item already in the basket", () => {
    // Re-adding is how attributes arrive after the first, attribute-less add.
    useBasketStore.getState().addItem(item("a"));
    useBasketStore
      .getState()
      .addItem(item("a", { attributes: { independents: ["gate"], dependents: ["signal"] } }));

    const items = useBasketStore.getState().items;
    expect(items).toHaveLength(1);
    expect(items[0].attributes?.independents).toEqual(["gate"]);
  });

  it("removes one item and leaves the rest", () => {
    useBasketStore.getState().addItem(item("a"));
    useBasketStore.getState().addItem(item("b"));

    useBasketStore.getState().removeItem("a");

    expect(useBasketStore.getState().items.map((i) => i.id)).toEqual(["b"]);
  });

  it("ignores a removal for an item that is not there", () => {
    useBasketStore.getState().addItem(item("a"));

    useBasketStore.getState().removeItem("missing");

    expect(useBasketStore.getState().items).toHaveLength(1);
  });

  it("updates a single item in place", () => {
    useBasketStore.getState().addItem(item("a"));

    useBasketStore.getState().updateItem("a", { name: "renamed.zarr" });

    expect(useBasketStore.getState().items[0].name).toBe("renamed.zarr");
    expect(useBasketStore.getState().items[0].path).toBe("C:/data/a.zarr");
  });

  it("clears everything", () => {
    useBasketStore.getState().addItem(item("a"));
    useBasketStore.getState().addItem(item("b"));

    useBasketStore.getState().clearAll();

    expect(useBasketStore.getState().items).toEqual([]);
  });
});

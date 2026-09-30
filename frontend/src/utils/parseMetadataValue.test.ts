import { describe, expect, it } from "vitest";

import { parseMetadataValue } from "./parseMetadataValue";

describe("parseMetadataValue", () => {
  it("passes non-strings straight through", () => {
    // QCoDeS attrs arrive as real numbers and booleans, not JSON text.
    expect(parseMetadataValue(7)).toBe(7);
    expect(parseMetadataValue(true)).toBe(true);
    expect(parseMetadataValue(null)).toBeNull();
    expect(parseMetadataValue(undefined)).toBeUndefined();
    const nested = { station: {} };
    expect(parseMetadataValue(nested)).toBe(nested);
  });

  it("expands JSON held in a string", () => {
    // This is how QCoDeS stores its station snapshot: one JSON string.
    expect(parseMetadataValue('{"a":1}')).toEqual({ a: 1 });
    expect(parseMetadataValue("[1,2,3]")).toEqual([1, 2, 3]);
  });

  it("keeps a plain string as a string", () => {
    // A guid parses as neither JSON nor a number, and must survive intact --
    // handing it on as something else is what spelled it out character by
    // character in the metadata tree.
    expect(parseMetadataValue("4df2d70a-0000-0000-0000-019a6e3255ed")).toBe(
      "4df2d70a-0000-0000-0000-019a6e3255ed",
    );
    expect(parseMetadataValue("Single gate sweep")).toBe("Single gate sweep");
    expect(parseMetadataValue("E:\\data\\run.zarr")).toBe("E:\\data\\run.zarr");
  });

  it("revives Python's non-finite numbers, which JSON has no syntax for", () => {
    // json.dumps emits bare NaN/Infinity; JSON.parse rejects them outright.
    const parsed = parseMetadataValue('{"nan": NaN, "pos": Infinity, "neg": -Infinity}') as Record<
      string,
      number
    >;

    expect(Number.isNaN(parsed.nan)).toBe(true);
    expect(parsed.pos).toBe(Number.POSITIVE_INFINITY);
    expect(parsed.neg).toBe(Number.NEGATIVE_INFINITY);
  });

  it("leaves those words alone inside strings", () => {
    // Only bare literals are numbers; the same text quoted is just text.
    const parsed = parseMetadataValue('{"note": "NaN means not a number"}') as Record<
      string,
      string
    >;

    expect(parsed.note).toBe("NaN means not a number");
  });

  it("handles non-finite numbers nested in arrays and objects", () => {
    const parsed = parseMetadataValue('{"xs": [1, NaN, Infinity]}') as { xs: number[] };

    expect(parsed.xs[0]).toBe(1);
    expect(Number.isNaN(parsed.xs[1])).toBe(true);
    expect(parsed.xs[2]).toBe(Number.POSITIVE_INFINITY);
  });

  it("returns malformed JSON unchanged rather than throwing", () => {
    // The pane must render something, even for an attr that is not JSON.
    expect(parseMetadataValue("{not json")).toBe("{not json");
    expect(parseMetadataValue("")).toBe("");
  });
});

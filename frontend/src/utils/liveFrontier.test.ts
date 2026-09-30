import { describe, expect, it } from "vitest";

import { findFrontier } from "./liveFrontier";

const N = NaN;

describe("findFrontier", () => {
  it("follows the newest full row of a map filled row by row", () => {
    const z = [
      [1, 2, 3],
      [4, 5, 6],
      [N, N, N],
      [N, N, N],
    ];
    expect(findFrontier(z)).toEqual({ axis: "row", index: 1 });
  });

  it("moves to a row as soon as its first point arrives", () => {
    const z = [
      [1, 2, 3],
      [4, 5, 6],
      [7, N, N],
      [N, N, N],
    ];
    expect(findFrontier(z)).toEqual({ axis: "row", index: 2 });
    z[2] = [7, 8, 9];
    expect(findFrontier(z)).toEqual({ axis: "row", index: 2 });
  });

  it("moves to a column as soon as its first point arrives", () => {
    const z = [
      [1, 2, 3, N],
      [4, 5, N, N],
    ];
    expect(findFrontier(z, { axis: "column", index: 1 })).toEqual({
      axis: "column",
      index: 2,
    });
  });

  it("follows columns when the map grows column by column, as after swapping axes", () => {
    const z = [
      [1, 2, N, N],
      [3, 4, N, N],
    ];
    expect(findFrontier(z)).toEqual({ axis: "column", index: 1 });
  });

  it("handles a sweep that runs from the last row towards the first", () => {
    const z = [
      [N, N],
      [N, N],
      [1, 2],
      [3, 4],
    ];
    expect(findFrontier(z)).toEqual({ axis: "row", index: 2 });
  });

  it("uses the row being filled when there is no full row yet", () => {
    const z = [
      [1, 2, N, N],
      [N, N, N, N],
      [N, N, N, N],
    ];
    expect(findFrontier(z)).toEqual({ axis: "row", index: 0 });
  });

  it("keeps the last frontier once the measurement is complete", () => {
    const done = [
      [1, 2],
      [3, 4],
    ];
    expect(findFrontier(done, { axis: "row", index: 1 })).toEqual({ axis: "row", index: 1 });
    expect(findFrontier(done)).toEqual({ axis: "row", index: 1 });
  });

  it("finds nothing before any point is measured", () => {
    expect(findFrontier([[N, N]])).toBeNull();
    expect(findFrontier([])).toBeNull();
  });
});

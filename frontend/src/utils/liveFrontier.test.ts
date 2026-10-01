import { describe, expect, it } from "vitest";

import { findFrontier, type Frontier } from "./liveFrontier";

const N = NaN;

describe("findFrontier", () => {
  it("follows the newest full row of a map filled row by row", () => {
    const z = [
      [1, 2, 3],
      [4, 5, 6],
      [N, N, N],
      [N, N, N],
    ];
    expect(findFrontier(z)).toEqual({ axis: "row", index: 1, forward: true });
  });

  it("moves to a row as soon as its first point arrives", () => {
    const z = [
      [1, 2, 3],
      [4, 5, 6],
      [7, N, N],
      [N, N, N],
    ];
    expect(findFrontier(z)).toEqual({ axis: "row", index: 2, forward: true });
    z[2] = [7, 8, 9];
    expect(findFrontier(z)).toEqual({ axis: "row", index: 2, forward: true });
  });

  it("moves to a column as soon as its first point arrives", () => {
    const z = [
      [1, 2, 3, N],
      [4, 5, N, N],
    ];
    expect(findFrontier(z, { axis: "column", index: 1 })).toEqual({
      axis: "column",
      index: 2,
      forward: true,
    });
  });

  it("follows columns when the map grows column by column, as after swapping axes", () => {
    const z = [
      [1, 2, N, N],
      [3, 4, N, N],
    ];
    expect(findFrontier(z)).toEqual({ axis: "column", index: 1, forward: true });
  });

  it("handles a sweep that runs from the last row towards the first", () => {
    const z = [
      [N, N],
      [N, N],
      [1, 2],
      [3, 4],
    ];
    expect(findFrontier(z)).toEqual({ axis: "row", index: 2, forward: false });
  });

  it("uses the row being filled when there is no full row yet", () => {
    const z = [
      [1, 2, N, N],
      [N, N, N, N],
      [N, N, N, N],
    ];
    expect(findFrontier(z)).toEqual({ axis: "row", index: 0, forward: true });
  });

  it("stays on the final line once the measurement is complete", () => {
    const done = [
      [1, 2],
      [3, 4],
    ];
    const final: Frontier = { axis: "row", index: 1, forward: true };
    expect(findFrontier(done, final)).toEqual(final);
    expect(findFrontier(done)).toEqual(final);
  });

  it("reaches the last row when it arrives whole", () => {
    const z = [
      [1, 2, 3],
      [4, 5, 6],
      [N, N, N],
    ];
    const previous = findFrontier(z);
    expect(previous).toEqual({ axis: "row", index: 1, forward: true });
    z[2] = [7, 8, 9];
    expect(findFrontier(z, previous)).toEqual({ axis: "row", index: 2, forward: true });
  });

  it("reaches the last row as soon as its first point arrives", () => {
    const z = [
      [1, 2, 3],
      [4, 5, 6],
      [7, N, N],
    ];
    expect(findFrontier(z, { axis: "row", index: 1, forward: true })).toEqual({
      axis: "row",
      index: 2,
      forward: true,
    });
  });

  it("reaches the last row when a refresh skips the rows before it", () => {
    const z = [
      [1, 2],
      [3, 4],
      [5, 6],
      [7, 8],
    ];
    expect(findFrontier(z, { axis: "row", index: 1, forward: true })).toEqual({
      axis: "row",
      index: 3,
      forward: true,
    });
  });

  it("reaches the first row of a sweep that runs towards it", () => {
    const z = [
      [N, N],
      [N, N],
      [1, 2],
      [3, 4],
    ];
    const previous = findFrontier(z);
    z[1] = [5, 6];
    z[0] = [7, 8];
    expect(findFrontier(z, previous)).toEqual({ axis: "row", index: 0, forward: false });
  });

  it("reaches the last column of a map filled column by column", () => {
    const z = [
      [1, 2, N],
      [3, 4, N],
    ];
    const previous = findFrontier(z);
    expect(previous).toEqual({ axis: "column", index: 1, forward: true });
    z[0][2] = 5;
    z[1][2] = 6;
    expect(findFrontier(z, previous)).toEqual({ axis: "column", index: 2, forward: true });
  });

  it("finds nothing before any point is measured", () => {
    expect(findFrontier([[N, N]])).toBeNull();
    expect(findFrontier([])).toBeNull();
  });
});

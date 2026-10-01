import { afterEach, describe, expect, it, vi } from "vitest";
import { readSessionValue, writeSessionValue } from "./sessionRestore";

describe("sessionRestore", () => {
  afterEach(() => {
    window.sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it("reads back what was written", () => {
    writeSessionValue("plots", [{ id: "a" }]);
    expect(readSessionValue("plots", [])).toEqual([{ id: "a" }]);
  });

  it("falls back when nothing is stored, or something of another shape is", () => {
    expect(readSessionValue("missing", [])).toEqual([]);
    window.sessionStorage.setItem("widths", "[1, 2]");
    expect(readSessionValue("widths", {})).toEqual({});
    window.sessionStorage.setItem("plots", "not json");
    expect(readSessionValue("plots", [])).toEqual([]);
  });

  it("does not throw when storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(() => writeSessionValue("plots", [])).not.toThrow();
  });
});

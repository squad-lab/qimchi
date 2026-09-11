import { describe, expect, it } from "vitest";

import {
  detectDatasetKind,
  hasDatasetTag,
  isDatasetNode,
  isDatasetPath,
  isDatasetTag,
  isMemoryPath,
  isSqliteContainerPath,
  isZarrPath,
} from "./datasetPaths";

describe("path predicates", () => {
  it("recognises every supported dataset extension, case-insensitively", () => {
    for (const path of [
      "C:/data/run.zarr",
      "C:/data/run.nc",
      "C:/data/run.h5",
      "C:/data/run.hdf5",
      "C:/data/run.csv",
      "C:/data/RUN.ZARR",
    ]) {
      expect(isDatasetPath(path)).toBe(true);
    }
    expect(isDatasetPath("C:/data/notes.md")).toBe(false);
    expect(isDatasetPath("C:/data")).toBe(false);
  });

  it("treats a live memory reference as a dataset", () => {
    expect(isMemoryPath("memory://abc")).toBe(true);
    expect(isDatasetPath("memory://abc")).toBe(true);
    expect(isMemoryPath("C:/data/run.zarr")).toBe(false);
  });

  it("ignores a QCoDeS run fragment when reading the extension", () => {
    // The "#run_id=" suffix points into a db; the extension before it decides.
    expect(isDatasetPath("C:/data/experiments.db#run_id=7")).toBe(true);
    expect(isZarrPath("C:/data/run.zarr")).toBe(true);
    expect(isZarrPath("C:/data/run.nc")).toBe(false);
  });

  it("calls a bare sqlite file a container, but not one run inside it", () => {
    // A container is browsable; a single run within it is a dataset leaf.
    expect(isSqliteContainerPath("C:/data/experiments.db")).toBe(true);
    expect(isSqliteContainerPath("C:/data/experiments.sqlite")).toBe(true);
    expect(isSqliteContainerPath("C:/data/experiments.db#run_id=7")).toBe(false);
    expect(isSqliteContainerPath("C:/data/run.zarr")).toBe(false);
  });
});

describe("tag predicates", () => {
  it("accepts known dataset tags only", () => {
    expect(isDatasetTag("zarr")).toBe(true);
    expect(isDatasetTag("reviewed")).toBe(false);
    expect(hasDatasetTag(["reviewed", "zarr"])).toBe(true);
    expect(hasDatasetTag(["reviewed"])).toBe(false);
    expect(hasDatasetTag(undefined)).toBe(false);
  });
});

describe("isDatasetNode", () => {
  it("requires a file with either a dataset path or a dataset tag", () => {
    expect(isDatasetNode({ type: "file", path: "C:/data/run.zarr" })).toBe(true);
    // A tag rescues a path the extension list does not recognise.
    expect(isDatasetNode({ type: "file", path: "C:/data/run.bin", tags: ["zarr"] })).toBe(true);
    expect(isDatasetNode({ type: "folder", path: "C:/data/run.zarr" })).toBe(false);
    expect(isDatasetNode({ type: "file", path: "C:/data/notes.md" })).toBe(false);
    expect(isDatasetNode({ type: "file" })).toBe(false);
  });
});

describe("detectDatasetKind", () => {
  it("prefers the tag over the extension", () => {
    // The backend tags the node; the extension is the fallback.
    expect(detectDatasetKind("C:/data/run.bin", ["netcdf"])).toBe("netcdf");
    expect(detectDatasetKind("C:/data/run.zarr", ["qcodes"])).toBe("qcodes");
    expect(detectDatasetKind("C:/data/run.zarr", ["qcodes-run"])).toBe("qcodes");
  });

  it("falls back to the extension, and calls live data zarr", () => {
    expect(detectDatasetKind("C:/data/run.zarr")).toBe("zarr");
    expect(detectDatasetKind("C:/data/run.nc")).toBe("netcdf");
    expect(detectDatasetKind("C:/data/run.h5")).toBe("hdf5");
    expect(detectDatasetKind("C:/data/run.hdf5")).toBe("hdf5");
    expect(detectDatasetKind("C:/data/experiments.db")).toBe("sqlite");
    expect(detectDatasetKind("memory://abc")).toBe("zarr");
  });

  it("returns unknown rather than guessing", () => {
    expect(detectDatasetKind("C:/data/notes.md")).toBe("unknown");
  });
});

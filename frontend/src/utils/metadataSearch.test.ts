import { describe, expect, it } from "vitest";

import { searchMetadata } from "./metadataSearch";

const metadata = {
  "Sample Name": "chip-Q3",
  Cooldown: 12,
  "Parameters Snapshot": { dac: { voltage: { value: 0.5, unit: "V" } } },
};

describe("searchMetadata", () => {
  it("finds a top-level attribute by its name", () => {
    expect(searchMetadata(metadata, "sample")).toEqual([
      { key: "Sample Name", value: "chip-Q3", path: ["Sample Name"] },
    ]);
  });

  it("finds a top-level attribute by its value", () => {
    expect(searchMetadata(metadata, "Q3").map((m) => m.key)).toEqual(["Sample Name"]);
    expect(searchMetadata(metadata, "12").map((m) => m.key)).toEqual(["Cooldown"]);
  });

  it("finds nested fields with their full path", () => {
    expect(searchMetadata(metadata, "unit")).toEqual([
      { key: "unit", value: "V", path: ["Parameters Snapshot", "dac", "voltage", "unit"] },
    ]);
  });

  it("lists a field once when both its name and its value match", () => {
    expect(searchMetadata({ cryostat: "cryostat-1" }, "cryostat")).toHaveLength(1);
  });

  it("finds nothing when nothing matches", () => {
    expect(searchMetadata(metadata, "nonexistent")).toEqual([]);
  });
});

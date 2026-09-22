import { describe, expect, it } from "vitest";

import {
  computeSharedFields,
  axisIndependents,
  dependsOnAll,
  resolveAxisIndependents,
  getEligibleDatasetsForComposer,
  getSelectedDatasets,
  isComposerCompatibleWithDataset,
  isFieldShared,
} from "./datasetFieldSelectors";

const dataset = (id: string, independents?: string[], dependents?: string[]) => ({
  id,
  name: `${id}.zarr`,
  path: `C:/data/${id}.zarr`,
  attributes: independents || dependents ? { independents, dependents } : undefined,
});

describe("getSelectedDatasets", () => {
  it("returns the selected items, in list order", () => {
    const items = [dataset("a"), dataset("b"), dataset("c")];

    const selected = getSelectedDatasets(items, new Set(["c", "a"]));

    expect(selected.map((item) => item.id)).toEqual(["a", "c"]);
  });

  it("returns nothing when nothing is selected", () => {
    expect(getSelectedDatasets([dataset("a")], new Set())).toEqual([]);
  });
});

describe("computeSharedFields", () => {
  it("intersects the fields across every dataset that has attributes", () => {
    // Only fields present in all of them can be plotted together.
    const result = computeSharedFields([
      dataset("a", ["gate", "bias"], ["signal", "current"]),
      dataset("b", ["gate"], ["signal"]),
    ]);

    expect([...result.sharedIndeps]).toEqual(["gate"]);
    expect([...result.sharedDeps]).toEqual(["signal"]);
    expect(result.knownDatasetCount).toBe(2);
    expect(result.unknownDatasetCount).toBe(0);
  });

  it("counts datasets whose attributes have not loaded yet", () => {
    // Attributes arrive asynchronously; an unloaded one must not be treated
    // as having no fields, which would empty the intersection.
    const result = computeSharedFields([dataset("a", ["gate"], ["signal"]), dataset("b")]);

    expect([...result.sharedIndeps]).toEqual(["gate"]);
    expect(result.knownDatasetCount).toBe(1);
    expect(result.unknownDatasetCount).toBe(1);
  });

  it("reports nothing shared when no attributes are known at all", () => {
    const result = computeSharedFields([dataset("a"), dataset("b")]);

    expect(result.sharedIndeps.size).toBe(0);
    expect(result.knownDatasetCount).toBe(0);
    expect(result.unknownDatasetCount).toBe(2);
  });

  it("yields an empty intersection when the datasets have nothing in common", () => {
    const result = computeSharedFields([
      dataset("a", ["gate"], ["signal"]),
      dataset("b", ["field"], ["current"]),
    ]);

    expect(result.sharedIndeps.size).toBe(0);
    expect(result.sharedDeps.size).toBe(0);
  });
});

describe("isFieldShared", () => {
  it("looks in the right set for the field's type", () => {
    const shared = computeSharedFields([dataset("a", ["gate"], ["signal"])]);

    expect(isFieldShared("gate", "independent", shared)).toBe(true);
    expect(isFieldShared("signal", "dependent", shared)).toBe(true);
    // A dependent is not shared just because an independent of that name is.
    expect(isFieldShared("gate", "dependent", shared)).toBe(false);
  });
});

describe("isComposerCompatibleWithDataset", () => {
  const selection = { indeps: ["gate"], deps: ["signal"] };

  it("needs every selected field present on the dataset", () => {
    expect(
      isComposerCompatibleWithDataset(selection, {
        independents: ["gate", "bias"],
        dependents: ["signal"],
      }),
    ).toBe(true);

    expect(
      isComposerCompatibleWithDataset(selection, {
        independents: ["bias"],
        dependents: ["signal"],
      }),
    ).toBe(false);
  });

  it('answers "unknown" when the attributes have not loaded', () => {
    // Distinct from false: the answer is not yet knowable, so the caller
    // reports it separately rather than silently skipping the dataset.
    expect(isComposerCompatibleWithDataset(selection, undefined)).toBe("unknown");
  });
});

describe("getEligibleDatasetsForComposer", () => {
  it("splits the selection three ways", () => {
    const result = getEligibleDatasetsForComposer(
      [
        dataset("ok", ["gate"], ["signal"]),
        dataset("missing", ["bias"], ["signal"]),
        dataset("pending"),
      ],
      { indeps: ["gate"], deps: ["signal"] },
    );

    expect(result.eligible.map((d) => d.id)).toEqual(["ok"]);
    expect(result.ineligible.map((d) => d.id)).toEqual(["missing"]);
    expect(result.unknown.map((d) => d.id)).toEqual(["pending"]);
  });

  it("treats an empty selection as eligible for every known dataset", () => {
    const result = getEligibleDatasetsForComposer([dataset("a", ["gate"], ["signal"])], {
      indeps: [],
      deps: [],
    });

    expect(result.eligible).toHaveLength(1);
  });
});

describe("dependsOnAll", () => {
  const mixed = {
    independents: ["up_voltages", "f"],
    dependents: ["lockin_amp", "s21_mag"],
    variable_independents: {
      lockin_amp: ["up_voltages"],
      s21_mag: ["up_voltages", "f"],
    },
  };

  it("keeps a dependent that varies over every selected independent", () => {
    expect(dependsOnAll("s21_mag", ["up_voltages"], mixed)).toBe(true);
    expect(dependsOnAll("s21_mag", ["up_voltages", "f"], mixed)).toBe(true);
    expect(dependsOnAll("lockin_amp", ["up_voltages"], mixed)).toBe(true);
  });

  it("rejects a dependent that does not vary over a selected independent", () => {
    // lockin_amp is 1D along the sweep; nothing to plot against frequency.
    expect(dependsOnAll("lockin_amp", ["f"], mixed)).toBe(false);
    expect(dependsOnAll("lockin_amp", ["up_voltages", "f"], mixed)).toBe(false);
  });

  it("rejects nothing without evidence", () => {
    // Empty selection, unknown variable, and datasets that report no dims at
    // all (flat tables, payloads cached before the field existed).
    expect(dependsOnAll("lockin_amp", [], mixed)).toBe(true);
    expect(dependsOnAll("unknown_var", ["f"], mixed)).toBe(true);
    expect(dependsOnAll("b", ["a"], { independents: ["a"], dependents: ["b"] })).toBe(true);
  });
});

describe("axisIndependents", () => {
  const attributes = {
    independents: ["gate", "bias"],
    dependents: ["current", "measured_gate", "signal"],
    variable_independents: {
      current: ["gate"],
      measured_gate: ["gate"],
      signal: ["gate", "bias"],
    },
  };

  it("resolves an independent to itself", () => {
    expect(axisIndependents("gate", attributes)).toEqual(["gate"]);
  });

  it("resolves a dependent axis to the independent it was swept along", () => {
    expect(axisIndependents("measured_gate", attributes)).toEqual(["gate"]);
  });

  it("refuses a dependent that varies over more than one independent", () => {
    expect(axisIndependents("signal", attributes)).toEqual([]);
  });

  it("says nothing when the dataset reported no dimension info", () => {
    expect(axisIndependents("current", { independents: [], dependents: ["current"] })).toBeNull();
  });

  it("keeps an unknown axis name as itself when resolving a list", () => {
    expect(resolveAxisIndependents(["measured_gate"], attributes)).toEqual(["gate"]);
    expect(resolveAxisIndependents(["mystery"], attributes)).toEqual(["mystery"]);
  });
});

describe("isComposerCompatibleWithDataset with a dependent on an axis", () => {
  const attributes = {
    independents: ["p1"],
    dependents: ["keithley_curr", "mfli_p", "mfli_r"],
    variable_independents: {
      keithley_curr: ["p1"],
      mfli_p: ["p1"],
      mfli_r: ["p1"],
    },
  };

  it("accepts one measured quantity plotted against another", () => {
    expect(
      isComposerCompatibleWithDataset({ indeps: ["keithley_curr"], deps: ["mfli_p"] }, attributes),
    ).toBe(true);
  });

  it("still rejects an axis the dataset does not have", () => {
    expect(
      isComposerCompatibleWithDataset({ indeps: ["not_here"], deps: ["mfli_p"] }, attributes),
    ).toBe(false);
  });

  it("rejects a dependent that varies over more than one independent", () => {
    const twoDimensional = {
      independents: ["gate", "bias"],
      dependents: ["signal", "current"],
      variable_independents: { signal: ["gate", "bias"], current: ["gate"] },
    };

    expect(
      isComposerCompatibleWithDataset({ indeps: ["signal"], deps: ["current"] }, twoDimensional),
    ).toBe(false);
  });
});

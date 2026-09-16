import { describe, expect, it } from "vitest";

import { engineeringFormatter } from "./engineeringFormat";

const volts = {
  unit: "V",
  unit_text: "V",
  engineering_scale: 1,
  engineering_units_text: { "0": "V", "-3": "mV", "-6": "µV", "3": "kV" },
};

describe("engineeringFormatter", () => {
  it("picks one prefix for the whole range", () => {
    const format = engineeringFormatter(volts, [-0.00092, 0.01066]);
    expect(format(-0.00092)).toBe("−0.92 mV");
    expect(format(0.01066)).toBe("10.66 mV");
  });

  it("stays unprefixed when the values need none", () => {
    expect(engineeringFormatter(volts, [4.56, 5.35])(5.35)).toBe("5.35 V");
  });

  it("applies the unit's own scale", () => {
    const nanoamps = {
      unit: "nA",
      unit_text: "nA",
      engineering_scale: 1e-9,
      engineering_units_text: { "-9": "nA", "-12": "pA" },
    };
    expect(engineeringFormatter(nanoamps, [0.25])(0.25)).toBe("250 pA");
  });

  it("puts the prefix on the number when there is no unit", () => {
    expect(engineeringFormatter({ unit: "", unit_text: "" }, [0.002])(0.002)).toBe("2m");
  });

  it("keeps an opaque unit unscaled", () => {
    const format = engineeringFormatter({ unit: "dB", unit_text: "dB" }, [-37.24]);
    expect(format(-37.24)).toBe("−37.24 dB");
  });

  it("falls back to plain numbers without metadata", () => {
    expect(engineeringFormatter(undefined, [1234.5])(1234.5)).toBe("1235");
  });
});

import { describe, expect, it } from "vitest";

import {
  extractQanaryMeasurementId,
  formatQanaryDatasetName,
  formatQanaryMeasurementId,
} from "./measurementDisplay";

const QANARY_ID = "21-680ac98c-e974-437c-a08a-ca2c3fd771c1";

describe("extractQanaryMeasurementId", () => {
  it("pulls the id out of surrounding display text", () => {
    expect(extractQanaryMeasurementId(`Sweep: ${QANARY_ID}.zarr`)).toBe(QANARY_ID);
  });

  it("returns null when there is none, rather than a partial match", () => {
    expect(extractQanaryMeasurementId("Single gate sweep")).toBeNull();
    // A QCoDeS guid has no leading run number, so it is not a qanary id.
    expect(extractQanaryMeasurementId("4df2d70a-0000-0000-0000-019a6e3255ed")).toBeNull();
  });
});

describe("formatQanaryMeasurementId", () => {
  it("collapses the uuid to its first group with a marker", () => {
    expect(formatQanaryMeasurementId(QANARY_ID)).toBe("21-680ac98c*");
  });

  it("leaves anything that is not a qanary id alone", () => {
    // QCoDeS guids must survive untouched: they are the identity elsewhere.
    const guid = "4df2d70a-0000-0000-0000-019a6e3255ed";
    expect(formatQanaryMeasurementId(guid)).toBe(guid);
    expect(formatQanaryMeasurementId("sweep-1")).toBe("sweep-1");
  });
});

describe("formatQanaryDatasetName", () => {
  it("shortens the name but keeps the extension readable", () => {
    expect(formatQanaryDatasetName(`${QANARY_ID}.zarr`)).toBe("21-680ac98c*.zarr");
    expect(formatQanaryDatasetName(`${QANARY_ID}.nc`)).toBe("21-680ac98c*.nc");
  });

  it("only shortens qanary names, and only the extensions it knows", () => {
    expect(formatQanaryDatasetName(`${QANARY_ID}.h5`)).toBe(`${QANARY_ID}.h5`);
    expect(formatQanaryDatasetName("Single gate sweep.zarr")).toBe("Single gate sweep.zarr");
  });
});

const QANARY_MEASUREMENT_ID_PATTERN =
  /\d+-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

const QANARY_DATASET_NAME_PATTERN =
  /^(\d+-[0-9a-f]{8})-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\.(?:zarr|nc))$/i;

/** Return a Qanary/QCUtils measurement ID embedded in display text, if present. */
export const extractQanaryMeasurementId = (text: string): string | null =>
  text.match(QANARY_MEASUREMENT_ID_PATTERN)?.[0] ?? null;

/**
 * Collapse a Qanary/QCUtils ID from `<run>-<uuid>` to `<run>-<uuid first group>*`.
 * Non-Qanary identifiers, including QCoDeS GUIDs, are returned unchanged.
 */
export const formatQanaryMeasurementId = (measurementId: string): string => {
  const match = measurementId.match(
    /^(\d+-[0-9a-f]{8})-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  );
  return match ? `${match[1]}*` : measurementId;
};

/**
 * Shorten only actual Qanary/QCUtils `.zarr` and `.nc` filenames for display,
 * placing `*` immediately before the extension to signal the abbreviation.
 * The caller keeps the original node name/path for every operation.
 */
export const formatQanaryDatasetName = (name: string): string => {
  const match = name.match(QANARY_DATASET_NAME_PATTERN);
  return match ? `${match[1]}*${match[2]}` : name;
};

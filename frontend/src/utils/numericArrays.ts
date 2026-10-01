// Helpers for plain arrays, typed arrays, and Plotly binary arrays.

type BinaryArraySpec = { dtype: string; bdata: string };

const TYPED_ARRAYS: Record<string, new (buffer: ArrayBuffer) => ArrayLike<number>> = {
  f8: Float64Array,
  float64: Float64Array,
  f4: Float32Array,
  float32: Float32Array,
  i1: Int8Array,
  int8: Int8Array,
  u1: Uint8Array,
  uint8: Uint8Array,
  i2: Int16Array,
  int16: Int16Array,
  u2: Uint16Array,
  uint16: Uint16Array,
  i4: Int32Array,
  int32: Int32Array,
  u4: Uint32Array,
  uint32: Uint32Array,
};

const isBinaryArraySpec = (value: unknown): value is BinaryArraySpec =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  typeof (value as BinaryArraySpec).bdata === "string" &&
  typeof (value as BinaryArraySpec).dtype === "string";

/** Decode a `{dtype, bdata}` payload, or return null for an unknown dtype or bad data. */
const decodeBinaryArray = (spec: BinaryArraySpec): ArrayLike<number> | null => {
  try {
    const dtype = String(spec.dtype)
      .trim()
      .replace(/^[<>=|]/, "")
      .toLowerCase();
    const TypedArray = TYPED_ARRAYS[dtype];
    if (!TypedArray) return null;
    const bin = atob(String(spec.bdata));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TypedArray(bytes.buffer);
  } catch {
    return null;
  }
};

const toNumber = (value: unknown): number =>
  value == null ? NaN : typeof value === "number" ? value : Number(value);

export const isArrayLikeValue = (value: unknown): boolean => {
  if (value == null) return false;
  if (Array.isArray(value) || ArrayBuffer.isView(value)) return true;
  if (typeof value !== "object") return false;
  const len = (value as { length?: unknown }).length;
  return typeof len === "number" && Number.isFinite(len) && len >= 0;
};

/** Return the decoded binary payload, or the original array-like value. */
const numberList = (values: unknown): ArrayLike<unknown> | null => {
  if (!values) return null;
  if (isBinaryArraySpec(values)) {
    const decoded = decodeBinaryArray(values);
    if (decoded) return decoded;
  }
  return isArrayLikeValue(values) ? (values as ArrayLike<unknown>) : null;
};

const forEachNumberIn = (
  list: ArrayLike<unknown> | null,
  keepNonFinite: boolean,
  visit: (value: number) => void,
): void => {
  if (!list) return;
  for (let i = 0; i < list.length; i++) {
    const value = toNumber(list[i]);
    if (keepNonFinite || Number.isFinite(value)) visit(value);
  }
};

/** Visit the values from `toNumericArray` without allocating its result. */
const forEachNumber = (
  values: unknown,
  keepNonFinite: boolean,
  visit: (value: number) => void,
): void => forEachNumberIn(numberList(values), keepNonFinite, visit);

/** Preserve unmeasured NaN positions when `keepNonFinite` is true. */
export const toNumericArray = (values: unknown, keepNonFinite = false): number[] => {
  const out: number[] = [];
  forEachNumber(values, keepNonFinite, (value) => out.push(value));
  return out;
};

const parseShape = (shape: unknown): { rows: number; cols: number } | null => {
  if (Array.isArray(shape) && shape.length >= 2) {
    const rows = Number(shape[0]);
    const cols = Number(shape[1]);
    if (Number.isFinite(rows) && Number.isFinite(cols)) {
      return { rows: Math.max(0, Math.floor(rows)), cols: Math.max(0, Math.floor(cols)) };
    }
  }
  if (typeof shape === "string") {
    const nums = shape
      .replace(/[()[\]\s]/g, "")
      .split(",")
      .map((x) => Number(x))
      .filter((x) => Number.isFinite(x));
    if (nums.length >= 2) {
      return { rows: Math.max(0, Math.floor(nums[0])), cols: Math.max(0, Math.floor(nums[1])) };
    }
  }
  return null;
};

/** Visit decoded rows without allocating the full two-dimensional array. */
const forEachRow = (
  values: unknown,
  visitRow: (forEachValue: (visit: (value: number) => void) => void) => void,
): void => {
  if (!values) return;

  // Skip empty rows, but retain rows containing NaN placeholders.
  const listRow = (list: ArrayLike<unknown> | null) => {
    if (!list || list.length === 0) return false;
    visitRow((visit) => forEachNumberIn(list, true, visit));
    return true;
  };
  const rowOf = (row: unknown) => listRow(numberList(row));

  // Decode ndarray-like payloads: { dtype, bdata, shape, _inputArray }.
  if (typeof values === "object" && !Array.isArray(values)) {
    const obj = values as Record<string, unknown>;

    // Plotly stores decoded rows in z._inputArray after rendering.
    if (Array.isArray(obj._inputArray)) {
      let any = false;
      for (const row of obj._inputArray as unknown[]) any = rowOf(row) || any;
      if (any) return;
    }

    const parsedShape = parseShape(obj.shape);
    if (parsedShape) {
      const { rows, cols } = parsedShape;
      const source = numberList(obj);
      if (source && rows > 0 && cols > 0 && source.length >= rows * cols) {
        for (let r = 0; r < rows; r++) {
          visitRow((visit) => {
            for (let i = r * cols; i < (r + 1) * cols; i++) visit(toNumber(source[i]));
          });
        }
        return;
      }
    }
  }

  if (!isArrayLikeValue(values)) return;
  const rows = values as ArrayLike<unknown>;
  if (rows.length === 0) return;

  if (isArrayLikeValue(rows[0])) {
    for (let r = 0; r < rows.length; r++) rowOf(rows[r]);
    return;
  }
  // Treat a flat list as one row.
  listRow(rows);
};

export const toNumeric2DArray = (values: unknown): number[][] => {
  const out: number[][] = [];
  forEachRow(values, (forEachValue) => {
    const row: number[] = [];
    forEachValue((value) => row.push(value));
    out.push(row);
  });
  return out;
};

const extentOf = (scan: (visit: (value: number) => void) => void): number[] => {
  let count = 0;
  let minimum = Infinity;
  let maximum = -Infinity;
  scan((value) => {
    count++;
    if (value < minimum) minimum = value;
    if (value > maximum) maximum = value;
  });
  return count ? [minimum, maximum] : [];
};

/** Return the `toNumericArray` extent without allocating the decoded array. */
export const numericExtent = (values: unknown, keepNonFinite = false): number[] =>
  extentOf((visit) => forEachNumber(values, keepNonFinite, visit));

/** Return the flattened `toNumeric2DArray` extent without allocating it. */
export const numeric2DExtent = (values: unknown): number[] =>
  extentOf((visit) => forEachRow(values, (forEachValue) => forEachValue(visit)));

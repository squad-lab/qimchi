import { describe, expect, it } from "vitest";
import { numeric2DExtent, numericExtent, toNumeric2DArray, toNumericArray } from "./numericArrays";

// Reference implementations from the previous PlotWrapper code.
const isArrayLikeValueRef = (value: unknown): boolean => {
  if (value == null) return false;
  if (Array.isArray(value) || ArrayBuffer.isView(value)) return true;
  if (typeof value !== "object") return false;
  const len = (value as { length?: unknown }).length;
  return typeof len === "number" && Number.isFinite(len) && len >= 0;
};

const toNumericArrayRef =
  // Preserve NaN placeholders when reshaping live heat maps.
  (values: unknown, keepNonFinite = false): number[] => {
    if (!values) return [];

    if (typeof values === "object" && !Array.isArray(values)) {
      const obj = values as Record<string, unknown>;

      // Plotly/NumPy binary typed-array payload: { dtype, bdata }.
      if (typeof obj.bdata === "string" && typeof obj.dtype === "string") {
        try {
          const dtypeRaw = String(obj.dtype).trim();
          const dtype = dtypeRaw.replace(/^[<>=|]/, "").toLowerCase();
          const b64 = String(obj.bdata);
          const bin = atob(b64);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          const buffer = bytes.buffer;

          const typedToNumbers = (arr: ArrayLike<number | bigint>) =>
            Array.from(arr as ArrayLike<number | bigint>)
              .map((v) => (typeof v === "bigint" ? Number(v) : Number(v)))
              .filter((v) => keepNonFinite || Number.isFinite(v));

          if (dtype === "f8" || dtype === "float64") {
            return typedToNumbers(new Float64Array(buffer));
          }
          if (dtype === "f4" || dtype === "float32") {
            return typedToNumbers(new Float32Array(buffer));
          }
          if (dtype === "i1" || dtype === "int8") {
            return typedToNumbers(new Int8Array(buffer));
          }
          if (dtype === "u1" || dtype === "uint8") {
            return typedToNumbers(new Uint8Array(buffer));
          }
          if (dtype === "i2" || dtype === "int16") {
            return typedToNumbers(new Int16Array(buffer));
          }
          if (dtype === "u2" || dtype === "uint16") {
            return typedToNumbers(new Uint16Array(buffer));
          }
          if (dtype === "i4" || dtype === "int32") {
            return typedToNumbers(new Int32Array(buffer));
          }
          if (dtype === "u4" || dtype === "uint32") {
            return typedToNumbers(new Uint32Array(buffer));
          }
        } catch {
          // Fall through to the array-like decoder.
        }
      }
    }

    if (!isArrayLikeValueRef(values)) return [];

    return Array.from(values as ArrayLike<unknown>)
      .map((v) => (v == null ? NaN : typeof v === "number" ? v : Number(v)))
      .filter((v) => keepNonFinite || Number.isFinite(v));
  };

const toNumeric2DArrayRef = (values: unknown): number[][] => {
  if (!values) return [];

  // Decode ndarray-like payloads: { dtype, bdata, shape, _inputArray }.
  if (typeof values === "object" && !Array.isArray(values)) {
    const obj = values as Record<string, unknown>;

    // Prefer Plotly's decoded, row-structured _inputArray.
    if (Array.isArray(obj._inputArray)) {
      const rowsFromInputArray = (obj._inputArray as unknown[])
        .map((row) => toNumericArrayRef(row, true))
        .filter((row) => row.length > 0);
      if (rowsFromInputArray.length > 0) {
        return rowsFromInputArray;
      }
    }

    const shapeRaw = obj.shape;

    const parseShape = (shape: unknown): { rows: number; cols: number } | null => {
      if (Array.isArray(shape) && shape.length >= 2) {
        const rows = Number(shape[0]);
        const cols = Number(shape[1]);
        if (Number.isFinite(rows) && Number.isFinite(cols)) {
          return {
            rows: Math.max(0, Math.floor(rows)),
            cols: Math.max(0, Math.floor(cols)),
          };
        }
      }
      if (typeof shape === "string") {
        const nums = shape
          .replace(/[()[\]\s]/g, "")
          .split(",")
          .map((x) => Number(x))
          .filter((x) => Number.isFinite(x));
        if (nums.length >= 2) {
          return {
            rows: Math.max(0, Math.floor(nums[0])),
            cols: Math.max(0, Math.floor(nums[1])),
          };
        }
      }
      return null;
    };

    const parsedShape = parseShape(shapeRaw);
    if (parsedShape) {
      const rows = parsedShape.rows;
      const cols = parsedShape.cols;
      const flat = toNumericArrayRef(values, true);
      if (rows > 0 && cols > 0 && flat.length >= rows * cols) {
        const out: number[][] = [];
        for (let r = 0; r < rows; r++) {
          out.push(flat.slice(r * cols, (r + 1) * cols));
        }
        return out;
      }
    }
  }

  if (!isArrayLikeValueRef(values)) return [];

  const rows = Array.from(values as ArrayLike<unknown>);
  if (rows.length === 0) return [];

  const first = rows[0];
  if (isArrayLikeValueRef(first)) {
    return rows.map((row) => toNumericArrayRef(row, true)).filter((row) => row.length > 0);
  }

  const flat = toNumericArrayRef(rows, true);
  return flat.length > 0 ? [flat] : [];
};

const extentOf = (values: number[]): number[] => {
  let minimum = Infinity;
  let maximum = -Infinity;
  for (const value of values) {
    if (value < minimum) minimum = value;
    if (value > maximum) maximum = value;
  }
  return values.length ? [minimum, maximum] : [];
};

const b64 = (array: ArrayBufferView) => {
  const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text);
};

const spec = (array: Float32Array | Float64Array | Int16Array, dtype: string, shape?: unknown) => ({
  dtype,
  bdata: b64(array),
  ...(shape === undefined ? {} : { shape }),
});

// Plotly represents rendered z data as row views over one buffer.
const drawnSpec = (rows: number, cols: number, values: Float32Array) => ({
  ...spec(values, "f4", `${rows}, ${cols}`),
  _inputArray: Array.from({ length: rows }, (_, r) => values.subarray(r * cols, (r + 1) * cols)),
});

const grid = new Float32Array([1, 2, NaN, -4, 5e-9, NaN, 7, 8, 9]);
const withInfinity = new Float64Array([1, Infinity, NaN, -2]);

const CASES: Record<string, unknown> = {
  undefined: undefined,
  null: null,
  zero: 0,
  emptyString: "",
  string: "12,3",
  number: 5,
  emptyArray: [],
  flat: [3, "4", null, undefined, NaN, Infinity, -1, true, "x"],
  nested: [[1, 2, NaN], [], [-3, "5", null]],
  nestedTyped: [new Float32Array([1, NaN]), new Float64Array([-Infinity, 4])],
  nestedWithJunk: [[1, 2], 7, null, { length: 2, 0: 9 }],
  // eslint-disable-next-line no-sparse-arrays
  sparse: [1, , 3],
  arrayLikeObject: { length: 3, 0: 4, 2: -6 },
  typed: new Float64Array([2, NaN, -8]),
  f4Spec: spec(grid, "f4"),
  f4Shaped: spec(grid, "f4", "3, 3"),
  f4ShapedArray: spec(grid, "<f4", [3, 3]),
  f4ShapeTooBig: spec(grid, "f4", "4, 3"),
  f4ShapeOneDim: spec(grid, "f4", "9"),
  f8Infinity: spec(withInfinity, "float64", "2, 2"),
  i2Spec: spec(new Int16Array([5, -7, 3, 0]), "i2", "2, 2"),
  unknownDtype: spec(grid, "f2", "3, 3"),
  badBase64: { dtype: "f4", bdata: "@@not base64@@", shape: "1, 1" },
  drawn: drawnSpec(3, 3, grid),
  drawnEmptyRows: { ...spec(grid, "f4", "3, 3"), _inputArray: [[], []] },
  allNaN: [[NaN, NaN], [NaN]],
  live: drawnSpec(2, 4, new Float32Array([0.5, -0.25, 3, 1, NaN, NaN, NaN, NaN])),
};

describe("numericArrays", () => {
  for (const [name, value] of Object.entries(CASES)) {
    it(`matches the old conversions for ${name}`, () => {
      expect(toNumericArray(value)).toEqual(toNumericArrayRef(value));
      expect(toNumericArray(value, true)).toEqual(toNumericArrayRef(value, true));
      expect(toNumeric2DArray(value)).toEqual(toNumeric2DArrayRef(value));
    });

    it(`gives the old range for ${name}`, () => {
      expect(numericExtent(value)).toEqual(extentOf(toNumericArrayRef(value)));
      expect(numericExtent(value, true)).toEqual(extentOf(toNumericArrayRef(value, true)));
      expect(numeric2DExtent(value)).toEqual(extentOf(toNumeric2DArrayRef(value).flat()));
    });
  }

  it("matches on random live heat maps", () => {
    let seed = 7;
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let trial = 0; trial < 50; trial++) {
      const rows = 1 + Math.floor(random() * 20);
      const cols = 1 + Math.floor(random() * 20);
      const values = new Float32Array(rows * cols).map(() =>
        random() < 0.3 ? NaN : (random() - 0.5) * 10 ** Math.floor(random() * 20 - 10),
      );
      for (const z of [spec(values, "f4", `${rows}, ${cols}`), drawnSpec(rows, cols, values)]) {
        expect(numeric2DExtent(z)).toEqual(extentOf(toNumeric2DArrayRef(z).flat()));
        expect(toNumeric2DArray(z)).toEqual(toNumeric2DArrayRef(z));
      }
    }
  });
});

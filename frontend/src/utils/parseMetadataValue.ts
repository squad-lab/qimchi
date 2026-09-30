const isJsonValueBoundaryBefore = (character: string | undefined) =>
  character === undefined ||
  character === ":" ||
  character === "," ||
  character === "[" ||
  /\s/.test(character);

const isJsonValueBoundaryAfter = (character: string | undefined) =>
  character === undefined ||
  character === "," ||
  character === "]" ||
  character === "}" ||
  /\s/.test(character);

type PythonJsonConstant = "-Infinity" | "Infinity" | "NaN";

const pythonJsonConstants: PythonJsonConstant[] = ["-Infinity", "Infinity", "NaN"];

/**
 * Replace the non-standard number literals emitted by Python's json.dumps
 * with temporary JSON strings. Quoted occurrences are left untouched.
 */
const normalizePythonJsonConstants = (value: string, marker: string) => {
  let normalized = "";
  let inString = false;
  let escaped = false;

  for (let index = 0; index < value.length;) {
    const character = value[index];

    if (inString) {
      normalized += character;
      index += 1;

      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }

    if (character === '"') {
      inString = true;
      normalized += character;
      index += 1;
      continue;
    }

    const token = pythonJsonConstants.find(
      (candidate) =>
        value.startsWith(candidate, index) &&
        isJsonValueBoundaryBefore(value[index - 1]) &&
        isJsonValueBoundaryAfter(value[index + candidate.length]),
    );

    if (token) {
      normalized += JSON.stringify(`${marker}${token}`);
      index += token.length;
      continue;
    }

    normalized += character;
    index += 1;
  }

  return normalized;
};

const parsePythonJsonConstants = (value: string): unknown => {
  let marker = "__qimchi_non_finite_number__";
  while (value.includes(marker)) {
    marker += "_";
  }

  const normalized = normalizePythonJsonConstants(value, marker);
  return JSON.parse(normalized, (_key, parsedValue: unknown) => {
    if (typeof parsedValue !== "string" || !parsedValue.startsWith(marker)) {
      return parsedValue;
    }

    const token = parsedValue.slice(marker.length) as PythonJsonConstant;
    switch (token) {
      case "Infinity":
        return Number.POSITIVE_INFINITY;
      case "-Infinity":
        return Number.NEGATIVE_INFINITY;
      case "NaN":
        return Number.NaN;
      default:
        return parsedValue;
    }
  });
};

export const parseMetadataValue = (value: unknown): unknown => {
  if (typeof value !== "string") {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch {
    try {
      return parsePythonJsonConstants(value);
    } catch {
      // Not a JSON string, so preserve the original metadata value.
      return value;
    }
  }
};

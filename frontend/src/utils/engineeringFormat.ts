// Mirrors api/units.py::_PREFIXES.
export const SI_PREFIXES: Record<number, string> = {
  24: "Y",
  21: "Z",
  18: "E",
  15: "P",
  12: "T",
  9: "G",
  6: "M",
  3: "k",
  0: "",
  "-3": "m",
  "-6": "µ",
  "-9": "n",
  "-12": "p",
  "-15": "f",
  "-18": "a",
  "-21": "z",
  "-24": "y",
};

/** The per-axis unit metadata the backend puts in `layout.meta.qimchi_units`. */
export interface AxisUnitMeta {
  unit?: string;
  unit_text?: string;
  engineering_scale?: number;
  engineering_units_text?: Record<string, string>;
}

/**
 * Returns a formatter that labels values in the SI prefix suited to `values`,
 * so the ends of a range share one prefix ("−920 mV", "10.7 V" would not).
 * Without unit metadata the numbers are shown plainly.
 */
export function engineeringFormatter(
  definition: AxisUnitMeta | undefined,
  values: number[],
): (value: number) => string {
  const scale = Number(definition?.engineering_scale ?? 1);
  const unitScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const prefixed = definition?.engineering_units_text ?? {};
  const exponents = Object.keys(prefixed).map(Number).filter(Number.isFinite);
  const dimensionless = !exponents.length && definition?.unit === "";

  const magnitude = Math.max(0, ...values.filter(Number.isFinite).map(Math.abs)) * unitScale;
  const desired = magnitude > 0 ? 3 * Math.floor(Math.log10(magnitude) / 3) : 0;
  const nearest = (candidates: number[]) =>
    candidates.reduce((best, candidate) =>
      Math.abs(candidate - desired) < Math.abs(best - desired) ? candidate : best,
    );

  let exponent = 0;
  let suffix = definition?.unit_text ? ` ${definition.unit_text}` : "";
  if (exponents.length) {
    exponent = nearest(exponents);
    suffix = prefixed[String(exponent)] ? ` ${prefixed[String(exponent)]}` : "";
  } else if (dimensionless) {
    exponent = Math.max(-24, Math.min(24, desired));
    // As on a dimensionless axis's ticks: "2m", not a unit called "m".
    suffix = SI_PREFIXES[exponent] ?? "";
  } else {
    // An opaque unit (dB, e²/h) cannot take a prefix, so scale nothing.
    return (value) => `${formatNumber(value * unitScale)}${suffix}`;
  }

  const factor = unitScale / 10 ** exponent;
  return (value) => `${formatNumber(value * factor)}${suffix}`;
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  return Number(value.toPrecision(4)).toString().replace("-", "−");
}

const NICE_FRACTIONS = [1, 2, 5, 10];

/**
 * Evenly spaced round tick values (1, 2 or 5 times a power of ten) inside
 * [minimum, maximum], aiming for about `count` of them.
 */
export function niceTicks(
  minimum: number,
  maximum: number,
  count: number,
): { ticks: number[]; step: number } {
  const span = maximum - minimum;
  const rough = span / Math.max(1, count - 1);
  if (!Number.isFinite(rough) || rough <= 0) return { ticks: [minimum], step: 1 };

  let power = 10 ** Math.floor(Math.log10(rough));
  let index = NICE_FRACTIONS.findIndex((fraction) => rough / power <= fraction);
  const ticksFor = (step: number) => {
    const ticks: number[] = [];
    const first = Math.ceil(minimum / step - 1e-10) * step;
    for (let tick = first; tick <= maximum + step * 1e-9 && ticks.length < 1000; tick += step) {
      ticks.push(tick);
    }
    return ticks;
  };

  let step = NICE_FRACTIONS[index] * power;
  let ticks = ticksFor(step);
  // Rounding the step up can leave a single tick (a 100-900 range gets a
  // step of 500), so a colour bar would show one label. Step down until
  // there are at least two.
  while (ticks.length < 2) {
    if (index === 0) {
      index = NICE_FRACTIONS.length - 1;
      power /= 10;
    }
    index -= 1;
    step = NICE_FRACTIONS[index] * power;
    ticks = ticksFor(step);
  }
  return { ticks, step };
}

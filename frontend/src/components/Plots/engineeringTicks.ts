/** Axis ticks and titles in engineering units. */

import { niceTicks, SI_PREFIXES } from "../../utils/engineeringFormat";

export interface EngineeringUnitMeta {
  unit?: string;
  engineering_scale?: number;
  engineering_titles?: Record<string, string>;
}

export interface EngineeringPresentation {
  /** The axis title for the chosen prefix, or undefined to leave it alone. */
  title?: string;
  tickvals: number[];
  ticktext: string[];
}

const formatTick = (value: number, step: number): string => {
  if (Math.abs(value) < Math.abs(step) * 1e-10) return "0";
  const decimals = Math.max(0, Math.min(8, -Math.floor(Math.log10(Math.abs(step))) + 1));
  return Number(value.toFixed(decimals)).toString().replace("-", "−");
};

/** Build ticks and a title for an axis range, or null without unit metadata. */
export const engineeringPresentation = (
  definition: EngineeringUnitMeta | undefined,
  values: number[],
  requestedTicks: number,
): EngineeringPresentation | null => {
  const titles = definition?.engineering_titles || {};
  const exponents = Object.keys(titles).map(Number).filter(Number.isFinite);
  // Put engineering prefixes on ticks when there is no unit title.
  const dimensionless = !exponents.length && definition?.unit === "";
  if (!values.length || (!exponents.length && !dimensionless)) return null;

  const unitScale = Number(definition?.engineering_scale ?? 1);
  if (!Number.isFinite(unitScale) || unitScale <= 0) return null;
  let minimum = Infinity;
  let maximum = -Infinity;
  for (const value of values) {
    if (value < minimum) minimum = value;
    if (value > maximum) maximum = value;
  }
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum)) return null;
  const maxMagnitude = Math.max(Math.abs(minimum), Math.abs(maximum)) * unitScale;
  let desiredExponent = 0;
  if (maxMagnitude > 0 && Number.isFinite(maxMagnitude)) {
    desiredExponent = 3 * Math.floor(Math.log10(maxMagnitude) / 3);
  }
  const exponent = dimensionless
    ? Math.max(-24, Math.min(24, desiredExponent))
    : exponents.reduce((best, candidate) =>
        Math.abs(candidate - desiredExponent) < Math.abs(best - desiredExponent) ? candidate : best,
      );
  const displayFactor = unitScale / 10 ** exponent;
  const { ticks: displayTicks, step } = niceTicks(
    minimum * displayFactor,
    maximum * displayFactor,
    requestedTicks,
  );
  const tickPrefix = dimensionless ? SI_PREFIXES[exponent] || "" : "";
  return {
    title: dimensionless ? undefined : titles[String(exponent)],
    tickvals: displayTicks.map((tick) => tick / displayFactor),
    ticktext: displayTicks.map((tick) => {
      const text = formatTick(tick, step);
      // A bare "0m" reads as a unit, not a magnitude.
      return tickPrefix && text !== "0" ? `${text}${tickPrefix}` : text;
    }),
  };
};

/** The unit metadata the backend attaches to a figure, by axis. */
export const unitMetaFromLayout = (
  layout: unknown,
): Record<string, EngineeringUnitMeta | undefined> => {
  const meta = (layout as { meta?: { qimchi_units?: Record<string, EngineeringUnitMeta> } })?.meta;
  return meta?.qimchi_units ?? {};
};

import type { PresetFilter } from "../services/libraryAPI";
import { filterLabel } from "./filterNames";

/** Summarize filters in application order. */
export const presetSummary = (filters: PresetFilter[]): string =>
  filters.map((filter) => filterLabel(filter.name)).join(" → ");

// Ignore object key order when comparing options.
const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, canonical((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
};

const optionsKey = (filter: PresetFilter) => JSON.stringify(canonical(filter.options ?? {}));

export const samePresetFilters = (a: PresetFilter[], b: PresetFilter[]): boolean =>
  a.length === b.length &&
  a.every((filter, i) => filter.name === b[i].name && optionsKey(filter) === optionsKey(b[i]));

const isPlain = (value: unknown) => value === null || typeof value !== "object";
const shown = (value: unknown) => (value === undefined ? "unset" : String(value));

/** "window 5 → 7, mode interp → nearest": the options that differ, and how. */
const settingChanges = (before: PresetFilter, after: PresetFilter): string => {
  const a = (before.options ?? {}) as Record<string, unknown>;
  const b = (after.options ?? {}) as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])]
    .filter((key) => key !== "enabled")
    .filter((key) => JSON.stringify(canonical(a[key])) !== JSON.stringify(canonical(b[key])))
    .sort();
  return keys
    .map((key) =>
      isPlain(a[key]) && isPlain(b[key]) ? `${key} ${shown(a[key])} → ${shown(b[key])}` : key,
    )
    .join(", ");
};

/** Describe filter, option, and order changes from a saved preset. */
export const describePresetChanges = (saved: PresetFilter[], current: PresetFilter[]): string[] => {
  const savedByName = new Map(saved.map((filter) => [filter.name, filter]));
  const currentNames = new Set(current.map((filter) => filter.name));
  const changes: string[] = [];

  for (const filter of current) {
    const before = savedByName.get(filter.name);
    if (!before) changes.push(`Added ${filterLabel(filter.name)}`);
    else if (optionsKey(before) !== optionsKey(filter)) {
      const detail = settingChanges(before, filter);
      changes.push(`Changed ${filterLabel(filter.name)}${detail ? `: ${detail}` : " settings"}`);
    }
  }
  for (const filter of saved) {
    if (!currentNames.has(filter.name)) changes.push(`Removed ${filterLabel(filter.name)}`);
  }

  const keptSaved = saved.map((f) => f.name).filter((name) => currentNames.has(name));
  const keptCurrent = current.map((f) => f.name).filter((name) => savedByName.has(name));
  if (keptSaved.some((name, i) => name !== keptCurrent[i])) changes.push("Changed the order");

  return changes;
};

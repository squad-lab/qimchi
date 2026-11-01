/** Selected Basket IDs and the anchor for range selection. */
export interface BasketSelection {
  ids: string[];
  anchor: string | null;
}

export const EMPTY_SELECTION: BasketSelection = { ids: [], anchor: null };

export const selectOnly = (id: string): BasketSelection => ({ ids: [id], anchor: id });

/** Toggle one measurement while keeping at least one selected. */
export function toggleSelected(selection: BasketSelection, id: string): BasketSelection {
  if (!selection.ids.includes(id)) return { ids: [...selection.ids, id], anchor: id };
  if (selection.ids.length === 1) return selection;
  return { ids: selection.ids.filter((selected) => selected !== id), anchor: id };
}

/** Select a Basket range; `add` preserves the existing selection. */
export function selectRange(
  selection: BasketSelection,
  order: string[],
  id: string,
  add = false,
): BasketSelection {
  const to = order.indexOf(id);
  if (to < 0) return selection;
  const anchor = selection.anchor && order.includes(selection.anchor) ? selection.anchor : id;
  const from = order.indexOf(anchor);
  const range = order.slice(Math.min(from, to), Math.max(from, to) + 1);
  return { ids: add ? [...new Set([...selection.ids, ...range])] : range, anchor };
}

export const selectAll = (selection: BasketSelection, order: string[]): BasketSelection => ({
  ids: [...order],
  anchor: selection.anchor ?? order[0] ?? null,
});

/** Find the next ID in Basket order, clamped to either end. */
export function stepFrom(
  order: string[],
  id: string | null,
  step: -1 | 1 | "first" | "last",
): string | null {
  if (order.length === 0) return null;
  if (step === "first") return order[0];
  if (step === "last") return order[order.length - 1];
  const at = id === null ? -1 : order.indexOf(id);
  if (at < 0) return order[step === 1 ? 0 : order.length - 1];
  return order[Math.min(order.length - 1, Math.max(0, at + step))];
}

/**
 * Remove missing IDs and select the nearest remaining item if none survive.
 * Keep one item selected whenever the Basket is nonempty.
 */
export function reconcileSelection(
  selection: BasketSelection,
  before: string[],
  after: string[],
): BasketSelection {
  const present = new Set(after);
  const ids = selection.ids.filter((id) => present.has(id));
  if (ids.length > 0) {
    const anchor = selection.anchor && present.has(selection.anchor) ? selection.anchor : ids[0];
    return ids.length === selection.ids.length && anchor === selection.anchor
      ? selection
      : { ids, anchor };
  }
  if (after.length === 0) return selection.ids.length === 0 ? selection : EMPTY_SELECTION;

  const removedAt = selection.ids.map((id) => before.indexOf(id)).filter((index) => index >= 0);
  if (removedAt.length > 0) {
    const start = Math.min(...removedAt);
    const replacement =
      before.slice(start).find((id) => present.has(id)) ??
      before
        .slice(0, start)
        .reverse()
        .find((id) => present.has(id));
    if (replacement) return selectOnly(replacement);
  }
  return selectOnly(after[0]);
}

/** Parse stored selection data, falling back to an empty selection. */
export function parseSelection(value: unknown): BasketSelection {
  if (typeof value !== "object" || value === null) return EMPTY_SELECTION;
  const { ids, anchor } = value as Record<string, unknown>;
  if (!Array.isArray(ids) || !ids.every((id) => typeof id === "string")) return EMPTY_SELECTION;
  return { ids, anchor: typeof anchor === "string" ? anchor : null };
}

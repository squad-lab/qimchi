/**
 * Release backend contexts after their last open plot closes, with a delay
 * for reopening. Transform requests include a local copy to restore a context
 * the server has released or evicted.
 **/
import axios from "axios";

import { PROD_BACKEND_URL } from "../config";
import type { LineCut } from "../components/interfaces";

export interface PlotContext {
  fpath: string;
  indeps: string[];
  deps: string[];
  plotType: "LinePlot" | "HeatMap";
  cut?: LineCut;
}

/** Grace period before releasing a context with no active holders. */
export const RELEASE_DELAY_MS = 30_000;

interface Entry {
  context?: PlotContext;
  holders: number;
  /** Timestamp when the last holder released the context; null while in use. */
  idleSince: number | null;
}

const entries = new Map<string, Entry>();
let timer: ReturnType<typeof setTimeout> | null = null;

const schedule = () => {
  timer ??= setTimeout(flush, RELEASE_DELAY_MS);
};

function flush() {
  timer = null;
  const now = Date.now();
  const due: string[] = [];
  let waiting = false;
  for (const [ref, entry] of entries) {
    if (entry.holders > 0 || entry.idleSince === null) continue;
    if (now - entry.idleSince >= RELEASE_DELAY_MS) {
      due.push(ref);
      entries.delete(ref);
    } else {
      waiting = true;
    }
  }
  if (waiting) schedule();
  if (due.length === 0) return;
  // Release failures are safe to ignore because the server cache is bounded.
  axios
    .post(`${PROD_BACKEND_URL}/plot-contexts/release`, { plot_refs: due })
    .catch(() => undefined);
}

/** Cache the plot parameters returned by the backend for a reference. */
export function rememberPlotContext(ref: string, context: PlotContext | undefined): void {
  const entry = entries.get(ref);
  if (entry) {
    if (context) entry.context = context;
    return;
  }
  // Schedule release unless a plot acquires the context.
  entries.set(ref, { context, holders: 0, idleSince: Date.now() });
  schedule();
}

/** Hold a context while a plot uses it; the returned callback releases that hold. */
export function holdPlotContext(ref: string): () => void {
  let entry = entries.get(ref);
  if (!entry) {
    entry = { holders: 0, idleSince: null };
    entries.set(ref, entry);
  }
  entry.holders += 1;
  entry.idleSince = null;
  let held = true;
  return () => {
    if (!held) return;
    held = false;
    const current = entries.get(ref);
    if (!current) return;
    current.holders = Math.max(0, current.holders - 1);
    if (current.holders === 0) {
      current.idleSince = Date.now();
      schedule();
    }
  };
}

export const plotContextFor = (ref: string): PlotContext | undefined => entries.get(ref)?.context;

/** Number of tracked references, for tests and diagnostics. */
export const trackedPlotContexts = (): number => entries.size;

export function resetPlotContextsForTests(): void {
  entries.clear();
  if (timer) clearTimeout(timer);
  timer = null;
}

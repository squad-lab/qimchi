/** Collect live-refresh timings for the local app log. */

import axios from "axios";

import { PROD_BACKEND_URL } from "../config";

export interface LiveRefreshSummary {
  /** "HeatMap" or "LinePlot". */
  plotType: string;
  /** Refreshes in this summary. */
  count: number;
  /** Refresh durations, in ms: request, render and all. */
  medianMs: number;
  p90Ms: number;
  minMs: number;
  maxMs: number;
  /** Wall-clock seconds the summary covers, so a rate can be derived. */
  windowSeconds: number;
  /** Points in the last refresh, so the cost can be read against the size. */
  points: number;
  /** How many plots were polling while this one was measured. */
  concurrentPlots: number;
}

const REPORT_AFTER = 60; // refreshes
const REPORT_AFTER_MS = 120_000;

const percentile = (sorted: number[], fraction: number): number => {
  if (!sorted.length) return 0;
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * fraction));
  return Math.round(sorted[index]);
};

class LiveRefreshRecorder {
  private durations: number[] = [];
  private startedAt = 0;
  private lastPoints = 0;
  private plotType = "";

  /** Number of plots currently refreshing, kept for the summary. */
  static active = 0;

  record(plotType: string, durationMs: number, points: number): LiveRefreshSummary | null {
    if (!this.durations.length) this.startedAt = Date.now();
    this.plotType = plotType;
    this.lastPoints = points;
    this.durations.push(durationMs);

    const elapsed = Date.now() - this.startedAt;
    if (this.durations.length < REPORT_AFTER && elapsed < REPORT_AFTER_MS) return null;

    const sorted = [...this.durations].sort((a, b) => a - b);
    const summary: LiveRefreshSummary = {
      plotType: this.plotType,
      count: sorted.length,
      medianMs: percentile(sorted, 0.5),
      p90Ms: percentile(sorted, 0.9),
      minMs: Math.round(sorted[0]),
      maxMs: Math.round(sorted[sorted.length - 1]),
      windowSeconds: Math.round(elapsed / 1000),
      points: this.lastPoints,
      concurrentPlots: LiveRefreshRecorder.active,
    };
    this.durations = [];
    return summary;
  }
}

export const createLiveRefreshRecorder = (): LiveRefreshRecorder => new LiveRefreshRecorder();

export const markLivePlotActive = (active: boolean): void => {
  LiveRefreshRecorder.active = Math.max(0, LiveRefreshRecorder.active + (active ? 1 : -1));
};

/** Send a timing summary to the backend log. */
export const reportLiveRefresh = async (summary: LiveRefreshSummary): Promise<void> => {
  try {
    await axios.post(`${PROD_BACKEND_URL}/telemetry/live-refresh`, summary, { timeout: 5000 });
  } catch {
    // Timing reports are best-effort.
  }
};

export const __testing = { percentile, REPORT_AFTER, REPORT_AFTER_MS };

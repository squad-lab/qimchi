import { describe, expect, it } from "vitest";

import { createLiveRefreshRecorder, markLivePlotActive } from "./liveRefreshStats";

describe("live refresh recorder", () => {
  it("says nothing until it has enough refreshes to summarise", () => {
    const recorder = createLiveRefreshRecorder();

    for (let i = 0; i < 59; i++) {
      expect(recorder.record("HeatMap", 800, 250_000)).toBeNull();
    }

    expect(recorder.record("HeatMap", 800, 250_000)).not.toBeNull();
  });

  it("summarises the refresh times it saw", () => {
    const recorder = createLiveRefreshRecorder();
    let summary = null;
    for (let ms = 1; ms <= 60; ms++) {
      summary = recorder.record("LinePlot", ms, 4_096) ?? summary;
    }

    expect(summary).toMatchObject({
      plotType: "LinePlot",
      count: 60,
      minMs: 1,
      maxMs: 60,
      medianMs: 31,
      p90Ms: 55,
      points: 4_096,
    });
  });

  it("starts a fresh window after each summary", () => {
    const recorder = createLiveRefreshRecorder();
    for (let i = 0; i < 60; i++) recorder.record("HeatMap", 500, 10);

    for (let i = 0; i < 59; i++) {
      expect(recorder.record("HeatMap", 500, 10)).toBeNull();
    }
    expect(recorder.record("HeatMap", 500, 10)?.count).toBe(60);
  });

  it("counts how many plots were polling at once", () => {
    markLivePlotActive(true);
    markLivePlotActive(true);
    const recorder = createLiveRefreshRecorder();
    let summary = null;
    for (let i = 0; i < 60; i++) summary = recorder.record("HeatMap", 100, 10) ?? summary;

    expect(summary?.concurrentPlots).toBe(2);

    markLivePlotActive(false);
    markLivePlotActive(false);
  });
});

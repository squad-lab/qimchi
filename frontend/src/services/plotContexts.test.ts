import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { post } = vi.hoisted(() => ({ post: vi.fn(() => Promise.resolve({ data: {} })) }));
vi.mock("axios", () => ({ default: { post } }));

import {
  holdPlotContext,
  plotContextFor,
  RELEASE_DELAY_MS,
  rememberPlotContext,
  resetPlotContextsForTests,
  trackedPlotContexts,
} from "./plotContexts";

const context = { fpath: "run.nc", indeps: ["x"], deps: ["y"], plotType: "LinePlot" as const };
const released = () => post.mock.calls.flatMap((call) => (call as unknown[])[1] as never);

describe("plot contexts", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    post.mockClear();
    resetPlotContextsForTests();
  });
  afterEach(() => vi.useRealTimers());

  it("keeps a held context, and releases it a while after the last holder lets go", () => {
    rememberPlotContext("a", context);
    const first = holdPlotContext("a");
    const second = holdPlotContext("a");
    first();
    vi.advanceTimersByTime(RELEASE_DELAY_MS * 2);
    expect(post).not.toHaveBeenCalled();
    expect(plotContextFor("a")).toEqual(context);

    second();
    vi.advanceTimersByTime(RELEASE_DELAY_MS);
    expect(released()).toEqual([{ plot_refs: ["a"] }]);
    expect(trackedPlotContexts()).toBe(0);
  });

  it("does not release a context held again within the delay", () => {
    rememberPlotContext("a", context);
    holdPlotContext("a")();
    vi.advanceTimersByTime(RELEASE_DELAY_MS / 2);
    const again = holdPlotContext("a");
    vi.advanceTimersByTime(RELEASE_DELAY_MS * 2);
    expect(post).not.toHaveBeenCalled();
    again();
    vi.advanceTimersByTime(RELEASE_DELAY_MS);
    expect(released()).toEqual([{ plot_refs: ["a"] }]);
  });

  it("releases a context no plot ever held", () => {
    rememberPlotContext("unused", context);
    vi.advanceTimersByTime(RELEASE_DELAY_MS);
    expect(released()).toEqual([{ plot_refs: ["unused"] }]);
    expect(trackedPlotContexts()).toBe(0);
  });

  it("counts a let-go only once", () => {
    rememberPlotContext("a", context);
    const first = holdPlotContext("a");
    holdPlotContext("a");
    first();
    first();
    vi.advanceTimersByTime(RELEASE_DELAY_MS * 2);
    expect(post).not.toHaveBeenCalled();
  });
});

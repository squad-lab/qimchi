import { beforeEach, describe, expect, it } from "vitest";

import { usePainterStore } from "./painterStore";

const appearance = { showGrid: true } as never;
const filters = [{ name: "scale", options: { factor: 2 } }] as never;

beforeEach(() => {
  usePainterStore.getState().deactivate();
  usePainterStore.getState().setShiftHeld(false);
});

describe("painterStore", () => {
  it("starts inactive", () => {
    expect(usePainterStore.getState().mode).toBe("none");
  });

  it("picks up a plot's theme to paint onto others", () => {
    usePainterStore.getState().activateTheme("plot-1", "line", appearance);
    const state = usePainterStore.getState();

    expect(state.mode).toBe("theme");
    expect(state.sourcePlotId).toBe("plot-1");
    expect(state.sourcePlotType).toBe("line");
    expect(state.sourceAppearance).toEqual(appearance);
  });

  it("picks up a plot's filters, with its sliders", () => {
    usePainterStore.getState().activateFilter("plot-2", "heatmap", filters, { x: 1 });
    const state = usePainterStore.getState();

    expect(state.mode).toBe("filter");
    expect(state.sourceFilters).toEqual(filters);
    expect(state.sourceSliders).toEqual({ x: 1 });
  });

  it("clears the other mode's payload when switching modes", () => {
    // Otherwise a theme picked up earlier would be painted along with the
    // filters the user actually selected.
    usePainterStore.getState().activateTheme("plot-1", "line", appearance);
    usePainterStore.getState().activateFilter("plot-2", "heatmap", filters);

    expect(usePainterStore.getState().sourceAppearance).toBeNull();

    usePainterStore.getState().activateTheme("plot-3", "line", appearance);
    expect(usePainterStore.getState().sourceFilters).toBeUndefined();
  });

  it("deactivates back to a clean state", () => {
    usePainterStore.getState().activateFilter("plot-2", "heatmap", filters);

    usePainterStore.getState().deactivate();

    const state = usePainterStore.getState();
    expect(state.mode).toBe("none");
    expect(state.sourcePlotId).toBeUndefined();
    expect(state.sourceFilters).toBeUndefined();
  });

  it("tracks the shift key independently of the mode", () => {
    // Shift decides paint-all vs paint-one, and must survive activation.
    usePainterStore.getState().setShiftHeld(true);
    usePainterStore.getState().activateTheme("plot-1", "line", appearance);

    expect(usePainterStore.getState().shiftHeld).toBe(true);
  });
});

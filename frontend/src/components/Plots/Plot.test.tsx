import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const plotly = vi.hoisted(() => ({
  react: vi.fn(async () => {}),
  purge: vi.fn(),
  relayout: vi.fn(async () => {}),
  Plots: { resize: vi.fn() },
}));

vi.mock("./plotly", () => ({ default: plotly }));

import Plot from "./Plot";

const resizeCallbacks: Array<() => void> = [];
class FakeResizeObserver {
  constructor(callback: () => void) {
    resizeCallbacks.push(callback);
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", FakeResizeObserver);

const visibilityCallbacks: Array<(entries: { isIntersecting: boolean }[]) => void> = [];
class FakeIntersectionObserver {
  constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
    visibilityCallbacks.push(callback);
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);

/** Resize the mocked plot container. */
const resizeContainerTo = (width: number) => {
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    value: width,
    configurable: true,
  });
  resizeCallbacks.forEach((callback) => callback());
};

// jsdom lays nothing out, and the plot is only drawn once it has a size.
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", { value: 800, configurable: true });
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", { value: 600, configurable: true });
});

const plotJson = {
  data: [{ type: "heatmap", z: [[1, 2]] }],
  layout: { title: { text: "HeatMap" } },
};

afterEach(() => {
  vi.clearAllMocks();
  resizeCallbacks.length = 0;
  visibilityCallbacks.length = 0;
});

describe("Plot", () => {
  it("purges Plotly when it unmounts, so a closed plot frees its data", async () => {
    // A plot that is never purged keeps its traces reachable from the SVG
    // nodes React drops, which is how closed plots used to hold their memory.
    const view = render(<Plot plotJson={plotJson as never} />);
    await waitFor(() => expect(plotly.react).toHaveBeenCalled(), { timeout: 3000 });
    const node = view.container.querySelector(".qimchi-plot");

    view.unmount();

    expect(plotly.purge).toHaveBeenCalledWith(node);
  });

  it("resizes with relayout rather than redrawing every trace", async () => {
    render(<Plot plotJson={plotJson as never} />);
    await waitFor(() => expect(plotly.react).toHaveBeenCalled(), { timeout: 3000 });
    plotly.react.mockClear();

    resizeContainerTo(1200);

    await waitFor(() => expect(plotly.relayout).toHaveBeenCalled(), { timeout: 3000 });
    expect(plotly.react).not.toHaveBeenCalled();
  });

  it("leaves a plot that is scrolled out of view until it comes back", async () => {
    render(<Plot plotJson={plotJson as never} />);
    await waitFor(() => expect(plotly.react).toHaveBeenCalled(), { timeout: 3000 });
    plotly.react.mockClear();

    visibilityCallbacks.forEach((callback) => callback([{ isIntersecting: false }]));
    resizeContainerTo(900);
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(plotly.relayout).not.toHaveBeenCalled();

    visibilityCallbacks.forEach((callback) => callback([{ isIntersecting: true }]));

    await waitFor(() => expect(plotly.relayout).toHaveBeenCalled(), { timeout: 3000 });
  });

  it("never offers to upload the chart, even when a saved config asks for it", async () => {
    const saved = { ...plotJson, config: { showSendToCloud: true } };
    render(<Plot plotJson={saved as never} />);
    await waitFor(() => expect(plotly.react).toHaveBeenCalled(), { timeout: 3000 });

    expect(plotly.react).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ showSendToCloud: false }),
    );
  });

  it("does not purge a plot that was never drawn", () => {
    // Unmounting before the container has been measured draws nothing.
    render(<Plot plotJson={plotJson as never} />).unmount();

    expect(plotly.purge).not.toHaveBeenCalled();
  });
});

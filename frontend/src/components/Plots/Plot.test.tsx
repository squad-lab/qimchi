import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const plotly = vi.hoisted(() => ({
  react: vi.fn(async () => {}),
  purge: vi.fn(),
  relayout: vi.fn(async () => {}),
  Plots: { resize: vi.fn() },
}));

vi.mock("plotly.js", () => ({ default: plotly, ...plotly }));

import Plot from "./Plot";

class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", FakeResizeObserver);

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

  it("does not purge a plot that was never drawn", () => {
    // Unmounting before the container has been measured draws nothing.
    render(<Plot plotJson={plotJson as never} />).unmount();

    expect(plotly.purge).not.toHaveBeenCalled();
  });
});

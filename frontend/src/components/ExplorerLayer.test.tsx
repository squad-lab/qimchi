import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import ExplorerLayer from "./ExplorerLayer";

describe("ExplorerLayer", () => {
  it("keeps the compact Explorer in its layout container", () => {
    const { container } = render(
      <ExplorerLayer expanded={false}>
        <button type="button">Action</button>
      </ExplorerLayer>,
    );

    const layer = screen.getByRole("button", { name: "Action" }).parentElement;
    expect(layer).toHaveAttribute("data-explorer-layer", "compact");
    expect(container).toContainElement(layer);
  });

  it("portals the expanded Explorer to the body with its own hit-test surface", () => {
    const { container } = render(
      <ExplorerLayer expanded>
        <button type="button">Action</button>
      </ExplorerLayer>,
    );

    const layer = screen.getByRole("button", { name: "Action" }).parentElement;
    expect(layer).toHaveAttribute("data-explorer-layer", "expanded");
    expect(layer).toHaveClass("fixed", "inset-0", "z-[1500]", "pointer-events-auto");
    expect(layer?.parentElement).toBe(document.body);
    expect(container).not.toContainElement(layer);
  });
});

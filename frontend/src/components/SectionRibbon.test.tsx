import { render, screen } from "@testing-library/react";
import { ShoppingBasket } from "lucide-react";
import { describe, expect, it } from "vitest";

import SectionRibbon from "./SectionRibbon";

describe("SectionRibbon", () => {
  it("names the section on its icon, since the rail shows no text", () => {
    render(<SectionRibbon label="Basket" Icon={ShoppingBasket} count={3} />);

    // The tooltip carries the name; the badge carries the count.
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("hides the badge at zero rather than showing an empty count", () => {
    render(<SectionRibbon label="Basket" Icon={ShoppingBasket} count={0} />);

    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("omits the badge entirely when the section does not count anything", () => {
    render(<SectionRibbon label="Composer" Icon={ShoppingBasket} />);

    expect(screen.queryByText(/^\d+$/)).not.toBeInTheDocument();
  });

  it("renders its controls in order after the icon", () => {
    render(
      <SectionRibbon label="Basket" Icon={ShoppingBasket}>
        <button type="button">Download</button>
        <button type="button">Clear</button>
      </SectionRibbon>,
    );

    const buttons = screen.getAllByRole("button").map((button) => button.textContent);
    expect(buttons).toEqual(["Download", "Clear"]);
  });

  it("lays out horizontally when the section is collapsed", () => {
    // A collapsed card is far shorter than the stack of controls, so the
    // ribbon turns into a strip rather than being clipped.
    const { container } = render(
      <SectionRibbon label="Basket" Icon={ShoppingBasket} orientation="horizontal" />,
    );

    expect(container.firstChild).toHaveClass("flex-row");
    expect(container.firstChild).not.toHaveClass("flex-col");
  });

  it("lays out vertically by default", () => {
    const { container } = render(<SectionRibbon label="Basket" Icon={ShoppingBasket} />);

    expect(container.firstChild).toHaveClass("flex-col");
  });
});

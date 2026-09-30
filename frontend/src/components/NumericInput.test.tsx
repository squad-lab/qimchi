import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import NumericInput from "./NumericInput";

describe("NumericInput", () => {
  it("lets a negative number be typed", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<NumericInput value={0} onChange={onChange} aria-label="Scale scalar" />);
    const field = screen.getByLabelText("Scale scalar");

    await user.clear(field);
    await user.type(field, "-2.5");

    expect(field).toHaveValue("-2.5");
    expect(onChange).toHaveBeenLastCalledWith(-2.5);
  });

  it("holds a half-typed number without committing it", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<NumericInput value={1} onChange={onChange} aria-label="Scale scalar" />);
    const field = screen.getByLabelText("Scale scalar");

    await user.clear(field);
    await user.type(field, "-");

    expect(field).toHaveValue("-");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("shows the committed value again when it loses focus", async () => {
    const user = userEvent.setup();
    render(<NumericInput value={4} onChange={vi.fn()} aria-label="Scale scalar" />);
    const field = screen.getByLabelText("Scale scalar");

    await user.clear(field);
    await user.type(field, "-");
    await user.tab();

    expect(field).toHaveValue("4");
  });
});

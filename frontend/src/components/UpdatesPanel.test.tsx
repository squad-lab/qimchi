import { render, screen, fireEvent } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { INITIAL_UPDATE_STATE, useUpdateStore } from "../stores/updateStore";
import UpdatesPanel from "./UpdatesPanel";

vi.mock("../../../CHANGELOG.md?raw", () => ({
  default: `### v0.7.1 - 2026-10-03
- **Stable improvement**
`,
}));

vi.mock("../../../md/release-notes/v0.7.1-rc.1.md?raw", () => ({
  default: `
### v0.7.1-rc.1 - 2026-10-02
- **Candidate improvement**
`,
}));

beforeEach(() => {
  useUpdateStore.setState({
    state: {
      ...INITIAL_UPDATE_STATE,
      current: "v0.7.1-rc.1",
      tag: "v0.7.1",
      notes: "Offered update notes",
    },
  });
});

it("shows formatted, scrollable installed RC notes without using offered update notes", async () => {
  render(<UpdatesPanel />);
  const button = screen.getByRole("button", { name: "Show changelog for the current version" });
  expect(button).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(button);
  const region = screen.getByRole("region", { name: "Changelog for Qimchi v0.7.1-rc.1" });
  expect(region).toHaveClass("overflow-y-auto", "max-h-72");
  expect(await screen.findByText("Candidate improvement", {}, { timeout: 15000 })).toHaveProperty(
    "tagName",
    "STRONG",
  );
  expect(screen.queryByText("Stable improvement")).not.toBeInTheDocument();
  expect(screen.queryByText("Offered update notes")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Hide changelog" }));
  expect(region).not.toBeInTheDocument();
}, 30000);

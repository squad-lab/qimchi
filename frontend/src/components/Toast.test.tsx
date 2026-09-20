import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ToastProvider } from "./Toast";
import { useToast } from "../hooks/useToast";

const Emitter = ({ count }: { count: number }) => {
  const { showToast, openLogModal } = useToast();
  return (
    <button
      onClick={() => {
        for (let i = 0; i < count; i++) showToast(`note ${i}`, "info", 1, "Test");
        openLogModal();
      }}
    >
      emit
    </button>
  );
};

describe("ToastProvider", () => {
  it("keeps the notifications log bounded", async () => {
    // A long live session raises thousands of notifications; keeping them all,
    // with their metadata, grows for as long as the tab is open.
    render(
      <ToastProvider maxLogEntries={5}>
        <Emitter count={8} />
      </ToastProvider>,
    );

    await act(async () => {
      screen.getByRole("button", { name: "emit" }).click();
    });
    // Each notification is also shown as a toast for a moment; once those have
    // gone, what is left on screen is the log.
    await waitFor(() => {
      expect(screen.queryAllByText("note 7")).toHaveLength(1);
      expect(screen.queryAllByText("note 3")).toHaveLength(1);
    });

    expect(screen.queryByText("note 2")).toBeNull();
    expect(screen.queryByText("note 0")).toBeNull();
  });
});

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ToastProvider } from "./Toast";
import { useToast } from "../hooks/useToast";

const Emitter = ({ count, duration = 1 }: { count: number; duration?: number }) => {
  const { showToast, openLogModal } = useToast();
  return (
    <button
      onClick={() => {
        for (let i = 0; i < count; i++) showToast(`note ${i}`, "info", duration, "Test");
        if (duration === 1) openLogModal();
      }}
    >
      emit
    </button>
  );
};

/** Read a toast card's vertical offset. */
const liftOf = (message: string): number => {
  const card = screen.getByText(message).closest("div[style]") as HTMLElement;
  return Math.abs(Number(/translateY\((-?[\d.]+)px\)/.exec(card.style.transform)?.[1] ?? NaN));
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

  it("piles notifications into a deck and fans them out on hover", async () => {
    render(
      <ToastProvider>
        <Emitter count={3} duration={60_000} />
      </ToastProvider>,
    );

    await act(async () => {
      screen.getByRole("button", { name: "emit" }).click();
    });

    // The newest card sits at the front.
    expect(liftOf("note 2")).toBe(0);
    const stacked = liftOf("note 0");
    expect(stacked).toBeGreaterThan(0);

    const deck = screen.getByText("note 2").closest("div[style]")!.parentElement!;
    await act(async () => {
      fireEvent.mouseEnter(deck);
    });

    // The expanded cards no longer overlap.
    expect(liftOf("note 0")).toBeGreaterThan(stacked);
  });
});

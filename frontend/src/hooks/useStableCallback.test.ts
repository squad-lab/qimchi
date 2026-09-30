import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useStableCallback } from "./useStableCallback";

describe("useStableCallback", () => {
  it("keeps one identity but runs the latest version", () => {
    const { result, rerender } = renderHook(({ value }) => useStableCallback(() => value), {
      initialProps: { value: 1 },
    });
    const first = result.current;

    rerender({ value: 2 });

    expect(result.current).toBe(first);
    expect(first()).toBe(2);
  });

  it("stops handing back an older render's data", () => {
    // The point of the hook: nothing keeps the previous version, so the render
    // it came from -- and the figure that render held -- can be collected.
    const older = { big: [1, 2, 3] };
    const { result, rerender } = renderHook(({ data }) => useStableCallback(() => data), {
      initialProps: { data: older as { big: number[] } | null },
    });
    expect(result.current()).toBe(older);

    rerender({ data: null });

    expect(result.current()).toBeNull();
  });
});

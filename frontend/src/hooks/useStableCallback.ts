import { useCallback, useInsertionEffect, useRef } from "react";

/**
 * A callback whose identity never changes but that always runs the latest
 * version of `fn`. Only for event handlers and effects: it is not safe to call
 * during render, where it would still run the previous render's version.
 *
 * It also stops a memory leak. A useCallback kept from an older render holds
 * that render's whole closure scope, and in a component that renders several
 * times per update (a live plot refreshing) those scopes chain back through
 * every older render, each holding the figure it was drawn from.
 */
export function useStableCallback<Args extends unknown[], Result>(
  fn: (...args: Args) => Result,
): (...args: Args) => Result {
  const latest = useRef(fn);
  // Before layout and passive effects, so effects in this commit see it too.
  useInsertionEffect(() => {
    latest.current = fn;
  });
  return useCallback((...args: Args) => latest.current(...args), []);
}

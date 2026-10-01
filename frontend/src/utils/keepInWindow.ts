import { useLayoutEffect, type RefObject } from "react";
import type { Rnd } from "react-rnd";

export type Box = { x: number; y: number; width: number; height: number };

const MARGIN = 12;

/** Fit a box within the window without shrinking below its minimum size. */
export const fitToWindow = (box: Box, minWidth = 0, minHeight = 0): Box => {
  const width = Math.min(box.width, Math.max(minWidth, window.innerWidth - 2 * MARGIN));
  const height = Math.min(box.height, Math.max(minHeight, window.innerHeight - 2 * MARGIN));
  const x = Math.max(MARGIN, Math.min(box.x, window.innerWidth - width - MARGIN));
  const y = Math.max(MARGIN, Math.min(box.y, window.innerHeight - height - MARGIN));
  return { x, y, width, height };
};

/** Keep an Rnd panel within the window on open and resize. Its parent must span the window. */
export function useKeepRndInWindow(
  rnd: RefObject<Rnd | null>,
  open: boolean,
  minWidth = 0,
  minHeight = 0,
): void {
  useLayoutEffect(() => {
    if (!open) return;
    const fit = () => {
      const panel = rnd.current;
      const element = panel?.getSelfElement();
      if (!panel || !element) return;
      const rect = element.getBoundingClientRect();
      const box = { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
      const next = fitToWindow(box, minWidth, minHeight);
      if (next.width !== box.width || next.height !== box.height) {
        panel.updateSize({ width: next.width, height: next.height });
      }
      if (next.x !== box.x || next.y !== box.y) panel.updatePosition({ x: next.x, y: next.y });
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [rnd, open, minWidth, minHeight]);
}

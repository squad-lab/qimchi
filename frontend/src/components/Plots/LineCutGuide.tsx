import { useEffect, useId, useRef } from "react";

import type { CutPoint } from "../../utils/lineCut";

export type GuideMode = "x" | "y" | "oblique";

type PlotlyAxis = {
  _offset: number;
  _length: number;
  l2p: (value: number) => number;
  p2l: (pixel: number) => number;
  d2l: (value: number) => number;
  l2d: (value: number) => number;
};

type PlotElement = HTMLElement & { _fullLayout?: { xaxis?: PlotlyAxis; yaxis?: PlotlyAxis } };

type Props = {
  mode: GuideMode;
  /** The cell Plotly last reported under the pointer, kept after the pointer leaves. */
  hovered: CutPoint | null;
  /** Where an oblique cut starts, once clicked. */
  start: CutPoint | null;
  /** The heat map's cell centres, to snap the pointer to. */
  xs: number[];
  ys: number[];
  /** Held in place: the guide stays at `hovered` instead of following the pointer. */
  locked?: boolean;
  /** Right-click on the plot area, with the cell under the pointer. */
  onToggleLock?: (cell: CutPoint) => void;
};

const nearest = (values: number[], target: number): number => {
  let best = values[0];
  for (const value of values) {
    if (Math.abs(value - target) < Math.abs(best - target)) best = value;
  }
  return best;
};

/**
 * The LineCut guide, drawn over the heat map instead of into its figure, and
 * moved straight from the pointer. Placed in the same positioned container
 * as the heat map's Plot.
 */
const LineCutGuide = ({ mode, hovered, start, xs, ys, locked = false, onToggleLock }: Props) => {
  const clipId = useId();
  const svgRef = useRef<SVGSVGElement>(null);
  const clipRef = useRef<SVGRectElement>(null);
  const haloRef = useRef<SVGLineElement>(null);
  const lineRef = useRef<SVGLineElement>(null);
  const dotRef = useRef<SVGCircleElement>(null);
  // The cell under the pointer while it is over the plot area.
  const pointerRef = useRef<CutPoint | null>(null);
  const propsRef = useRef({ mode, hovered, start, xs, ys, locked, onToggleLock });
  propsRef.current = { mode, hovered, start, xs, ys, locked, onToggleLock };

  useEffect(() => {
    const svg = svgRef.current;
    const container = svg?.parentElement;
    if (!svg || !container) return;
    const plotOf = () => container.querySelector(".js-plotly-plot") as PlotElement | null;

    const cellAt = (event: MouseEvent): CutPoint | null => {
      const plot = plotOf();
      const xa = plot?._fullLayout?.xaxis;
      const ya = plot?._fullLayout?.yaxis;
      const { xs: cellsX, ys: cellsY } = propsRef.current;
      if (!plot || !xa || !ya || cellsX.length === 0 || cellsY.length === 0) return null;
      const area = plot.getBoundingClientRect();
      const u = event.clientX - area.left - xa._offset;
      const v = event.clientY - area.top - ya._offset;
      if (u < 0 || v < 0 || u > xa._length || v > ya._length) return null;
      return {
        x: nearest(cellsX, xa.l2d(xa.p2l(u))),
        y: nearest(cellsY, ya.l2d(ya.p2l(v))),
      };
    };
    const onPointerMove = (event: PointerEvent) => {
      pointerRef.current = cellAt(event);
    };
    const onPointerLeave = () => {
      pointerRef.current = null;
    };
    const onContextMenu = (event: MouseEvent) => {
      const { mode: current, start: from, locked: held, onToggleLock: toggle } = propsRef.current;
      const cell = cellAt(event);
      // Outside the heat map, and before an oblique cut has a start, the usual menu opens.
      if (!toggle || !cell || (current === "oblique" && !from && !held)) return;
      event.preventDefault();
      toggle(cell);
    };
    container.addEventListener("pointermove", onPointerMove);
    container.addEventListener("pointerleave", onPointerLeave);
    container.addEventListener("contextmenu", onContextMenu);

    // Drawn every frame, so zooming, panning and resizing carry the guide
    // with the heat map without React having to notice.
    let frame = 0;
    const draw = () => {
      frame = requestAnimationFrame(draw);
      const parts = [clipRef.current, haloRef.current, lineRef.current, dotRef.current];
      if (parts.some((part) => !part)) return;
      const [clip, halo, line, dot] = parts as [
        SVGRectElement,
        SVGLineElement,
        SVGLineElement,
        SVGCircleElement,
      ];

      const current = propsRef.current;
      const at = current.locked ? current.hovered : (pointerRef.current ?? current.hovered);
      const plot = plotOf();
      const xa = plot?._fullLayout?.xaxis;
      const ya = plot?._fullLayout?.yaxis;
      const visible = current.mode === "oblique" ? current.start !== null : at !== null;
      if (!plot || !xa || !ya || !visible) {
        svg.style.display = "none";
        return;
      }
      svg.style.display = "";

      const box = svg.getBoundingClientRect();
      const area = plot.getBoundingClientRect();
      const left = area.left - box.left + xa._offset;
      const top = area.top - box.top + ya._offset;
      const px = (x: number) => left + xa.l2p(xa.d2l(x));
      const py = (y: number) => top + ya.l2p(ya.d2l(y));

      clip.setAttribute("x", String(left));
      clip.setAttribute("y", String(top));
      clip.setAttribute("width", String(xa._length));
      clip.setAttribute("height", String(ya._length));

      let ends: [number, number, number, number];
      if (current.mode === "oblique") {
        const from = current.start as CutPoint;
        const to = at ?? from;
        ends = [px(from.x), py(from.y), px(to.x), py(to.y)];
      } else if (current.mode === "x") {
        const x = px((at as CutPoint).x);
        ends = [x, top, x, top + ya._length];
      } else {
        const y = py((at as CutPoint).y);
        ends = [left, y, left + xa._length, y];
      }
      for (const element of [halo, line]) {
        element.setAttribute("x1", String(ends[0]));
        element.setAttribute("y1", String(ends[1]));
        element.setAttribute("x2", String(ends[2]));
        element.setAttribute("y2", String(ends[3]));
      }
      line.setAttribute("stroke", current.locked ? "#2563eb" : "#ef4444");
      line.setAttribute("stroke-width", current.locked ? "2" : "1.5");
      dot.setAttribute("fill", current.locked ? "#2563eb" : "#ef4444");
      dot.style.display = current.mode === "oblique" ? "" : "none";
      dot.setAttribute("cx", String(ends[0]));
      dot.setAttribute("cy", String(ends[1]));
    };
    frame = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(frame);
      container.removeEventListener("pointermove", onPointerMove);
      container.removeEventListener("pointerleave", onPointerLeave);
      container.removeEventListener("contextmenu", onContextMenu);
    };
  }, []);

  return (
    <svg
      ref={svgRef}
      className="pointer-events-none absolute inset-0 z-10 h-full w-full"
      data-linecut-guide={JSON.stringify({ mode, hovered, start, locked })}
      aria-hidden
    >
      <defs>
        <clipPath id={clipId}>
          <rect ref={clipRef} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clipId})`}>
        <line ref={haloRef} stroke="#ffffff" strokeWidth={2.5} />
        <line ref={lineRef} stroke="#ef4444" strokeWidth={1.5} />
        <circle ref={dotRef} r={4.5} fill="#ef4444" stroke="#ffffff" strokeWidth={2} />
      </g>
    </svg>
  );
};

export default LineCutGuide;

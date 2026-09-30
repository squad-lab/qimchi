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

const SVG_NS = "http://www.w3.org/2000/svg";

/** Draw the LineCut guide in Plotly's overlay layer, below its hover labels. */
const LineCutGuide = ({ mode, hovered, start, xs, ys, locked = false, onToggleLock }: Props) => {
  const clipId = `linecut-${useId().replace(/:/g, "")}`;
  const hostRef = useRef<HTMLSpanElement>(null);
  const pointerRef = useRef<CutPoint | null>(null);
  const propsRef = useRef({ mode, hovered, start, xs, ys, locked, onToggleLock });
  propsRef.current = { mode, hovered, start, xs, ys, locked, onToggleLock };

  useEffect(() => {
    const container = hostRef.current?.parentElement;
    if (!container) return;
    const plotOf = () => container.querySelector(".js-plotly-plot") as PlotElement | null;

    const guide = document.createElementNS(SVG_NS, "g");
    const clipPath = document.createElementNS(SVG_NS, "clipPath");
    const clip = document.createElementNS(SVG_NS, "rect");
    const halo = document.createElementNS(SVG_NS, "line");
    const line = document.createElementNS(SVG_NS, "line");
    const dot = document.createElementNS(SVG_NS, "circle");
    guide.style.pointerEvents = "none";
    guide.setAttribute("clip-path", `url(#${clipId})`);
    clipPath.setAttribute("id", clipId);
    clipPath.appendChild(clip);
    halo.setAttribute("stroke", "#ffffff");
    halo.setAttribute("stroke-width", "2.5");
    line.setAttribute("stroke", "#ef4444");
    line.setAttribute("stroke-width", "1.5");
    dot.setAttribute("r", "4.5");
    dot.setAttribute("fill", "#ef4444");
    dot.setAttribute("stroke", "#ffffff");
    dot.setAttribute("stroke-width", "2");
    guide.append(halo, line, dot);

    const attachGuide = (plot: PlotElement): SVGSVGElement | null => {
      const mainSvg = plot.querySelector("svg.main-svg") as SVGSVGElement | null;
      if (!mainSvg) return null;
      const defs = mainSvg.querySelector("defs");
      if (defs && clipPath.parentNode !== defs) defs.appendChild(clipPath);
      const layer = mainSvg.querySelector(".layer-above");
      if (layer && guide.parentNode !== layer) {
        layer.appendChild(guide);
      } else if (!layer && guide.parentNode !== mainSvg) {
        const hoverLayer = mainSvg.querySelector(".hoverlayer");
        mainSvg.insertBefore(guide, hoverLayer?.parentNode === mainSvg ? hoverLayer : null);
      }
      return mainSvg;
    };

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

    let frame = 0;
    const draw = () => {
      frame = requestAnimationFrame(draw);
      const current = propsRef.current;
      guide.setAttribute(
        "data-linecut-guide",
        JSON.stringify({
          mode: current.mode,
          hovered: current.hovered,
          start: current.start,
          locked: current.locked,
        }),
      );
      const at = current.locked ? current.hovered : (pointerRef.current ?? current.hovered);
      const plot = plotOf();
      const xa = plot?._fullLayout?.xaxis;
      const ya = plot?._fullLayout?.yaxis;
      const visible = current.mode === "oblique" ? current.start !== null : at !== null;
      if (!plot || !xa || !ya || !visible) {
        guide.style.display = "none";
        return;
      }
      const mainSvg = attachGuide(plot);
      if (!mainSvg) return;
      guide.style.display = "";

      const box = mainSvg.getBoundingClientRect();
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
      guide.remove();
      clipPath.remove();
    };
  }, [clipId]);

  return <span ref={hostRef} className="hidden" aria-hidden />;
};

export default LineCutGuide;

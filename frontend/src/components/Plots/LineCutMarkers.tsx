import { useEffect, useId, useRef } from "react";
import { CircleDot, SeparatorHorizontal, SeparatorVertical, Trash2, X } from "lucide-react";

import Tooltip from "../Tooltip";
import { useThemeStore } from "../../stores/themeStore";
import {
  MARKER_KIND_LABELS,
  markerAt,
  markerLabel,
  placeMarker,
  type MarkerKind,
  type PixelScale,
  type PlotMarker,
} from "../../utils/plotMarkers";
import { OBLIQUE_MARKER_MESSAGE, type LineCutMarkersState } from "./useLineCutMarkers";

type PlotlyAxis = {
  _offset: number;
  _length: number;
  range: number[];
  title?: { font?: { family?: string } };
  tickfont?: { size?: number };
  l2p: (value: number) => number;
  p2l: (pixel: number) => number;
  d2l: (value: number) => number;
  l2d: (value: number) => number;
};

type PlotElement = HTMLElement & {
  _fullLayout?: { xaxis?: PlotlyAxis; yaxis?: PlotlyAxis };
};

const EXACTLY = " Hold Shift to place it exactly where you click.";

const TOOL_HELP: Record<MarkerKind, string> = {
  vline: `Click the preview to add one at the nearest sample.${EXACTLY}`,
  hline: `Click the preview to add one at the value of the nearest point on the curve.${EXACTLY}`,
  point: `Click the preview to add one on the nearest point of the curve.${EXACTLY}`,
};

// Maximum pointer movement in pixels allowed for a click.
const CLICK_SLOP = 4;

const SVG_NS = "http://www.w3.org/2000/svg";

const svg = <K extends keyof SVGElementTagNameMap>(
  tag: K,
  attributes: Record<string, string | number>,
): SVGElementTagNameMap[K] => {
  const element = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, String(value));
  return element;
};

/**
 * Draw, place and select markers in the preview SVG without affecting autorange.
 * Render beside the preview plot in the same container.
 */
export const LineCutMarkerOverlay = ({
  state,
  samples,
}: {
  state: LineCutMarkersState;
  /** Curve samples used for snapping. */
  samples: { x: number[]; y: number[] };
}) => {
  const clipId = `linecut-markers-${useId().replace(/:/g, "")}`;
  const hostRef = useRef<HTMLSpanElement>(null);
  const dark = useThemeStore((theme) => theme.theme === "dark");
  const { markers, selectedId, tool, format, add, select } = state;
  const propsRef = useRef({ markers, selectedId, tool, format, add, select, samples, dark });
  propsRef.current = { markers, selectedId, tool, format, add, select, samples, dark };

  useEffect(() => {
    const container = hostRef.current?.parentElement;
    if (!container) return;
    container.classList.toggle("qimchi-marker-armed", tool !== null);
    return () => container.classList.remove("qimchi-marker-armed");
  }, [tool]);

  useEffect(() => {
    const container = hostRef.current?.parentElement;
    if (!container) return;
    const plotOf = () => container.querySelector(".js-plotly-plot") as PlotElement | null;

    const root = svg("g", { "clip-path": `url(#${clipId})`, "data-linecut-markers": "" });
    root.style.pointerEvents = "none";
    const clipPath = svg("clipPath", { id: clipId });
    const clip = svg("rect", {});
    clipPath.appendChild(clip);

    const axesOf = (plot: PlotElement | null) => {
      const xa = plot?._fullLayout?.xaxis;
      const ya = plot?._fullLayout?.yaxis;
      return xa && ya ? { xa, ya } : null;
    };
    // Marker helpers expect pixel coordinates relative to the plot area.
    const scaleOf = (xa: PlotlyAxis, ya: PlotlyAxis): PixelScale => ({
      x: (value) => xa.l2p(xa.d2l(value)),
      y: (value) => ya.l2p(ya.d2l(value)),
    });

    let lastSignature = "";
    let lastDrawn: unknown[] = [];
    const draw = (plot: PlotElement, xa: PlotlyAxis, ya: PlotlyAxis, mainSvg: SVGSVGElement) => {
      const current = propsRef.current;
      const box = mainSvg.getBoundingClientRect();
      const area = plot.getBoundingClientRect();
      const left = area.left - box.left + xa._offset;
      const top = area.top - box.top + ya._offset;
      // Match the axis title's font family and the tick labels' size.
      const fontFamily = xa.title?.font?.family ?? "";
      const fontSize = xa.tickfont?.size ?? 12;
      const signature = [
        xa.range.join(),
        ya.range.join(),
        xa._length,
        ya._length,
        left,
        top,
        fontFamily,
        fontSize,
      ].join("|");
      const drawn = [current.markers, current.selectedId, current.format, current.dark];
      if (
        signature === lastSignature &&
        drawn.every((value, index) => value === lastDrawn[index]) &&
        root.parentNode
      ) {
        return;
      }
      lastSignature = signature;
      lastDrawn = drawn;

      clip.setAttribute("x", String(left));
      clip.setAttribute("y", String(top));
      clip.setAttribute("width", String(xa._length));
      clip.setAttribute("height", String(ya._length));
      root.replaceChildren();

      const scale = scaleOf(xa, ya);
      const halo = current.dark ? "#1f2937" : "#ffffff";
      for (const marker of current.markers) {
        const chosen = marker.id === current.selectedId;
        const color = chosen
          ? current.dark
            ? "#fb7185"
            : "#e11d48"
          : current.dark
            ? "#fbbf24"
            : "#d97706";
        const group = svg("g", { "data-linecut-marker": marker.id, "data-kind": marker.kind });
        const text = svg("text", {
          fill: color,
          stroke: halo,
          "stroke-width": 3,
          "paint-order": "stroke",
          "font-family": fontFamily,
          "font-size": fontSize,
          "font-weight": chosen ? 600 : 400,
        });
        text.textContent = markerLabel(marker, current.format);

        if (marker.kind === "point") {
          const cx = left + scale.x(marker.x!);
          const cy = top + scale.y(marker.y!);
          group.append(
            svg("circle", {
              cx,
              cy,
              r: chosen ? 6 : 5,
              fill: color,
              stroke: halo,
              "stroke-width": 2,
            }),
          );
          text.setAttribute("x", String(cx));
          text.setAttribute("y", String(cy - 9));
          text.setAttribute("text-anchor", "middle");
        } else {
          const vertical = marker.kind === "vline";
          const at = vertical ? left + scale.x(marker.x!) : top + scale.y(marker.y!);
          const ends = vertical
            ? { x1: at, y1: top, x2: at, y2: top + ya._length }
            : { x1: left, y1: at, x2: left + xa._length, y2: at };
          group.append(
            svg("line", { ...ends, stroke: halo, "stroke-width": chosen ? 5 : 4 }),
            svg("line", {
              ...ends,
              stroke: color,
              "stroke-width": chosen ? 2.5 : 1.5,
              "stroke-dasharray": "6 4",
            }),
          );
          if (vertical) {
            // Keep the label on the side with room for it.
            const onRight = at < left + xa._length * 0.7;
            text.setAttribute("x", String(at + (onRight ? 4 : -4)));
            text.setAttribute("y", String(top + fontSize + 2));
            text.setAttribute("text-anchor", onRight ? "start" : "end");
          } else {
            // Place labels below lines near the top edge to avoid clipping.
            text.setAttribute("x", String(left + xa._length - 4));
            text.setAttribute("y", String(at - top < fontSize + 4 ? at + fontSize + 2 : at - 4));
            text.setAttribute("text-anchor", "end");
          }
        }
        group.append(text);
        root.append(group);
      }
    };

    let frame = 0;
    const tick = () => {
      frame = requestAnimationFrame(tick);
      const plot = plotOf();
      const axes = axesOf(plot);
      const mainSvg = plot?.querySelector("svg.main-svg") as SVGSVGElement | null;
      if (!plot || !axes || !mainSvg) return;
      const defs = mainSvg.querySelector("defs");
      if (defs && clipPath.parentNode !== defs) defs.appendChild(clipPath);
      // Reattach the overlay if Plotly rebuilds its SVG layers.
      const layer = mainSvg.querySelector(".layer-above") ?? mainSvg;
      if (root.parentNode !== layer) {
        layer.appendChild(root);
        lastSignature = "";
      }
      draw(plot, axes.xa, axes.ya, mainSvg);
    };
    frame = requestAnimationFrame(tick);

    // Convert pointer coordinates to plot pixels and data, rejecting points outside the axes.
    const pixelAt = (event: MouseEvent) => {
      const plot = plotOf();
      const axes = axesOf(plot);
      if (!plot || !axes) return null;
      const { xa, ya } = axes;
      const area = plot.getBoundingClientRect();
      const u = event.clientX - area.left - xa._offset;
      const v = event.clientY - area.top - ya._offset;
      if (u < 0 || v < 0 || u > xa._length || v > ya._length) return null;
      const data = { x: xa.l2d(xa.p2l(u)), y: ya.l2d(ya.p2l(v)) };
      return { plot, u, v, data, scale: scaleOf(xa, ya) };
    };

    let pressed: { x: number; y: number } | null = null;
    const onPointerDown = (event: PointerEvent) => {
      pressed = event.button === 0 ? { x: event.clientX, y: event.clientY } : null;
    };
    const onClick = (event: MouseEvent) => {
      const from = pressed;
      pressed = null;
      // Ignore drags and repeated clicks so Plotly can handle zoom gestures.
      if (!from || Math.hypot(event.clientX - from.x, event.clientY - from.y) > CLICK_SLOP) {
        return;
      }
      if (event.detail > 1) return;
      const at = pixelAt(event);
      if (!at) return;
      const current = propsRef.current;
      if (current.tool) {
        current.add(placeMarker(current.tool, at.data, current.samples, at.scale, event.shiftKey));
        return;
      }
      const picked = markerAt(current.markers, { x: at.u, y: at.v }, at.scale);
      if (picked || current.selectedId) current.select(picked);
    };

    container.addEventListener("pointerdown", onPointerDown);
    container.addEventListener("click", onClick);

    return () => {
      cancelAnimationFrame(frame);
      container.removeEventListener("pointerdown", onPointerDown);
      container.removeEventListener("click", onClick);
      root.remove();
      clipPath.remove();
    };
  }, [clipId]);

  return <span ref={hostRef} className="hidden" aria-hidden />;
};

const TOOLS: { kind: MarkerKind; Icon: typeof SeparatorVertical }[] = [
  { kind: "vline", Icon: SeparatorVertical },
  { kind: "hline", Icon: SeparatorHorizontal },
  { kind: "point", Icon: CircleDot },
];

const ICONS = Object.fromEntries(TOOLS.map(({ kind, Icon }) => [kind, Icon])) as Record<
  MarkerKind,
  typeof SeparatorVertical
>;

const KIND_ORDER: Record<MarkerKind, number> = { vline: 0, hline: 1, point: 2 };

/** Sort vertical lines, horizontal lines, then points by position. */
const byKindAndPosition = (a: PlotMarker, b: PlotMarker) =>
  KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
  (a.kind === "hline" ? a.y! - b.y! : a.x! - b.x!) ||
  (a.y ?? 0) - (b.y ?? 0);

/** Marker controls and the list of placed markers below the preview. */
export const LineCutMarkerBar = ({ state }: { state: LineCutMarkersState }) => {
  const { markers, available, enabled, tool, toggleTool, selectedId, select, remove, clear } =
    state;
  const shown = available ? [...markers].sort(byKindAndPosition) : [];

  const tools = (
    <div
      role="group"
      aria-label="Markers"
      className="flex items-center overflow-hidden rounded-md border border-gray-200 bg-white dark:bg-gray-800"
    >
      {TOOLS.map(({ kind, Icon }, index) => {
        const button = (
          <button
            type="button"
            disabled={!enabled}
            onClick={() => toggleTool(kind)}
            aria-pressed={tool === kind}
            aria-label={`Add a ${MARKER_KIND_LABELS[kind].toLowerCase()}`}
            className={`flex items-center px-2 py-1 transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
              index > 0 ? "border-l border-gray-200" : ""
            } ${
              tool === kind
                ? "bg-amber-500 text-white"
                : "text-gray-600 hover:bg-gray-100 qimchi-dark-hover-plain"
            }`}
          >
            <Icon size={14} aria-hidden />
          </button>
        );
        return enabled ? (
          <Tooltip
            key={kind}
            position="top"
            content={
              <span className="block max-w-60">
                <span className="block font-semibold">{MARKER_KIND_LABELS[kind]}</span>
                <span className="mt-1 block text-xs opacity-90">{TOOL_HELP[kind]}</span>
              </span>
            }
          >
            {button}
          </Tooltip>
        ) : (
          <span key={kind}>{button}</span>
        );
      })}
    </div>
  );

  let status: React.ReactNode = null;
  if (!enabled) {
    status = <span className="text-gray-500">Not available for oblique cuts</span>;
  } else if (tool) {
    status = <span className="font-medium text-amber-700">Click the preview to place it</span>;
  } else if (available && shown.length === 0) {
    status = <span className="text-gray-500">Track a dip or a peak as the cut moves</span>;
  } else if (available && selectedId) {
    status = <span className="text-gray-500">Use the arrow keys to adjust it</span>;
  }

  return (
    <section
      aria-label="LineCut markers"
      data-linecut-panel
      className="border-t border-gray-200 px-2 py-1.5"
    >
      <div className="flex items-center gap-2">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-gray-600">
          Markers
          {shown.length > 0 && (
            <span className="rounded-full bg-gray-100 px-1.5 text-[0.6875rem] font-medium text-gray-600 tabular-nums">
              {shown.length}
            </span>
          )}
        </span>
        {enabled ? tools : <Tooltip content={OBLIQUE_MARKER_MESSAGE}>{tools}</Tooltip>}
        <span className="min-w-0 flex-1 truncate text-xs">{status}</span>
        {shown.length > 0 && (
          <Tooltip content="Remove every marker shown here" position="top">
            <button
              type="button"
              onClick={clear}
              className="qimchi-dark-hover-plain flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-0.5 text-xs font-medium text-gray-600 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-600 dark:bg-gray-800"
            >
              <Trash2 size={12} aria-hidden />
              Clear all
            </button>
          </Tooltip>
        )}
      </div>
      {shown.length > 0 && (
        <ul
          aria-label="Placed markers"
          className="mt-1.5 flex max-h-[4.25rem] flex-wrap gap-1 overflow-y-auto border-t border-gray-100 pt-1.5"
        >
          {shown.map((marker) => {
            const label = markerLabel(marker, state.format);
            const chosen = marker.id === selectedId;
            const Icon = ICONS[marker.kind];
            return (
              <li
                key={marker.id}
                className={`flex items-center rounded border text-xs ${
                  chosen
                    ? "border-rose-400 bg-rose-50 text-rose-700 dark:border-rose-400/60 dark:text-rose-300"
                    : "border-amber-300 bg-amber-50 text-amber-800"
                }`}
              >
                <button
                  type="button"
                  onClick={() => select(chosen ? null : marker.id)}
                  aria-pressed={chosen}
                  aria-label={`${MARKER_KIND_LABELS[marker.kind]} at ${label}`}
                  className="flex items-center gap-1 py-0.5 pr-1 pl-1.5 font-mono"
                >
                  <Icon size={11} className="shrink-0 opacity-70" aria-hidden />
                  {label}
                </button>
                <button
                  type="button"
                  onClick={() => remove(marker.id)}
                  aria-label={`Remove the ${MARKER_KIND_LABELS[marker.kind].toLowerCase()} at ${label}`}
                  className="rounded-r px-1 py-0.5 opacity-70 hover:bg-red-100 hover:text-red-600 hover:opacity-100 dark:hover:bg-red-500/20 dark:hover:text-red-300"
                >
                  <X size={12} aria-hidden />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
};

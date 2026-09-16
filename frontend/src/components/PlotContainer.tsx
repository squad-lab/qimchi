import React, { useCallback, useEffect, useRef, useState } from "react";
import { DraggableCore, type DraggableEvent } from "react-draggable";

// Local imports
import IndividualPlot from "./Plots/IndividualPlot";
import type { BasketItem } from "./Basket";
import type { PlotConfiguration } from "./interfaces";
import usePainterStore from "../stores/painterStore";

interface PlotContainerProps {
  plotConfigs: PlotConfiguration[];
  className?: string;
  onRemovePlot: (id: string) => void;
  /** Move a plot to `toIndex` in the list without it. */
  onMovePlot?: (id: string, toIndex: number) => void;
  onSetPlotPinned?: (id: string, pinned: boolean) => void;
  // widthPercent: number from 0..100 used as each plot's width
  widthPercent?: number;
  // Optional per-plot overrides keyed by plot id
  perPlotWidthMap?: Record<string, number>;
  onAddPlot?: (config: Omit<PlotConfiguration, "id">) => void;
  selectedPlotId?: string | null;
  onSelectPlot?: (id: string) => void;
  basketItems?: BasketItem[];
}

const datasetIdentity = (path: string): string => {
  const name =
    path
      .replace(/^memory:\/\//i, "")
      .split(/[\\/]/)
      .pop() ?? path;
  return name.replace(/\.(zarr|nc|h5|hdf5|csv|txt|dat)$/i, "");
};

type DropTarget = { id: string; side: "before" | "after" };

interface DragState {
  id: string;
  startX: number;
  startY: number;
  startScroll: number;
  x: number;
  y: number;
}

const pointerOf = (event: DraggableEvent): { x: number; y: number } => {
  const touch = "touches" in event ? (event.touches[0] ?? event.changedTouches[0]) : null;
  const point = touch ?? (event as MouseEvent);
  return { x: point.clientX, y: point.clientY };
};

const scrollParentOf = (node: HTMLElement | null): HTMLElement | null => {
  for (let el = node?.parentElement ?? null; el; el = el.parentElement) {
    const { overflowY } = getComputedStyle(el);
    if ((overflowY === "auto" || overflowY === "scroll") && el.scrollHeight > el.clientHeight) {
      return el;
    }
  }
  return null;
};

const AUTOSCROLL_EDGE_PX = 60;
const AUTOSCROLL_STEP_PX = 16;

interface PlotTileProps {
  id: string;
  style: React.CSSProperties;
  className: string;
  dragging: boolean;
  dropSide: DropTarget["side"] | null;
  disabled: boolean;
  registerNode: (id: string, node: HTMLDivElement | null) => void;
  onClick: () => void;
  onDragStart: (id: string, event: DraggableEvent) => void;
  onDrag: (event: DraggableEvent) => void;
  onDragStop: () => void;
  children: React.ReactNode;
}

// A plot moves only by its handle, so Plotly's own dragging (zoom, pan,
// LineCuts) is unaffected. The container moves the tile with a transform set
// directly on the node, so the plots are not re-rendered on every mouse move.
// It is cleared on drop: a lasting transform would trap the maximized plot's
// fixed overlay inside the tile.
const PlotTile = ({
  id,
  style,
  className,
  dragging,
  dropSide,
  disabled,
  registerNode,
  onClick,
  onDragStart,
  onDrag,
  onDragStop,
  children,
}: PlotTileProps) => {
  const nodeRef = useRef<HTMLDivElement | null>(null);
  return (
    <DraggableCore
      nodeRef={nodeRef as React.RefObject<HTMLElement>}
      handle=".plot-drag-handle"
      disabled={disabled}
      onStart={(event) => onDragStart(id, event)}
      onDrag={(event) => onDrag(event)}
      onStop={() => onDragStop()}
    >
      <div
        ref={(node) => {
          nodeRef.current = node;
          registerNode(id, node);
        }}
        data-plot-id={id}
        className={`${className} relative`}
        onClick={onClick}
        style={{
          ...style,
          ...(dragging
            ? {
                zIndex: 30,
                opacity: 0.85,
                boxShadow: "0 12px 32px rgba(0, 0, 0, 0.25)",
              }
            : {}),
        }}
      >
        {dropSide && (
          <div
            aria-hidden
            data-drop-side={dropSide}
            className={`pointer-events-none absolute top-0 bottom-0 z-20 w-1 rounded bg-blue-500 ${
              dropSide === "before" ? "left-0" : "right-0"
            }`}
          />
        )}
        {children}
      </div>
    </DraggableCore>
  );
};

const PlotContainer: React.FC<PlotContainerProps> = ({
  plotConfigs,
  className = "",
  onRemovePlot,
  onMovePlot,
  onSetPlotPinned,
  onAddPlot,
  widthPercent,
  perPlotWidthMap,
  selectedPlotId,
  onSelectPlot,
  basketItems = [],
}) => {
  const setShiftHeld = usePainterStore((s) => s.setShiftHeld);
  const nodes = useRef(new Map<string, HTMLDivElement>());
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const dropTargetRef = useRef<DropTarget | null>(null);
  const scrollParent = useRef<HTMLElement | null>(null);
  const lastPointer = useRef<{ x: number; y: number } | null>(null);
  const isDragging = draggingId !== null;

  const registerNode = useCallback((id: string, node: HTMLDivElement | null) => {
    if (node) nodes.current.set(id, node);
    else nodes.current.delete(id);
  }, []);

  const updateDrag = useCallback(() => {
    const current = dragRef.current;
    const pointer = lastPointer.current;
    if (!current || !pointer) return;
    const scroll = scrollParent.current?.scrollTop ?? 0;
    const next = {
      ...current,
      x: pointer.x - current.startX,
      y: pointer.y - current.startY + (scroll - current.startScroll),
    };
    dragRef.current = next;
    const node = nodes.current.get(current.id);
    if (node) node.style.transform = `translate(${next.x}px, ${next.y}px)`;

    let target = dropTargetRef.current;
    for (const [id, node] of nodes.current) {
      if (id === current.id) continue;
      const rect = node.getBoundingClientRect();
      if (
        pointer.x >= rect.left &&
        pointer.x <= rect.right &&
        pointer.y >= rect.top &&
        pointer.y <= rect.bottom
      ) {
        target = { id, side: pointer.x < rect.left + rect.width / 2 ? "before" : "after" };
        break;
      }
    }
    if (target?.id !== dropTargetRef.current?.id || target?.side !== dropTargetRef.current?.side) {
      dropTargetRef.current = target;
      setDropTarget(target);
    }
  }, []);

  // Scroll the Viewer while a plot is held near its top or bottom edge.
  useEffect(() => {
    if (!isDragging) return;
    const timer = window.setInterval(() => {
      const container = scrollParent.current;
      const pointer = lastPointer.current;
      if (!container || !pointer) return;
      const rect = container.getBoundingClientRect();
      let step = 0;
      if (pointer.y < rect.top + AUTOSCROLL_EDGE_PX) step = -AUTOSCROLL_STEP_PX;
      else if (pointer.y > rect.bottom - AUTOSCROLL_EDGE_PX) step = AUTOSCROLL_STEP_PX;
      if (!step) return;
      container.scrollTop += step;
      updateDrag();
    }, 16);
    return () => window.clearInterval(timer);
  }, [isDragging, updateDrag]);

  const handleDragStart = useCallback((id: string, event: DraggableEvent) => {
    const pointer = pointerOf(event);
    scrollParent.current = scrollParentOf(nodes.current.get(id) ?? null);
    lastPointer.current = pointer;
    const state = {
      id,
      startX: pointer.x,
      startY: pointer.y,
      startScroll: scrollParent.current?.scrollTop ?? 0,
      x: 0,
      y: 0,
    };
    dragRef.current = state;
    dropTargetRef.current = null;
    setDraggingId(id);
    setDropTarget(null);
  }, []);

  const handleDrag = useCallback(
    (event: DraggableEvent) => {
      lastPointer.current = pointerOf(event);
      updateDrag();
    },
    [updateDrag],
  );

  const handleDragStop = useCallback(() => {
    const current = dragRef.current;
    const target = dropTargetRef.current;
    if (current) {
      const node = nodes.current.get(current.id);
      if (node) node.style.transform = "";
    }
    dragRef.current = null;
    dropTargetRef.current = null;
    lastPointer.current = null;
    setDraggingId(null);
    setDropTarget(null);
    if (!current || !target || !onMovePlot) return;
    const rest = plotConfigs.filter((config) => config.id !== current.id);
    const targetIndex = rest.findIndex((config) => config.id === target.id);
    if (targetIndex < 0) return;
    onMovePlot(current.id, target.side === "before" ? targetIndex : targetIndex + 1);
  }, [onMovePlot, plotConfigs]);

  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Shift") {
        setShiftHeld(true);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Shift") {
        setShiftHeld(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [setShiftHeld]);
  if (plotConfigs.length === 0) {
    return (
      <div className={`flex items-center justify-center h-64 bg-gray-50 rounded-lg ${className}`}>
        <div className="text-center text-gray-500">
          <p className="text-lg font-medium">No plots to display</p>
          <p className="text-sm">Use the Plot Composer to create visualizations</p>
        </div>
      </div>
    );
  }

  const defaultPercent = widthPercent && widthPercent > 0 ? widthPercent : 50;
  // NOTE: Tailwind `gap-2` equals 0.5rem (8px at 16px root). Subtract a small gap
  // amount from the percent width to avoid wrapping when two items use 50%.
  const GAP_PX = 8;

  return (
    <div className={`relative ${className}`}>
      <div className="flex flex-wrap gap-2 p-0">
        {plotConfigs.map((config, index) => {
          const pct =
            perPlotWidthMap && perPlotWidthMap[config.id]
              ? perPlotWidthMap[config.id]
              : defaultPercent;
          // NOTE: Use calc to subtract a small fixed gap so items don't wrap due to
          // flex gaps, borders or rounding errors.
          const effective = `calc(${pct}% - ${GAP_PX}px)`;
          const measurementInfo =
            basketItems.find((item) => item.path === config.fpath)?.attributes ??
            basketItems.find((item) => datasetIdentity(item.path) === datasetIdentity(config.fpath))
              ?.attributes;
          return (
            <PlotTile
              key={config.id}
              id={config.id}
              className={`flex-grow rounded-lg ${draggingId === config.id ? "" : "transition-shadow"} ${
                selectedPlotId === config.id
                  ? "ring-2 ring-inset ring-blue-500 shadow-md"
                  : "ring-1 ring-inset ring-transparent"
              }`}
              onClick={() => onSelectPlot?.(config.id)}
              style={{
                flexBasis: effective,
                maxWidth: effective,
                boxSizing: "border-box",
              }}
              dragging={draggingId === config.id}
              dropSide={draggingId && dropTarget?.id === config.id ? dropTarget.side : null}
              disabled={!onMovePlot || plotConfigs.length < 2}
              registerNode={registerNode}
              onDragStart={handleDragStart}
              onDrag={handleDrag}
              onDragStop={handleDragStop}
            >
              <IndividualPlot
                config={config}
                onRemove={onRemovePlot}
                onMoveBy={
                  onMovePlot && plotConfigs.length > 1
                    ? (offset) => onMovePlot(config.id, index + offset)
                    : undefined
                }
                onSetPinned={onSetPlotPinned}
                onAddPlot={onAddPlot}
                measurementInfo={measurementInfo}
                widthPercent={pct}
              />
            </PlotTile>
          );
        })}
      </div>
    </div>
  );
};

export default PlotContainer;

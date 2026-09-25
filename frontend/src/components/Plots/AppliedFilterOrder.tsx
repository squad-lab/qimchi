import { useRef, useState } from "react";
import { DraggableCore, type DraggableEvent } from "react-draggable";
import { ArrowDown, ArrowUp, GripVertical, X } from "lucide-react";

import { filterLabel } from "../../utils/filterNames";
import { moveItem } from "../../utils/moveItem";

type Props = {
  /** Applied filter keys, first applied first. */
  order: string[];
  onReorder: (order: string[]) => void;
  onRemove: (key: string) => void;
};

type DropTarget = { key: string; side: "before" | "after" };

const pointerY = (event: DraggableEvent): number =>
  "touches" in event ? (event.touches[0] ?? event.changedTouches[0]).clientY : event.clientY;

type RowProps = {
  filterKey: string;
  index: number;
  count: number;
  dragging: boolean;
  dropSide: DropTarget["side"] | null;
  registerNode: (key: string, node: HTMLLIElement | null) => void;
  onDragStart: (key: string, event: DraggableEvent) => void;
  onDrag: (event: DraggableEvent) => void;
  onDragStop: () => void;
  onMove: (to: number) => void;
  onRemove: () => void;
};

// Rows move like the Viewer's plots: the held row follows the pointer, a line
// marks where it will land, and the new order is applied once, on drop.
const Row = ({
  filterKey,
  index,
  count,
  dragging,
  dropSide,
  registerNode,
  onDragStart,
  onDrag,
  onDragStop,
  onMove,
  onRemove,
}: RowProps) => {
  const nodeRef = useRef<HTMLLIElement | null>(null);
  const label = filterLabel(filterKey);
  return (
    <DraggableCore
      nodeRef={nodeRef as React.RefObject<HTMLElement>}
      cancel="[data-no-drag]"
      onStart={(event) => onDragStart(filterKey, event)}
      onDrag={(event) => onDrag(event)}
      onStop={() => onDragStop()}
    >
      <li
        ref={(node) => {
          nodeRef.current = node;
          registerNode(filterKey, node);
        }}
        className={`relative flex cursor-grab touch-none select-none items-center gap-2 rounded border px-2 py-1.5 text-sm ${
          dragging
            ? "z-10 cursor-grabbing border-blue-400 bg-blue-50 opacity-90 shadow-lg"
            : "border-gray-200 bg-gray-50"
        }`}
      >
        {dropSide && (
          <div
            aria-hidden
            data-drop-side={dropSide}
            className={`pointer-events-none absolute right-0 left-0 h-0.5 rounded bg-blue-500 ${
              dropSide === "before" ? "-top-1" : "-bottom-1"
            }`}
          />
        )}
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-green-600 text-[11px] font-bold text-white">
          {index + 1}
        </span>
        <span className="shrink-0 text-gray-400" aria-hidden>
          <GripVertical size={14} />
        </span>
        <span className="min-w-0 flex-1 truncate text-gray-700" title={label}>
          {label}
        </span>
        <span className="flex shrink-0 items-center" data-no-drag>
          <button
            type="button"
            className="shrink-0 rounded p-0.5 text-gray-400 hover:bg-gray-200 hover:text-gray-700 disabled:opacity-30"
            aria-label={`Apply ${label} earlier`}
            disabled={index === 0}
            onClick={() => onMove(index - 1)}
          >
            <ArrowUp size={14} />
          </button>
          <button
            type="button"
            className="shrink-0 rounded p-0.5 text-gray-400 hover:bg-gray-200 hover:text-gray-700 disabled:opacity-30"
            aria-label={`Apply ${label} later`}
            disabled={index === count - 1}
            onClick={() => onMove(index + 1)}
          >
            <ArrowDown size={14} />
          </button>
          <button
            type="button"
            className="shrink-0 rounded p-0.5 text-gray-400 hover:bg-red-50 hover:text-red-600"
            aria-label={`Remove ${label}`}
            onClick={onRemove}
          >
            <X size={14} />
          </button>
        </span>
      </li>
    </DraggableCore>
  );
};

/** The applied filters in the order they run, reordered by dragging a row or with its arrows. */
const AppliedFilterOrder = ({ order, onReorder, onRemove }: Props) => {
  const nodes = useRef(new Map<string, HTMLLIElement>());
  const drag = useRef<{ key: string; startY: number } | null>(null);
  const dropRef = useRef<DropTarget | null>(null);
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);

  const registerNode = (key: string, node: HTMLLIElement | null) => {
    if (node) nodes.current.set(key, node);
    else nodes.current.delete(key);
  };

  const handleDragStart = (key: string, event: DraggableEvent) => {
    drag.current = { key, startY: pointerY(event) };
    dropRef.current = null;
    setDraggingKey(key);
    setDropTarget(null);
  };

  // The row is moved with a transform on its node, so nothing re-renders per move.
  const handleDrag = (event: DraggableEvent) => {
    const current = drag.current;
    if (!current) return;
    const y = pointerY(event);
    const node = nodes.current.get(current.key);
    if (node) node.style.transform = `translateY(${y - current.startY}px)`;

    let target: DropTarget | null = dropRef.current;
    for (const [key, row] of nodes.current) {
      if (key === current.key) continue;
      const box = row.getBoundingClientRect();
      if (y >= box.top && y <= box.bottom) {
        target = { key, side: y < box.top + box.height / 2 ? "before" : "after" };
        break;
      }
    }
    if (target?.key !== dropRef.current?.key || target?.side !== dropRef.current?.side) {
      dropRef.current = target;
      setDropTarget(target);
    }
  };

  const handleDragStop = () => {
    const current = drag.current;
    const target = dropRef.current;
    if (current) {
      const node = nodes.current.get(current.key);
      if (node) node.style.transform = "";
    }
    drag.current = null;
    dropRef.current = null;
    setDraggingKey(null);
    setDropTarget(null);
    if (!current || !target) return;
    const rest = order.filter((key) => key !== current.key);
    const at = rest.indexOf(target.key) + (target.side === "after" ? 1 : 0);
    const next = [...rest.slice(0, at), current.key, ...rest.slice(at)];
    if (next.join() !== order.join()) onReorder(next);
  };

  return (
    <section aria-label="Applied filters">
      <ol className="space-y-1.5">
        {order.map((key, index) => (
          <Row
            key={key}
            filterKey={key}
            index={index}
            count={order.length}
            dragging={draggingKey === key}
            dropSide={dropTarget?.key === key ? dropTarget.side : null}
            registerNode={registerNode}
            onDragStart={handleDragStart}
            onDrag={handleDrag}
            onDragStop={handleDragStop}
            onMove={(to) => onReorder(moveItem(order, index, to))}
            onRemove={() => onRemove(key)}
          />
        ))}
      </ol>
    </section>
  );
};

export default AppliedFilterOrder;

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChartLine, Grid3x3, History, RotateCcw } from "lucide-react";

import Tooltip from "./Tooltip";
import { closedPlotLabel, useClosedPlotsStore } from "../stores/closedPlotsStore";

const fileName = (fpath: string) =>
  fpath
    .replace(/^memory:\/\//, "")
    .split(/[\\/]/)
    .pop() || fpath;

const ago = (time: number, now: number) => {
  const minutes = Math.floor((now - time) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours} h ago`;
};

const ClosedList = ({
  onReopen,
  close,
}: {
  onReopen: (plotId: string) => void;
  close: () => void;
}) => {
  const actions = useClosedPlotsStore((state) => state.actions);
  const clear = useClosedPlotsStore((state) => state.clear);
  const plots = actions.flatMap((action) => action.plots);
  // Recompute relative times each time the list opens.
  const [now] = useState(() => Date.now());
  return (
    <div className="w-72 p-1">
      <div className="flex items-center justify-between px-1.5 pb-1 text-xs font-semibold text-gray-600">
        Recently closed
        {plots.length > 0 && (
          <button
            type="button"
            onClick={() => {
              clear();
              close();
            }}
            className="qimchi-dark-hover-plain rounded px-1.5 py-0.5 font-medium text-gray-500 hover:bg-red-50 hover:text-red-600"
          >
            Clear list
          </button>
        )}
      </div>
      {plots.length === 0 ? (
        <p className="px-1.5 py-2 text-xs text-gray-500">Re-open closed plots from here.</p>
      ) : (
        <ul className="max-h-[min(20rem,calc(100vh-5rem))] overflow-y-auto">
          {plots.map(({ config, closedAt }) => {
            const Icon = config.plotType === "HeatMap" ? Grid3x3 : ChartLine;
            const label = closedPlotLabel(config);
            return (
              <li key={config.id}>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onReopen(config.id);
                    close();
                  }}
                  aria-label={`Reopen ${label}`}
                  className="qimchi-dark-hover-plain group flex w-full items-center gap-2 rounded px-1.5 py-1 text-left hover:bg-gray-100"
                >
                  <Icon size={14} className="shrink-0 text-gray-500" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium text-gray-800">
                      {label}
                    </span>
                    <span className="block truncate text-[0.6875rem] text-gray-500">
                      {fileName(config.fpath)} · {ago(closedAt, now)}
                    </span>
                  </span>
                  <RotateCcw
                    size={13}
                    className="shrink-0 text-gray-400 group-hover:text-blue-600"
                    aria-hidden
                  />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

const GAP = 4;
const MARGIN = 8;

/** Recently closed plots, portalled outside the Viewer to avoid panel clipping. */
const RecentlyClosed = ({ onReopen }: { onReopen: (plotId: string) => void }) => {
  const count = useClosedPlotsStore((state) =>
    state.actions.reduce((total, action) => total + action.plots.length, 0),
  );
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Position beside the button and constrain the menu to the viewport.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const anchor = buttonRef.current?.getBoundingClientRect();
      const list = listRef.current;
      if (!anchor || !list) return;
      const { offsetWidth: width, offsetHeight: height } = list;
      const left = Math.max(MARGIN, anchor.left - width - GAP);
      const centred = anchor.top + anchor.height / 2 - height / 2;
      const top = Math.min(Math.max(MARGIN, centred), window.innerHeight - height - MARGIN);
      setPosition({ left, top: Math.max(MARGIN, top) });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open, count]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!listRef.current?.contains(target) && !buttonRef.current?.contains(target)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const button = (
    <button
      ref={buttonRef}
      type="button"
      onClick={() => {
        setPosition(null);
        setOpen((value) => !value);
      }}
      aria-label="Recently closed plots"
      aria-haspopup="menu"
      aria-expanded={open}
      className={`relative rounded p-1.5 transition-colors duration-150 ${
        open ? "bg-blue-100" : "qimchi-dark-hover-plain hover:bg-gray-200"
      }`}
    >
      <History size={16} className="text-gray-600" aria-hidden />
      {count > 0 && (
        <span className="absolute -right-0.5 -top-0.5 min-w-3.5 rounded-full bg-blue-600 px-0.5 text-center text-[0.5625rem] font-semibold leading-3.5 text-white tabular-nums">
          {count}
        </span>
      )}
    </button>
  );

  return (
    <>
      {open ? (
        button
      ) : (
        <Tooltip
          content={
            count ? `Recently closed plots (${count}) · Ctrl+Z reopens` : "Recently closed plots"
          }
          position="left"
        >
          {button}
        </Tooltip>
      )}
      {open &&
        createPortal(
          <div
            ref={listRef}
            role="menu"
            aria-label="Recently closed plots"
            data-qimchi-popup
            className="fixed z-[1200] rounded-md border border-gray-200 bg-white shadow-lg"
            style={{
              left: position?.left ?? 0,
              top: position?.top ?? 0,
              maxHeight: `calc(100vh - ${2 * MARGIN}px)`,
              // Hide until the menu has been measured and positioned.
              visibility: position ? "visible" : "hidden",
            }}
          >
            <ClosedList onReopen={onReopen} close={() => setOpen(false)} />
          </div>,
          document.body,
        )}
    </>
  );
};

export default RecentlyClosed;

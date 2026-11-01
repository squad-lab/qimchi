import { useEffect } from "react";
import { TriangleAlert, X } from "lucide-react";

import Tooltip from "./Tooltip";
import { primaryClass, secondaryClass } from "./Plots/FilterPresets";

/** Prompt before drawing more than this many plots. */
export const CONFIRM_PLOT_COUNT = 30;

export interface ManyPlotsRequest {
  count: number;
  /** Source of the plot request, shown in the prompt. */
  reason: string;
  /** Suggested way to reduce the plot count. */
  hint: string;
  draw: () => void;
}

/** Confirm plot requests that exceed the count threshold. */
const ConfirmManyPlots = ({
  request,
  onClose,
}: {
  request: ManyPlotsRequest | null;
  onClose: () => void;
}) => {
  useEffect(() => {
    if (!request) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [request, onClose]);

  if (!request) return null;
  const count = request.count.toLocaleString();

  return (
    <div
      className="fixed inset-0 z-[2100] flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={`Draw ${count} plots?`}
        data-qimchi-popup
        className="w-full max-w-md overflow-hidden rounded-lg border-2 border-gray-300 bg-white text-sm text-gray-700 shadow-2xl"
      >
        <div className="flex items-center justify-between border-b-2 border-gray-300 bg-gray-200 p-2">
          <div className="flex items-center gap-2">
            <TriangleAlert size={16} className="shrink-0 text-amber-600" />
            <h2 className="text-base leading-none font-semibold text-gray-800">
              Draw {count} plots?
            </h2>
          </div>
          <Tooltip content="Close" position="bottom">
            <button
              type="button"
              onClick={onClose}
              className="rounded p-1.5 transition-colors hover:bg-gray-300"
              aria-label="Close"
            >
              <X size={16} className="text-red-600" />
            </button>
          </Tooltip>
        </div>
        <div className="space-y-3 px-4 py-3">
          <p>
            {request.reason} would draw {count} plots at once. That many plots can make Qimchi slow
            to respond and use a lot of memory.
          </p>
          <p className="text-xs text-gray-500">{request.hint}</p>
          <div className="flex justify-end gap-1.5">
            <button type="button" autoFocus onClick={onClose} className={secondaryClass}>
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                onClose();
                request.draw();
              }}
              className={primaryClass}
            >
              Draw {count} plots
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ConfirmManyPlots;

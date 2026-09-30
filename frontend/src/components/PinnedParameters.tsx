import { useEffect, useRef, useState } from "react";
import Draggable from "react-draggable";
import { Pin, PinOff, X } from "lucide-react";

import type { BasketItem } from "./Basket";
import Tooltip from "./Tooltip";
import { fetchPinnedParameters, type PinnedParameter } from "../services/parametersAPI";
import { usePinnedParametersStore } from "../stores/pinnedParametersStore";

/** Show pinned qanary parameters for the latest Basket measurement. */
const PinnedParameters = ({ basketItems }: { basketItems: BasketItem[] }) => {
  const { pinned, unpin, clear } = usePinnedParametersStore();
  const nodeRef = useRef<HTMLDivElement>(null);
  const [result, setResult] = useState<{ key: string; parameters?: PinnedParameter[] } | null>(
    null,
  );

  const files = basketItems.filter((item) => item.type === "file");
  const measurement = files[files.length - 1];
  const path = measurement?.path;
  const names = pinned.join("\n");
  const key = `${path}\n${names}`;

  useEffect(() => {
    if (!path || !names) return;
    let cancelled = false;
    fetchPinnedParameters(path, names.split("\n"))
      .then((parameters) => {
        if (!cancelled) setResult({ key, parameters });
      })
      .catch(() => {
        if (!cancelled) setResult({ key });
      });
    return () => {
      cancelled = true;
    };
  }, [path, names, key]);

  if (pinned.length === 0) return null;

  // Ignore stale responses.
  const current = result?.key === key ? result : null;
  const failed = current !== null && !current.parameters;
  const byName = new Map((current?.parameters ?? []).map((p) => [p.name, p]));

  return (
    <Draggable nodeRef={nodeRef} handle=".pinned-parameters-handle" bounds="body">
      <div
        ref={nodeRef}
        role="dialog"
        aria-label="Pinned parameters"
        data-qimchi-popup
        className="fixed bottom-4 left-12 z-[60] flex w-72 flex-col overflow-hidden rounded-xl border border-gray-300 bg-white shadow-2xl"
      >
        <div className="pinned-parameters-handle flex cursor-move items-center justify-between border-b border-blue-200 bg-blue-100 px-3 py-1.5">
          <div className="flex min-w-0 items-center gap-2">
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-1 shadow-sm">
              <Pin size={13} className="text-blue-600" />
            </div>
            <div className="min-w-0">
              <h2 className="text-xs font-bold tracking-tight text-gray-800">Pinned parameters</h2>
              {measurement && (
                <p className="truncate text-[11px] text-gray-500" title={measurement.path}>
                  {measurement.name}
                </p>
              )}
            </div>
          </div>
          <Tooltip content="Unpin all" position="top">
            <button
              type="button"
              onClick={clear}
              className="rounded p-1 transition-colors hover:bg-black/10"
              aria-label="Unpin all parameters"
            >
              <X size={15} className="text-red-600" />
            </button>
          </Tooltip>
        </div>

        <ul className="max-h-72 divide-y divide-gray-100 overflow-y-auto">
          {pinned.map((name) => {
            const parameter = byName.get(name);
            let value: React.ReactNode;
            if (!measurement) value = <span className="text-gray-400">No measurement</span>;
            else if (failed) value = <span className="text-red-600">Unavailable</span>;
            else if (!parameter) value = <span className="text-gray-400">…</span>;
            else if (parameter.missing) value = <span className="text-gray-400">Not recorded</span>;
            else value = parameter.display || <span className="text-gray-400">empty</span>;

            return (
              <li key={name} className="group flex items-center gap-2 px-3 py-1.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-semibold text-gray-700" title={name}>
                    {parameter?.label || name}
                  </div>
                  <div
                    className="truncate font-mono text-sm font-semibold text-blue-700"
                    aria-label={`${name} value`}
                  >
                    {value}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => unpin(name)}
                  className="rounded p-1 text-gray-400 opacity-0 transition-opacity hover:bg-gray-100 hover:text-red-600 focus:opacity-100 group-hover:opacity-100"
                  aria-label={`Unpin ${name}`}
                  title="Unpin"
                >
                  <PinOff size={13} />
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </Draggable>
  );
};

export default PinnedParameters;

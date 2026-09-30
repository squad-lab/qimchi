import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";

import plotlyColorscales from "./plotly_colorscales_plotlyjs.json";

export interface ColorscaleOption {
  label: string;
  value: string;
  warning?: boolean;
}

export interface ColorscaleCategory {
  label: string;
  options: ColorscaleOption[];
}

interface ColorscalePickerProps {
  value: string;
  reversed: boolean;
  categories: ColorscaleCategory[];
  onSelect: (value: string) => void;
  /** Reports the highlighted scale, or null when preview ends. */
  onPreview?: (value: string | null) => void;
}

const scales = plotlyColorscales as unknown as Record<string, [number, string][]>;

const gradient = (value: string, reversed: boolean) => {
  const stops = scales[value] ?? [];
  const colours = stops.map(([position, colour]) => `${colour} ${position * 100}%`);
  return colours.length
    ? `linear-gradient(to ${reversed ? "left" : "right"}, ${colours.join(", ")})`
    : "transparent";
};

const Swatch = ({ value, reversed }: { value: string; reversed: boolean }) => (
  <span
    className="h-3 w-12 shrink-0 rounded-sm border border-black/10"
    style={{ background: gradient(value, reversed) }}
    aria-hidden
  />
);

/** Color-scale picker with pointer and keyboard previews. */
const ColorscalePicker = ({
  value,
  reversed,
  categories,
  onSelect,
  onPreview,
}: ColorscalePickerProps) => {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [position, setPosition] = useState<{ left: number; top: number; width: number }>();
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  // Address options by index because a scale may appear in multiple categories.
  const flat = useMemo(() => categories.flatMap((category) => category.options), [categories]);
  const current = flat.find((option) => option.value === value);

  const close = (commit?: string) => {
    setOpen(false);
    setActive(-1);
    onPreview?.(null);
    if (commit !== undefined && commit !== value) onSelect(commit);
    buttonRef.current?.focus();
  };

  const place = () => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const below = window.innerHeight - rect.bottom;
    const height = Math.min(320, Math.max(below, rect.top) - 12);
    const top = below >= Math.min(320, rect.top) ? rect.bottom + 4 : rect.top - height - 4;
    setPosition({ left: rect.left, top, width: rect.width });
  };

  const openList = () => {
    place();
    setOpen(true);
    setActive(
      Math.max(
        0,
        flat.findIndex((option) => option.value === value),
      ),
    );
  };

  useLayoutEffect(() => {
    if (!open || active < 0) return;
    listRef.current
      ?.querySelector(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!listRef.current?.contains(target) && !buttonRef.current?.contains(target)) close();
    };
    window.addEventListener("mousedown", outside);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("mousedown", outside);
      window.removeEventListener("resize", place);
    };
    // `close` and `place` read current values through refs when invoked.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const move = (to: number) => {
    const index = Math.min(flat.length - 1, Math.max(0, to));
    setActive(index);
    onPreview?.(flat[index].value);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
        event.preventDefault();
        openList();
      }
      return;
    }
    if (event.key === "ArrowDown") move(active + 1);
    else if (event.key === "ArrowUp") move(active - 1);
    else if (event.key === "Home") move(0);
    else if (event.key === "End") move(flat.length - 1);
    else if (event.key === "Enter" || event.key === " ") close(flat[active]?.value);
    else if (event.key === "Escape" || event.key === "Tab") close();
    else return;
    event.preventDefault();
    event.stopPropagation();
  };

  let index = -1;
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => (open ? close() : openList())}
        onKeyDown={onKeyDown}
        className="flex w-full items-center gap-2 rounded border border-gray-300 bg-white p-2 text-left focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
        title="Heatmap colorscale"
        aria-label="Heatmap colorscale"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-activedescendant={open && active >= 0 ? `colorscale-option-${active}` : undefined}
      >
        <Swatch value={value} reversed={reversed} />
        <span className="flex-1 truncate">{current?.label ?? value}</span>
        <ChevronDown size={16} className="shrink-0 text-gray-500" />
      </button>

      {open &&
        position &&
        createPortal(
          <div
            ref={listRef}
            role="listbox"
            aria-label="Heatmap colorscale"
            data-qimchi-popup
            onMouseLeave={() => onPreview?.(null)}
            className="fixed z-[100000] overflow-y-auto rounded-md border border-gray-300 bg-white py-1 shadow-lg"
            style={{
              left: position.left,
              top: position.top,
              width: position.width,
              maxHeight: 320,
            }}
          >
            {categories.map((category) => (
              <div key={category.label} role="group" aria-label={category.label}>
                <div className="px-2 pt-1.5 pb-0.5 text-xs font-semibold text-gray-500">
                  {category.label}
                </div>
                {category.options.map((option) => {
                  index += 1;
                  const at = index;
                  const selected = option.value === value;
                  return (
                    <div
                      key={`${category.label}-${option.value}`}
                      id={`colorscale-option-${at}`}
                      data-index={at}
                      role="option"
                      aria-selected={selected}
                      onMouseEnter={() => {
                        setActive(at);
                        onPreview?.(option.value);
                      }}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => close(option.value)}
                      className={`flex cursor-pointer items-center gap-2 px-3 py-1 text-sm ${
                        at === active ? "bg-blue-100 text-blue-900" : "text-gray-800"
                      } ${selected ? "font-semibold" : ""}`}
                    >
                      <Swatch value={option.value} reversed={reversed} />
                      <span className="truncate">
                        {option.label}
                        {option.warning ? " (Cyclical)" : ""}
                      </span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
};

export default ColorscalePicker;

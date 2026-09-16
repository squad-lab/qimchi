import { useEffect, useRef, useState } from "react";

import Tooltip from "../Tooltip";

interface RibbonFlyoutProps {
  /** Names the button and its menu for screen readers and the tooltip. */
  label: string;
  icon: React.ReactNode;
  /** Receives a function that closes the flyout, for options that should. */
  children: (close: () => void) => React.ReactNode;
}

/**
 * A plot-ribbon button that opens a row of options beside it. Clicking outside,
 * pressing Escape, or choosing an option closes it again.
 */
const RibbonFlyout = ({ label, icon, children }: RibbonFlyoutProps) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
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
      type="button"
      onClick={() => setOpen((value) => !value)}
      aria-label={label}
      aria-haspopup="menu"
      aria-expanded={open}
      className={`relative p-1.5 rounded transition-colors duration-150 ${
        open ? "bg-blue-100" : "qimchi-dark-hover-plain hover:bg-gray-200"
      }`}
    >
      {icon}
    </button>
  );

  return (
    <div ref={rootRef} className="relative">
      {/* Its tooltip would sit over the options, which open on the same side. */}
      {open ? (
        button
      ) : (
        <Tooltip content={label} position="left">
          {button}
        </Tooltip>
      )}
      {open && (
        <div
          role="menu"
          aria-label={label}
          className="absolute right-full top-1/2 z-40 mr-1 flex -translate-y-1/2 items-center gap-0.5 rounded-md border border-gray-200 bg-white p-0.5 shadow-lg"
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
};

export default RibbonFlyout;

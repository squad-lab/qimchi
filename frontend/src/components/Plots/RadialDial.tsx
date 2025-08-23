import React, { useRef, useState, useEffect, useCallback } from "react";

type RadialDialProps = {
  value?: number; // current value in degrees, clamped between min and max
  onChange?: (v: number) => void;
  min?: number; // default -180
  max?: number; // default 180
  step?: number; // keyboard step
  size?: number; // px size of the dial (width & height)
  ticks?: number; // number of tick marks across the sweep
  showTicks?: boolean;
  disabled?: boolean;
  className?: string;
};

export default function RadialDial({
  value: controlledValue,
  onChange,
  min = -180,
  max = 180,
  step = 1,
  size = 200,
  showTicks = true,
  disabled = false,
  className = "",
}: RadialDialProps) {
  // internal state if uncontrolled
  const [uncontrolled, setUncontrolled] = useState(0);
  const value = controlledValue ?? uncontrolled;

  const rootRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);
  // whether major ticks should be "sticky" (snap when near)
  const [sticky, setSticky] = useState(true);

  // visualize only a 300° arc (gap at bottom). This leaves 60° gap centered at 180deg (bottom).
  const ARC_SWEEP = 300; // degrees of arc to use for the dial
  const ARC_START = -ARC_SWEEP / 2; // e.g. -150
  const ARC_END = ARC_SWEEP / 2; // e.g. 150

  // map between value space (min..max) and arc angle space (ARC_START..ARC_END)
  const valueToAngle = useCallback(
    (v: number) => {
      const t = (v - min) / (max - min || 1);
      return ARC_START + t * ARC_SWEEP;
    },
    [min, max, ARC_START, ARC_SWEEP]
  );

  const angleToValue = useCallback(
    (angle: number) => {
      const t = (angle - ARC_START) / ARC_SWEEP;
      return min + t * (max - min || 1);
    },
    [min, max, ARC_START, ARC_SWEEP]
  );

  useEffect(() => {
    // ensure initial value in range
    if (controlledValue == null) {
      setUncontrolled((v) => clamp(v, min, max));
    }
  }, [controlledValue, min, max]);

  const SNAP_DEG = 30;

  const setValue = useCallback(
    (v: number) => {
      v = clamp(Math.round(v / step) * step, min, max);
      // snap to nearest major tick (every 30°) when close to make them "sticky"
      if (sticky) {
        const MAJOR_SNAP_THRESHOLD = 6; // degrees within which we snap to the major tick
        const nearestMajor = Math.round(v / SNAP_DEG) * SNAP_DEG;
        if (
          Math.abs(v - nearestMajor) <= MAJOR_SNAP_THRESHOLD &&
          nearestMajor >= min &&
          nearestMajor <= max
        ) {
          v = nearestMajor;
        }
      }
      if (disabled) return;
      if (onChange) onChange(v);
      if (controlledValue == null) setUncontrolled(v);
    },
    [onChange, controlledValue, min, max, step, disabled, sticky]
  );

  // pointer handlers
  useEffect(() => {
    function onMove(e: PointerEvent) {
      if (!draggingRef.current || !rootRef.current) return;
      const rect = rootRef.current.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const clientX = e.clientX;
      const clientY = e.clientY;
      const dx = clientX - cx;
      const dy = clientY - cy;
      // compute angle relative to vertical axis (up = 0, left = -180, right = 180)
      const angle = (Math.atan2(dx, -dy) * 180) / Math.PI;
      // clamp to the visible arc range and convert to value space
      const clampedAngle = clamp(angle, ARC_START, ARC_END);
      const v = angleToValue(clampedAngle);
      setValue(v);
    }

    function onUp() {
      draggingRef.current = false;
    }

    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onUp);
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onUp);
    };
  }, [setValue, angleToValue, ARC_START, ARC_END]);

  const handlePointerDown = (e: React.PointerEvent) => {
    if (disabled) return;
    // if the pointerdown started on an interactive control (input/button/etc),
    // ignore it so controls inside the dial can be used without starting a drag.
    const target = e.target as HTMLElement | null;
    if (
      target &&
      target.closest &&
      target.closest("input,button,select,textarea,label")
    ) {
      return;
    }
    draggingRef.current = true;
    // capture pointer so we don't lose events
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  // keyboard control
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    const cur = clamp(Math.round(value / step) * step, min, max);
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
      e.preventDefault();
      setValue(clamp(cur - step, min, max));
    } else if (e.key === "ArrowRight" || e.key === "ArrowUp") {
      e.preventDefault();
      setValue(clamp(cur + step, min, max));
    } else if (e.key === "Home") {
      e.preventDefault();
      setValue(min);
    } else if (e.key === "End") {
      e.preventDefault();
      setValue(max);
    }
  };

  // ensure we display and render using discrete steps (e.g. 1° increments)
  const roundedValue = clamp(Math.round(value / step) * step, min, max);
  // visual rotation uses the rounded value mapped to the arc angle
  const rotation = valueToAngle(roundedValue);

  // package ARIA attributes into an object and cast to any to avoid some linters
  const ariaProps: Record<string, unknown> = {
    role: "slider",
    "aria-label": `Rotation angle dial`,
    "aria-valuemin": min,
    "aria-valuemax": max,
    "aria-valuenow": roundedValue,
    "aria-valuetext": `${roundedValue} degrees`,
  };

  // ticks render every 15° across the value range — render as SVG lines so
  // they align pixel-perfect with the arc and pointer.
  const tickLines: React.ReactNode[] = [];
  if (showTicks) {
    const stepDeg = 15;
    const outerR = size / 2 - 12;
    for (
      let deg = Math.ceil(min / stepDeg) * stepDeg;
      deg <= max;
      deg += stepDeg
    ) {
      const ang = valueToAngle(deg); // map value degree to arc angle
      const isMajor = deg % SNAP_DEG === 0;
      const len = isMajor ? 15 : 9;
      const start = polarToCartesian(size / 2, size / 2, outerR, ang);
      const end = polarToCartesian(size / 2, size / 2, outerR - len, ang);
      tickLines.push(
        <line
          key={deg}
          x1={start.x}
          y1={start.y}
          x2={end.x}
          y2={end.y}
          stroke="#9CA3AF"
          strokeWidth={isMajor ? 2 : 1}
          strokeLinecap="round"
        />
      );
    }
  }

  return (
    <div
      {...ariaProps}
      ref={rootRef}
      tabIndex={disabled ? -1 : 0}
      onKeyDown={onKeyDown}
      onPointerDown={handlePointerDown}
      className={`inline-flex items-center justify-center select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-blue-500 rounded-full ${className}`}
      style={{ width: size, height: size }}
    >
      <div className="relative w-full h-full bg-white rounded-full border-2 border-gray-200 shadow-sm">
        {/* Background circle */}
        <div className="absolute inset-2 bg-gray-50 rounded-full" />

        {/* ticks (SVG lines for precise alignment) - rendered inside the SVG below */}

        {/* semicircular background arc */}
        <svg
          className="absolute inset-0 w-full h-full"
          viewBox={`0 0 ${size} ${size}`}
        >
          <defs>
            <linearGradient id={`dial-gradient-${size}`} x1="0" x2="1">
              <stop offset="0%" stopColor="#e5e7eb" />
              <stop offset="100%" stopColor="#d1d5db" />
            </linearGradient>
          </defs>
          {/* tick lines placed inside the SVG so they render correctly */}
          <g>{tickLines}</g>
          {/* outer arc track */}
          <path
            d={describeArc(
              size / 2,
              size / 2,
              size / 2 - 12,
              ARC_START,
              ARC_END
            )}
            fill="none"
            stroke="#e5e7eb"
            strokeWidth={8}
            strokeLinecap="round"
          />
          {/* active arc showing current position */}
          <path
            d={describeArc(
              size / 2,
              size / 2,
              size / 2 - 12,
              ARC_START,
              rotation
            )}
            fill="none"
            stroke="#3b82f6"
            strokeWidth={8}
            strokeLinecap="round"
          />

          {/* start and end markers */}
          {(() => {
            const startPt = polarToCartesian(
              size / 2,
              size / 2,
              size / 2 - 12,
              ARC_START
            );
            const endPt = polarToCartesian(
              size / 2,
              size / 2,
              size / 2 - 12,
              ARC_END
            );
            return (
              <g>
                <circle cx={startPt.x} cy={startPt.y} r={4} fill="#111827" />
                <circle cx={endPt.x} cy={endPt.y} r={4} fill="#111827" />
              </g>
            );
          })()}
          {/* draw pointer as an SVG line rotated about the dial center, and a center dot */}
          <g transform={`rotate(${rotation} ${size / 2} ${size / 2})`}>
            <line
              x1={size / 2}
              y1={size / 2 - 6}
              x2={size / 2}
              y2={12}
              stroke="#3b82f6"
              strokeWidth={6}
              strokeLinecap="round"
            />
          </g>
          <circle cx={size / 2} cy={size / 2} r={4} fill="#3b82f6" />
        </svg>

        {/* center value display (inside the relative container so it centers correctly) */}
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none">
          <div className="w-12 h-12 rounded-full bg-white border border-gray-300 shadow-sm flex items-center justify-center">
            <span className="text-xs font-medium text-gray-700">
              {roundedValue}°
            </span>
          </div>
        </div>

        {/* Snap toggle */}
        <div className="absolute left-1/2 top-full mt-4 -translate-x-1/2 pointer-events-auto">
          <label className="inline-flex items-center text-xs text-gray-700 select-none cursor-pointer">
            <span className="mr-3 text-sm">Snap</span>
            <div className="relative">
              <input
                type="checkbox"
                checked={sticky}
                onChange={(e) => setSticky(e.target.checked)}
                className="sr-only"
                aria-label="Toggle snapping to major ticks"
              />
              <div
                className={`w-10 h-6 rounded-full transition-colors duration-150 ease-in-out ${
                  sticky ? "bg-blue-600" : "bg-gray-300"
                }`}
              />
              <div
                className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full shadow transform transition-transform duration-150 ease-in-out ${
                  sticky ? "translate-x-4" : "translate-x-0"
                }`}
              />
            </div>
          </label>
        </div>
      </div>
    </div>
  );
}

// helpers
function clamp(v: number, a: number, b: number) {
  return Math.min(Math.max(v, a), b);
}

// describeArc from center (cx, cy) with radius r from startAngle to endAngle (degrees)
function describeArc(
  cx: number,
  cy: number,
  r: number,
  startAngle: number,
  endAngle: number
) {
  const start = polarToCartesian(cx, cy, r, endAngle);
  const end = polarToCartesian(cx, cy, r, startAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";
  return [
    `M ${start.x} ${start.y}`,
    `A ${r} ${r} 0 ${largeArcFlag} 0 ${end.x} ${end.y}`,
  ].join(" ");
}

function polarToCartesian(
  cx: number,
  cy: number,
  r: number,
  angleInDegrees: number
) {
  // convert our dial's angle (up=0) to standard polar coordinates
  const angleInRadians = ((angleInDegrees - 0) * Math.PI) / 180.0;
  const x = cx + Math.sin(angleInRadians) * r;
  const y = cy - Math.cos(angleInRadians) * r;
  return { x, y };
}

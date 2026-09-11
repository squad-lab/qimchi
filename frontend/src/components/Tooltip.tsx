import React, { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";

interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactNode;
  position?: "top" | "bottom" | "left" | "right" | "center" | "cursor"; // TODOLATER: Handle cursor & center
  className?: string;
}

const Tooltip: React.FC<TooltipProps> = ({
  content,
  children,
  position = "top",
  className = "",
}) => {
  const [isVisible, setIsVisible] = useState(false);
  const [positionClass, setPositionClass] = useState("");
  // The side actually used, which may differ from `position` when the
  // requested side has no room (see the flip below). The arrow follows this.
  const [resolvedPosition, setResolvedPosition] = useState(position);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const portalRef = useRef<HTMLDivElement | null>(null);
  const showTimerRef = useRef<number | null>(null);
  const hideTimerRef = useRef<number | null>(null);

  const updateTooltipPosition = useCallback(() => {
    if (!triggerRef.current) return;

    const triggerRect = triggerRef.current.getBoundingClientRect();

    // Flip a top/bottom tooltip to the other side when the requested one would
    // run off the viewport -- buttons in a toolbar sitting at y=0 (the section
    // rail, the Explorer path row) otherwise render their tooltip off-screen.
    // The tooltip is not mounted yet, so its extent has to be estimated; this
    // is deliberately generous so a two-line tooltip still flips.
    const TOOLTIP_CLEARANCE = 56;
    let side = position;
    if (position === "top" && triggerRect.top < TOOLTIP_CLEARANCE) {
      side = "bottom";
    } else if (
      position === "bottom" &&
      window.innerHeight - triggerRect.bottom < TOOLTIP_CLEARANCE
    ) {
      side = "top";
    }

    // Compute coords in viewport space and set CSS variables on :root so
    // the portal-rendered tooltip can use position:fixed and escape ancestor
    // clipping (overflow:hidden). This avoids inline styles which trigger
    // the project's linter rule.
    let left = triggerRect.left + triggerRect.width / 2;
    let top = triggerRect.top;
    let transform = "translate(-50%, -100%)";

    switch (side) {
      case "top":
        top = triggerRect.top - 8;
        transform = "translate(-50%, -100%)";
        break;
      case "bottom":
        top = triggerRect.top + triggerRect.height + 8;
        transform = "translate(-50%, 0)";
        break;
      case "left":
        left = triggerRect.left - 8;
        top = triggerRect.top + triggerRect.height / 2;
        transform = "translate(-100%, -50%)";
        break;
      case "right":
        left = triggerRect.left + triggerRect.width + 8;
        top = triggerRect.top + triggerRect.height / 2;
        transform = "translate(0, -50%)";
        break;
      case "center":
        left = triggerRect.left + triggerRect.width / 2;
        top = triggerRect.top + triggerRect.height / 2;
        transform = "translate(-50%, -50%)";
        break;
    }

    try {
      // Prefer setting CSS vars on the portal container so each Tooltip
      // instance is isolated. Fall back to :root if portal isn't ready.
      const container = portalRef.current || document.documentElement;
      if (container && container instanceof HTMLElement) {
        container.style.setProperty("--tooltip-left", `${left}px`);
        container.style.setProperty("--tooltip-top", `${top}px`);
        container.style.setProperty("--tooltip-transform", transform);
      }
    } catch {
      // ignore in SSR or restricted environments
    }

    setPositionClass(`tooltip-${side}`);
    setResolvedPosition(side);
  }, [position]);

  // No rAF: we compute position before mounting the tooltip so it doesn't flash at 0,0

  // When tooltip mounts, set aria-hidden appropriately
  useEffect(() => {
    if (!tooltipRef.current) return;
    tooltipRef.current.setAttribute("aria-hidden", isVisible ? "false" : "true");
  }, [isVisible]);

  // Use pointer events and short timers to avoid flicker / race conditions when quickly moving pointer
  const handlePointerEnter = () => {
    // clear any pending hide timer
    if (hideTimerRef.current) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }

    // small show delay to avoid showing on accidental passes
    if (showTimerRef.current) {
      window.clearTimeout(showTimerRef.current);
    }
    showTimerRef.current = window.setTimeout(() => {
      // compute position first, then show
      updateTooltipPosition();
      setIsVisible(true);
      showTimerRef.current = null;
    }, 40); // 40ms
  };

  const handlePointerLeave = () => {
    // clear any pending show timer
    if (showTimerRef.current) {
      window.clearTimeout(showTimerRef.current);
      showTimerRef.current = null;
    }

    if (hideTimerRef.current) {
      window.clearTimeout(hideTimerRef.current);
    }
    // small hide delay to avoid race when moving between child elements quickly
    hideTimerRef.current = window.setTimeout(() => {
      setIsVisible(false);
      hideTimerRef.current = null;
    }, 50); // 50ms
  };

  const hideTooltipImmediate = useCallback(() => {
    if (showTimerRef.current) {
      window.clearTimeout(showTimerRef.current);
      showTimerRef.current = null;
    }
    if (hideTimerRef.current) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
    setIsVisible(false);
  }, []);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (showTimerRef.current) {
        window.clearTimeout(showTimerRef.current);
      }
      if (hideTimerRef.current) {
        window.clearTimeout(hideTimerRef.current);
      }
    };
  }, []);

  // Create a portal container to escape clipping from overflow:hidden ancestors.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const el = document.createElement("div");
    el.className = "tooltip-portal";
    portalRef.current = el;
    document.body.appendChild(el);
    return () => {
      if (portalRef.current && portalRef.current.parentNode) {
        portalRef.current.parentNode.removeChild(portalRef.current);
      }
      portalRef.current = null;
    };
  }, []);

  // Hide tooltip on outside interactions (clicks, Escape) to avoid sticky tooltips
  useEffect(() => {
    if (!isVisible) return;

    const onDocPointerDown = (e: PointerEvent) => {
      const triggerEl = triggerRef.current;
      const tooltipEl = tooltipRef.current;

      // Prefer composedPath for shadow DOM support; fall back to contains(target).
      let clickedInside = false;
      if (e.composedPath) {
        const path = e.composedPath();
        if (triggerEl && path.includes(triggerEl)) clickedInside = true;
        if (tooltipEl && path.includes(tooltipEl)) clickedInside = true;
      } else {
        const target = e.target as Node | null;
        if (triggerEl && target && triggerEl.contains(target)) clickedInside = true;
        if (tooltipEl && target && tooltipEl.contains(target)) clickedInside = true;
      }

      if (!clickedInside) hideTooltipImmediate();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") hideTooltipImmediate();
    };

    document.addEventListener("pointerdown", onDocPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);

    return () => {
      document.removeEventListener("pointerdown", onDocPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [isVisible, hideTooltipImmediate]);

  return (
    <>
      <div
        ref={triggerRef}
        onPointerEnter={handlePointerEnter}
        onPointerLeave={handlePointerLeave}
        className={`block min-w-0 ${className}`}
        // ensure the wrapper doesn't block pointer events for its children
      >
        {children}
      </div>

      {isVisible && portalRef.current
        ? createPortal(
            <div
              ref={tooltipRef}
              role="tooltip"
              className={
                `tooltip-positioned ${positionClass} px-3 py-2 text-sm text-white bg-gray-900 rounded-lg shadow-lg transition-opacity duration-150 ` +
                (isVisible ? "opacity-100" : "opacity-0")
              }
            >
              {content}
              {/* Small arrow attached to the tooltip */}
              <div
                className={`absolute w-2 h-2 bg-gray-900 transform rotate-45 ${
                  resolvedPosition === "top"
                    ? "bottom-[-4px] left-1/2 -translate-x-1/2"
                    : resolvedPosition === "bottom"
                      ? "top-[-4px] left-1/2 -translate-x-1/2"
                      : resolvedPosition === "left"
                        ? "right-[-4px] top-1/2 -translate-y-1/2"
                        : resolvedPosition === "center"
                          ? "top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
                          : "left-[-4px] top-1/2 -translate-y-1/2"
                }`}
              />
            </div>,
            portalRef.current,
          )
        : null}
    </>
  );
};

export default Tooltip;

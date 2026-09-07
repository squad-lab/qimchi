import { useState, useCallback, useRef, useEffect } from "react";

// Local imports
import type { PlotPosition, PlotSize, PlotState } from "../interfaces";

export const usePlotInteractions = (
  plotId: string,
  initialPosition?: PlotPosition,
  initialSize?: PlotSize,
) => {
  const [plotState, setPlotState] = useState<PlotState>({
    id: plotId,
    position: initialPosition || { x: 50, y: 50 },
    size: initialSize || { width: 600, height: 450 },
    isMaximized: false,
    isDragging: false,
    zIndex: 1,
  });

  const plotRef = useRef<HTMLDivElement>(null);
  const [focusedPlotId, setFocusedPlotId] = useState<string | null>(null);

  // Bring plot to front when clicked
  const bringToFront = useCallback(() => {
    setPlotState((prev) => ({
      ...prev,
      zIndex: Date.now(), // Simple z-index management
    }));
    setFocusedPlotId(plotId);
  }, [plotId]);

  // Handle drag events
  const handleDragStart = useCallback(() => {
    setPlotState((prev) => ({ ...prev, isDragging: true }));
    bringToFront();
  }, [bringToFront]);

  const handleDragStop = useCallback((_e: unknown, data: { x: number; y: number }) => {
    setPlotState((prev) => ({
      ...prev,
      isDragging: false,
      position: { x: data.x, y: data.y },
    }));
  }, []);

  // Handle resize events
  const handleResizeStop = useCallback(
    (
      _e: unknown,
      _direction: unknown,
      ref: HTMLElement,
      _delta: unknown,
      position: { x: number; y: number },
    ) => {
      setPlotState((prev) => ({
        ...prev,
        size: {
          width: ref.offsetWidth,
          height: ref.offsetHeight,
        },
        position,
      }));
    },
    [],
  );

  // Handle maximize/minimize
  const toggleMaximize = useCallback(() => {
    setPlotState((prev) => ({
      ...prev,
      isMaximized: !prev.isMaximized,
    }));
    bringToFront();
  }, [bringToFront]);

  // Auto-focus management
  useEffect(() => {
    const handleGlobalClick = (e: MouseEvent) => {
      if (plotRef.current && !plotRef.current.contains(e.target as Node)) {
        if (focusedPlotId === plotId) {
          setFocusedPlotId(null);
        }
      }
    };

    document.addEventListener("mousedown", handleGlobalClick);
    return () => document.removeEventListener("mousedown", handleGlobalClick);
  }, [plotId, focusedPlotId]);

  const isFocused = focusedPlotId === plotId;

  return {
    plotState,
    plotRef,
    isFocused,
    bringToFront,
    handleDragStart,
    handleDragStop,
    handleResizeStop,
    toggleMaximize,
  };
};

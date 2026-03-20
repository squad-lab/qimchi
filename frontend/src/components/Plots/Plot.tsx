import React, {
  useEffect,
  useRef,
  useState,
  useMemo,
  useCallback,
  useDeferredValue,
} from "react";
import { Layout, Config, Data } from "plotly.js";
import * as Plotly from "plotly.js";

// Local imports
import { lightTheme, applyThemeToLayout } from "./themes";

type PlotlyJSON = {
  data: Data[];
  layout: Partial<Layout>;
  config?: Partial<Config>;
};

type CustomizationProps = {
  theme?: "light" | "dark";
  xTickCount?: number;
  yTickCount?: number;
  tickLength?: number;
  minorTicks?: {
    show: boolean;
    tickLen?: number;
    tickColor?: string;
  };
};

type Props = {
  plotJson: PlotlyJSON;
  customization?: CustomizationProps;
  onRelayout?: (relayoutData: Record<string, unknown>) => void;
  onClick?: (event: Plotly.PlotMouseEvent) => void;
};

const PlotComponent: React.FC<Props> = React.memo(
  ({ plotJson, onRelayout, onClick }) => {
    // Defer plot JSON updates to reduce flickering during rapid appearance changes
    const deferredPlotJson = useDeferredValue(plotJson);

    const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
    const plotRef = useRef<HTMLDivElement>(null);
    const plotContainerRef = useRef<HTMLDivElement>(null);
    const lastPlotStructureRef = useRef<string>("");
    const dataRevisionRef = useRef<number>(0);

    // Keep a ref to the latest onRelayout callback so the listener never needs
    // to be re-registered when the parent re-creates the callback function.
    const onRelayoutRef = useRef(onRelayout);
    const relayoutListenerRef = useRef<
      ((event: Plotly.PlotRelayoutEvent) => void) | null
    >(null);
    // Synchronous ref update – safe to do during render.
    onRelayoutRef.current = onRelayout;

    const onClickRef = useRef(onClick);
    onClickRef.current = onClick;
    const clickListenerRef = useRef<
      ((event: Plotly.PlotMouseEvent) => void) | null
    >(null);

    // Create a structural hash to detect when plot needs full recreation vs just data update
    const plotStructureHash = useMemo(() => {
      return JSON.stringify({
        dataLength: deferredPlotJson.data?.length || 0,
        traceTypes: deferredPlotJson.data?.map((d) => d.type) || [],
        layoutKeys: Object.keys(deferredPlotJson.layout || {}).sort(),
        hasConfig: !!deferredPlotJson.config,
      });
    }, [
      deferredPlotJson.data,
      deferredPlotJson.layout,
      deferredPlotJson.config,
    ]);

    // Check if structure changed significantly
    const structureChanged = plotStructureHash !== lastPlotStructureRef.current;

    // Enhanced layout with better visual styling using theme
    const enhancedLayout: Partial<Layout> = useMemo(() => {
      const baseLayout = {
        ...applyThemeToLayout(deferredPlotJson.layout, lightTheme),
        autosize: true,
        width: dimensions.width || undefined,
        height: dimensions.height || undefined,
        plot_bgcolor: "rgba(0,0,0,0)",
        paper_bgcolor: "rgba(0,0,0,0)",
        xaxis: {
          ...deferredPlotJson.layout.xaxis,
          ticks: "outside" as const,
          showline: true,
          mirror: true,
          automargin: true,
          zeroline: false,
          linewidth: 2,
          showgrid: false,
          linecolor: "black",
        },
        yaxis: {
          ...deferredPlotJson.layout.yaxis,
          ticks: "outside" as const,
          showline: true,
          mirror: true,
          automargin: true,
          zeroline: false,
          linewidth: 2,
          showgrid: false,
          linecolor: "black",
        },
      };

      // If structure didn't change but data might have changed, increment datarevision
      if (!structureChanged && lastPlotStructureRef.current) {
        dataRevisionRef.current += 1;
        baseLayout.datarevision = dataRevisionRef.current;
      }

      return baseLayout;
    }, [
      deferredPlotJson.layout,
      dimensions.width,
      dimensions.height,
      structureChanged,
    ]);

    const enhancedConfig: Partial<Config> = useMemo(
      () => ({
        typesetMath: true,
        editable: true,
        edits: {
          annotationTail: true,
          annotationText: false,
          annotationPosition: true,
          axisTitleText: true,
          colorbarTitleText: true,
          colorbarPosition: true,
          titleText: false,
        },
        responsive: true,
        displaylogo: false,
        displayModeBar: "hover",
        modeBarButtonsToAdd: [],
        toImageButtonOptions: {
          format: "svg" as const,
          filename: "plot",
          height: dimensions.height,
          width: dimensions.width,
          scale: 2,
        },
        ...deferredPlotJson.config,
      }),
      [deferredPlotJson.config, dimensions.height, dimensions.width],
    );

    // Function to update plot using Plotly.react for efficient updates
    const updatePlot = useCallback(async () => {
      if (
        !plotRef.current ||
        dimensions.width === 0 ||
        dimensions.height === 0
      ) {
        return;
      }

      try {
        if (structureChanged) {
          console.log(
            "[Plot] Structure changed, using Plotly.react for full update",
          );
          lastPlotStructureRef.current = plotStructureHash;
          dataRevisionRef.current = 0; // Reset data revision for new structure
        } else {
          console.log(
            "[Plot] Structure unchanged, using Plotly.react for efficient update",
          );
        }

        // Use Plotly.react - it automatically determines whether to create or update
        await Plotly.react(
          plotRef.current,
          deferredPlotJson.data,
          enhancedLayout,
          enhancedConfig,
        );

        // If MathJax is loaded, typeset the container so TeX axis labels render.
        try {
          // MathJax v3 exposes typesetPromise. If not present, this will be a no-op.
          if (
            // @ts-expect-error allow access to global MathJax added by index.html
            window.MathJax &&
            // @ts-expect-error allow access to global MathJax added by index.html
            typeof window.MathJax.typesetPromise === "function"
          ) {
            // @ts-expect-error call typesetPromise dynamically
            await window.MathJax.typesetPromise([plotRef.current]);
          }
        } catch (err: unknown) {
          // If MathJax is still initializing and reports missing output jax, retry once
          const msg =
            (err && (err as { message?: string }).message) || String(err);
          const msgStr = String(msg);
          if (msgStr.includes('Output Jax "svg" is not defined')) {
            // Give MathJax a short moment and retry once
            try {
              await new Promise((res) => setTimeout(res, 200));
              // @ts-expect-error call typesetPromise dynamically
              await window.MathJax.typesetPromise([plotRef.current]);
            } catch (err2) {
              console.warn("[Plot] MathJax retry failed:", err2);
            }
          } else {
            // Non-fatal: log for debugging but don't break plot rendering
            console.warn("[Plot] MathJax typeset failed:", err);
          }
        }

        // Attach the plotly_relayout listener the first time the plot is ready.
        // Guard prevents duplicate registration across multiple updatePlot calls.
        if (!relayoutListenerRef.current) {
          const plotEl = plotRef.current as any;
          if (typeof plotEl.on === "function") {
            const handler = (event: Plotly.PlotRelayoutEvent) => {
              onRelayoutRef.current?.(event as Record<string, unknown>);
            };
            relayoutListenerRef.current = handler;
            plotEl.on("plotly_relayout", handler);
          }
        }

        // Attach the plotly_click listener
        if (!clickListenerRef.current) {
          const plotEl = plotRef.current as any;
          if (typeof plotEl.on === "function") {
            const handler = (event: Plotly.PlotMouseEvent) => {
              onClickRef.current?.(event);
            };
            clickListenerRef.current = handler;
            plotEl.on("plotly_click", handler);
          }
        }

        return true;
      } catch (error) {
        console.error("[Plot] Error updating plot:", error);
        return false;
      }
    }, [
      deferredPlotJson.data,
      enhancedLayout,
      enhancedConfig,
      dimensions.width,
      dimensions.height,
      structureChanged,
      plotStructureHash,
    ]);

    // Update plot when data or layout changes
    useEffect(() => {
      updatePlot();
    }, [updatePlot]);

    // Clean up the plotly_relayout listener when the component unmounts.
    // The listener itself is registered inside updatePlot after Plotly initialises,
    // so there is exactly one listener per mounted Plot instance.
    useEffect(() => {
      return () => {
        const plotEl = plotRef.current as any;
        if (
          plotEl &&
          relayoutListenerRef.current &&
          typeof plotEl.off === "function"
        ) {
          plotEl.off("plotly_relayout", relayoutListenerRef.current);
          relayoutListenerRef.current = null;
        }
        if (
          plotEl &&
          clickListenerRef.current &&
          typeof plotEl.off === "function"
        ) {
          plotEl.off("plotly_click", clickListenerRef.current);
          clickListenerRef.current = null;
        }
      };
    }, []);

    useEffect(() => {
      const updateDimensions = () => {
        if (plotContainerRef.current) {
          const { offsetWidth, offsetHeight } = plotContainerRef.current;
          const newWidth = offsetWidth;
          const newHeight = Math.max(250, offsetHeight - 20);

          // Only update if dimensions changed significantly (more than 5px)
          setDimensions((prev) => {
            if (
              Math.abs(prev.width - newWidth) > 5 ||
              Math.abs(prev.height - newHeight) > 5
            ) {
              return { width: newWidth, height: newHeight };
            }
            return prev;
          });
        }
      };

      // Debounced update function
      let timeoutId: NodeJS.Timeout;
      const debouncedUpdate = () => {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(updateDimensions, 150);
      };

      // Initial measurement
      const timer = setTimeout(updateDimensions, 100);

      // Use ResizeObserver for container resize detection
      const resizeObserver = new ResizeObserver(() => {
        debouncedUpdate();
      });

      if (plotContainerRef.current) {
        resizeObserver.observe(plotContainerRef.current);
      }

      // Window resize backup
      window.addEventListener("resize", debouncedUpdate);

      return () => {
        clearTimeout(timer);
        clearTimeout(timeoutId);
        window.removeEventListener("resize", debouncedUpdate);
        resizeObserver.disconnect();
      };
    }, []);

    // Cleanup function to purge plot on unmount
    useEffect(() => {
      const currentPlotRef = plotRef.current;
      return () => {
        if (currentPlotRef) {
          try {
            Plotly.purge(currentPlotRef);
          } catch (error) {
            console.warn("[Plot] Error purging plot on unmount:", error);
          }
        }
      };
    }, []);

    return (
      <div ref={plotContainerRef} className="w-full h-full min-h-[400px]">
        {dimensions.width > 0 && dimensions.height > 0 && (
          <div
            ref={plotRef}
            style={{
              width: "100%",
              height: "100%",
            }}
          />
        )}
      </div>
    );
  },
);

// Custom comparison function to prevent unnecessary re-renders
// Only re-render if the plot structure or significant layout properties change
const plotPropsAreEqual = (prevProps: Props, nextProps: Props): boolean => {
  // Quick reference check first
  if (prevProps.plotJson === nextProps.plotJson) {
    return true;
  }

  // Check if data length or trace types changed (structural changes)
  const prevData = prevProps.plotJson.data || [];
  const nextData = nextProps.plotJson.data || [];

  if (prevData.length !== nextData.length) {
    return false;
  }

  // Check trace types
  const prevTypes = prevData.map((d) => d.type);
  const nextTypes = nextData.map((d) => d.type);
  if (JSON.stringify(prevTypes) !== JSON.stringify(nextTypes)) {
    return false;
  }

  // Check for trace changes (axis swap, styling updates)
  for (let i = 0; i < prevData.length; i++) {
    const prevTrace = prevData[i] as Record<string, unknown>;
    const nextTrace = nextData[i] as Record<string, unknown>;

    // Quick reference check for the entire trace
    if (prevTrace === nextTrace) continue;

    // Check style properties that may have been updated by AppearanceSettings
    const styleProps = [
      "mode",
      "line",
      "marker",
      "opacity",
      "colorscale",
      "zmin",
      "zmax",
    ];
    for (const prop of styleProps) {
      if (JSON.stringify(prevTrace[prop]) !== JSON.stringify(nextTrace[prop])) {
        return false;
      }
    }

    // Check data arrays, optimizing with reference equality first
    if (
      (prevTrace.x !== nextTrace.x &&
        JSON.stringify(prevTrace.x) !== JSON.stringify(nextTrace.x)) ||
      (prevTrace.y !== nextTrace.y &&
        JSON.stringify(prevTrace.y) !== JSON.stringify(nextTrace.y)) ||
      (prevTrace.z !== nextTrace.z &&
        JSON.stringify(prevTrace.z) !== JSON.stringify(nextTrace.z))
    ) {
      return false;
    }
  }

  // Check layout changes (axis titles, ranges, etc.)
  const prevLayout = prevProps.plotJson.layout || {};
  const nextLayout = nextProps.plotJson.layout || {};
  const prevLayoutStr = JSON.stringify(prevLayout);
  const nextLayoutStr = JSON.stringify(nextLayout);
  if (prevLayoutStr !== nextLayoutStr) {
    return false;
  }

  // Don't compare onRelayout callback - it's a function that may be recreated
  return true;
};

export default React.memo(PlotComponent, plotPropsAreEqual);

import React, { useEffect, useRef, useState, useMemo, useCallback, useDeferredValue } from "react";
import { Layout, Config, Data } from "plotly.js";
import * as Plotly from "plotly.js";

// Local imports
import { lightTheme, darkTheme, applyThemeToLayout } from "./themes";
import { useThemeStore } from "../../stores/themeStore";

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
  onHover?: (event: Plotly.PlotMouseEvent) => void;
};

/**
 * Plotly binds its inline title editor to the source SVG <text> element, but
 * MathJax hides that element and places a non-interactive SVG group over it.
 * Forward clicks from primary X/Y MathJax titles to Plotly's existing editor.
 */
const mathAxisTitleSource = (mathTitle: SVGGElement): SVGTextElement | null => {
  const mathClass = [...mathTitle.classList].find((className) =>
    /^[xy]title-math-group$/.test(className),
  );
  if (!mathClass) return null;
  const titleClass = mathClass.slice(0, -"-math-group".length);
  return mathTitle.parentElement?.querySelector<SVGTextElement>(`text.${titleClass}`) || null;
};

/**
 * Annotation text -- the heatmap colorbar title among it -- is already
 * editable through Plotly's own delegate on the surrounding group, so a click
 * only has to reach it. MathJax's overlay is what stops it.
 */
const MATH_GROUP_SELECTOR = "g[class*='-math-group']";
const isAnnotationMathGroup = (mathTitle: SVGGElement) =>
  mathTitle.classList.contains("annotation-text-math-group");

const enableMathAxisTitleEditing = (plotElement: HTMLDivElement) => {
  const mathTitles = plotElement.querySelectorAll<SVGGElement>(MATH_GROUP_SELECTOR);
  for (const mathTitle of mathTitles) {
    if (!mathAxisTitleSource(mathTitle) && !isAnnotationMathGroup(mathTitle)) continue;

    mathTitle.style.pointerEvents = "all";
    mathTitle.style.cursor = "text";
    const mathSvg = mathTitle.querySelector<SVGSVGElement>("svg");
    if (mathSvg) {
      mathSvg.style.pointerEvents = "all";
      mathSvg.style.cursor = "text";
    }
  }
};

/**
 * Plotly anchors its editor to the title it replaces, which for a rotated Y
 * title lands off the left edge of small cards. Tag every axis-title editor so
 * the stylesheet can centre it inside the plot area instead.
 */
const tagAxisTitleEditor = (plotElement: HTMLDivElement) => {
  plotElement
    .querySelector<HTMLElement>(".plugin-editable[contenteditable='true']")
    ?.classList.add("qimchi-axis-title-editor");
};

const forwardMathAxisTitleClick = (plotElement: HTMLDivElement, event: MouseEvent) => {
  if (event.target instanceof Element && event.target.matches("text.xtitle, text.ytitle")) {
    // Plain-text titles go straight to Plotly's own handler; tag the editor it
    // creates once that handler has run.
    window.requestAnimationFrame(() => tagAxisTitleEditor(plotElement));
    return;
  }

  const mathTitles = plotElement.querySelectorAll<SVGGElement>(MATH_GROUP_SELECTOR);
  for (const mathTitle of mathTitles) {
    const bounds = mathTitle.getBoundingClientRect();
    if (
      event.clientX < bounds.left ||
      event.clientX > bounds.right ||
      event.clientY < bounds.top ||
      event.clientY > bounds.bottom
    ) {
      continue;
    }

    if (isAnnotationMathGroup(mathTitle)) {
      // Plotly listens on the annotation's own group, so this click already
      // reaches its editor -- let it through and only tag what it opens.
      window.requestAnimationFrame(() => tagAxisTitleEditor(plotElement));
      return;
    }

    const sourceTitle = mathAxisTitleSource(mathTitle);
    if (!sourceTitle) continue;
    event.preventDefault();
    event.stopPropagation();

    // Give Plotly's HTML editor a measurable source element to align to.
    // Plotly hides it again when the edited value is re-rendered.
    sourceTitle.style.display = "";
    sourceTitle.style.opacity = "0";
    sourceTitle.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        clientX: event.clientX,
        clientY: event.clientY,
      }),
    );
    tagAxisTitleEditor(plotElement);
    return;
  }
};

const PlotComponent: React.FC<Props> = React.memo(({ plotJson, onRelayout, onClick, onHover }) => {
  // Defer plot JSON updates to reduce flickering during rapid appearance changes
  const deferredPlotJson = useDeferredValue(plotJson);
  const appTheme = useThemeStore((state) => state.theme);
  const plotTheme = appTheme === "dark" ? darkTheme : lightTheme;

  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const plotRef = useRef<HTMLDivElement>(null);
  const plotContainerRef = useRef<HTMLDivElement>(null);
  const lastPlotStructureRef = useRef<string>("");
  const dataRevisionRef = useRef<number>(0);

  // Keep a ref to the latest onRelayout callback so the listener never needs
  // to be re-registered when the parent re-creates the callback function.
  const onRelayoutRef = useRef(onRelayout);
  const relayoutListenerRef = useRef<((event: Plotly.PlotRelayoutEvent) => void) | null>(null);
  // Synchronous ref update – safe to do during render.
  onRelayoutRef.current = onRelayout;

  const onClickRef = useRef(onClick);
  onClickRef.current = onClick;
  const clickListenerRef = useRef<((event: Plotly.PlotMouseEvent) => void) | null>(null);

  const onHoverRef = useRef(onHover);
  onHoverRef.current = onHover;
  const hoverListenerRef = useRef<((event: Plotly.PlotMouseEvent) => void) | null>(null);

  // Create a structural hash to detect when plot needs full recreation vs just data update
  const plotStructureHash = useMemo(() => {
    return JSON.stringify({
      dataLength: deferredPlotJson.data?.length || 0,
      traceTypes: deferredPlotJson.data?.map((d) => d.type) || [],
      layoutKeys: Object.keys(deferredPlotJson.layout || {}).sort(),
      hasConfig: !!deferredPlotJson.config,
    });
  }, [deferredPlotJson.data, deferredPlotJson.layout, deferredPlotJson.config]);

  // Check if structure changed significantly
  const structureChanged = plotStructureHash !== lastPlotStructureRef.current;

  // Enhanced layout with better visual styling using theme
  const enhancedLayout: Partial<Layout> = useMemo(() => {
    const themedLayout = applyThemeToLayout(deferredPlotJson.layout, plotTheme);
    const baseLayout = {
      ...themedLayout,
      autosize: true,
      width: dimensions.width || undefined,
      height: dimensions.height || undefined,
      plot_bgcolor: "rgba(0,0,0,0)",
      paper_bgcolor: "rgba(0,0,0,0)",
      xaxis: {
        ...themedLayout.xaxis,
        ticks: "outside" as const,
        showline: true,
        mirror: true,
        automargin: true,
        zeroline: false,
        linewidth: 2,
        showgrid: false,
        linecolor: plotTheme.colors.text,
      },
      yaxis: {
        ...themedLayout.yaxis,
        ticks: "outside" as const,
        showline: true,
        mirror: true,
        automargin: true,
        zeroline: false,
        linewidth: 2,
        showgrid: false,
        linecolor: plotTheme.colors.text,
      },
    };

    // If structure didn't change but data might have changed, increment datarevision
    if (!structureChanged && lastPlotStructureRef.current) {
      dataRevisionRef.current += 1;
      baseLayout.datarevision = dataRevisionRef.current;
    }

    return baseLayout;
  }, [deferredPlotJson.layout, dimensions.width, dimensions.height, structureChanged, plotTheme]);

  const enhancedConfig: Partial<Config> = useMemo(
    () => ({
      editable: true,
      edits: {
        annotationTail: true,
        annotationText: true,
        annotationPosition: true,
        axisTitleText: true,
        // Heatmap titles are rendered by the MathJax-safe annotation above
        // the colorbar. The native title is intentionally blank, so enabling
        // its editor exposes Plotly's "Click to enter Colorscale title"
        // placeholder behind the real title. This only covers trace-level
        // colorbars -- a layout `coloraxis` one is routed to axisTitleText by
        // Plotly, so its placeholder is hidden in PlotWrapper.css instead.
        colorbarTitleText: false,
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
      // Fit equations and derivative labels are supplied as TeX by the
      // backend. Keep Plotly's own SVG MathJax conversion enabled even when
      // an older saved plot config did not know about this setting.
      typesetMath: true,
    }),
    [deferredPlotJson.config, dimensions.height, dimensions.width],
  );

  // Function to update plot using Plotly.react for efficient updates
  const updatePlot = useCallback(async () => {
    if (!plotRef.current || dimensions.width === 0 || dimensions.height === 0) {
      return;
    }

    try {
      if (structureChanged) {
        console.log("[Plot] Structure changed, using Plotly.react for full update");
        lastPlotStructureRef.current = plotStructureHash;
        dataRevisionRef.current = 0; // Reset data revision for new structure
      } else {
        console.log("[Plot] Structure unchanged, using Plotly.react for efficient update");
      }

      // Plotly v4 supports MathJax v3/v4 directly. Wait for the configured
      // tex-svg component so its first render can typeset axis titles and fit
      // annotations instead of racing MathJax startup.
      const mathJax = (window as any).MathJax;
      if (mathJax?.startup?.promise) {
        await mathJax.startup.promise;
      }

      // Use Plotly.react - it automatically determines whether to create or update
      await Plotly.react(plotRef.current, deferredPlotJson.data, enhancedLayout, enhancedConfig);
      enableMathAxisTitleEditing(plotRef.current);

      // Explicitly typeset dynamic Plotly content after every react/update.
      // Plotly handles its own math, while this pass catches any labels or
      // annotations inserted during the update cycle.
      if (typeof mathJax?.typesetPromise === "function") {
        try {
          await mathJax.typesetPromise([plotRef.current]);
        } catch (error) {
          // Plotly has already rendered its own MathJax groups. A secondary
          // page-level typeset failure must not disable plot interactions.
          console.warn("[Plot] Additional MathJax typeset failed", error);
        }
      } else {
        console.warn("[Plot] MathJax tex-svg component is not available");
      }

      enableMathAxisTitleEditing(plotRef.current);

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

      // Attach the plotly_hover listener
      if (!hoverListenerRef.current) {
        const plotEl = plotRef.current as any;
        if (typeof plotEl.on === "function") {
          const handler = (event: Plotly.PlotMouseEvent) => {
            onHoverRef.current?.(event);
          };
          hoverListenerRef.current = handler;
          plotEl.on("plotly_hover", handler);
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

  // MathJax replaces its SVG groups asynchronously, including after a title
  // edit triggers Plotly.react. Re-attach the title click bridge whenever
  // those groups are replaced.
  useEffect(() => {
    const plotElement = plotRef.current;
    if (!plotElement) return;

    let animationFrame: number | null = null;
    const observer = new MutationObserver(() => {
      if (animationFrame !== null) return;
      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = null;
        enableMathAxisTitleEditing(plotElement);
      });
    });
    observer.observe(plotElement, { childList: true, subtree: true });
    const clickHandler = (event: MouseEvent) => forwardMathAxisTitleClick(plotElement, event);
    plotElement.addEventListener("click", clickHandler, true);
    enableMathAxisTitleEditing(plotElement);

    return () => {
      observer.disconnect();
      plotElement.removeEventListener("click", clickHandler, true);
      if (animationFrame !== null) window.cancelAnimationFrame(animationFrame);
    };
  }, [dimensions.height, dimensions.width]);

  // Clean up the plotly_relayout listener when the component unmounts.
  // The listener itself is registered inside updatePlot after Plotly initialises,
  // so there is exactly one listener per mounted Plot instance.
  useEffect(() => {
    const plotEl = plotRef.current as any;
    return () => {
      if (plotEl && relayoutListenerRef.current && typeof plotEl.off === "function") {
        plotEl.off("plotly_relayout", relayoutListenerRef.current);
        relayoutListenerRef.current = null;
      }
      if (plotEl && clickListenerRef.current && typeof plotEl.off === "function") {
        plotEl.off("plotly_click", clickListenerRef.current);
        clickListenerRef.current = null;
      }
      if (plotEl && hoverListenerRef.current && typeof plotEl.off === "function") {
        plotEl.off("plotly_hover", hoverListenerRef.current);
        hoverListenerRef.current = null;
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
          if (Math.abs(prev.width - newWidth) > 5 || Math.abs(prev.height - newHeight) > 5) {
            return { width: newWidth, height: newHeight };
          }
          return prev;
        });
      }
    };

    // Debounced update function
    let timeoutId: ReturnType<typeof setTimeout>;
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
          className="qimchi-plot"
          style={{
            width: "100%",
            height: "100%",
          }}
        />
      )}
    </div>
  );
});

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
    const styleProps = ["mode", "line", "marker", "opacity", "colorscale", "zmin", "zmax"];
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
      (prevTrace.z !== nextTrace.z && JSON.stringify(prevTrace.z) !== JSON.stringify(nextTrace.z))
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

  // Check callback references so PlotComponent updates its refs when mode changes (LineCut, BGCorr)
  if (prevProps.onHover !== nextProps.onHover || prevProps.onClick !== nextProps.onClick) {
    return false;
  }

  // Don't compare onRelayout callback - it's a function that may be recreated continuously
  // causing unwanted heavy re-renders.
  return true;
};

export default React.memo(PlotComponent, plotPropsAreEqual);

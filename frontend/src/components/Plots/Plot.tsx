import React, { useEffect, useRef, useState, useMemo, useCallback, useDeferredValue } from "react";
import { Layout, Config, Data } from "plotly.js";
import Plotly from "./plotly";

// Local imports
import { engineeringPresentation, unitMetaFromLayout } from "./engineeringTicks";
import { lightTheme, darkTheme, applyThemeToLayout } from "./themes";
import { useThemeStore } from "../../stores/themeStore";
import { releaseHeatmapImages } from "../../utils/heatmapImages";

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
  compact?: boolean;
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

/** Clear MathJax's retained items without removing rendered titles. */
const forgetTypesetMath = (): void => {
  const mathJax = (window as unknown as { MathJax?: { typesetClear?: () => void } }).MathJax;
  try {
    mathJax?.typesetClear?.();
  } catch {
    // Older MathJax versions may not provide typesetClear.
  }
};

// The tick relayouts made below, so the relayout listener can tell them from
// the user's own edits. A new unit prefix renames the axis title, and passing
// that on as a title edit redrew the plot, which reticked it, and so on forever.
const ownRelayouts = new WeakMap<HTMLDivElement, Record<string, unknown>>();

const isOwnRelayout = (node: HTMLDivElement, event: Record<string, unknown>): boolean => {
  const own = ownRelayouts.get(node);
  if (!own) return false;
  const keys = Object.keys(event);
  const same = (key: string) => JSON.stringify(own[key]) === JSON.stringify(event[key]);
  if (keys.length === 0 || !keys.every((key) => key in own && same(key))) return false;
  ownRelayouts.delete(node);
  return true;
};

/** Rebuild engineering ticks for the visible axis ranges. */
const retickForCurrentRange = (node: HTMLDivElement, layout: Partial<Layout>): void => {
  const units = unitMetaFromLayout(layout);
  const fullLayout = (node as unknown as { _fullLayout?: Record<string, AxisWithTicks> })
    ._fullLayout;
  if (!fullLayout) return;

  const update: Record<string, unknown> = {};
  for (const axis of ["x", "y"] as const) {
    const full = fullLayout[`${axis}axis`];
    const range = (full?.range ?? []).map(Number).filter(Number.isFinite);
    if (range.length !== 2) continue;

    // Autorange uses the data extent; zoom uses the visible range.
    const extent = full?.autorange ? drawnExtent(node, axis) : range;
    const presentation = engineeringPresentation(units[axis], extent, 5);
    if (!presentation) continue;
    // Avoid a relayout loop when the ticks already match.
    if (sameTicks(full?.tickvals, presentation.tickvals)) continue;

    update[`${axis}axis.tickvals`] = presentation.tickvals;
    update[`${axis}axis.ticktext`] = presentation.ticktext;
    if (presentation.title !== undefined) {
      update[`${axis}axis.title.text`] = presentation.title;
    }
  }

  // Plotly accepts dotted paths that its Layout type omits.
  if (Object.keys(update).length) {
    ownRelayouts.set(node, update);
    void Plotly.relayout(node, update as Partial<Layout>);
  }
};

type AxisWithTicks = {
  range?: unknown[];
  tickvals?: unknown[];
  ticktext?: unknown[];
  autorange?: boolean;
  title?: { text?: string };
};

/** Return the drawn data extent from Plotly's decoded traces. */
const drawnExtent = (node: HTMLDivElement, axis: "x" | "y"): number[] => {
  const traces =
    (node as unknown as { _fullData?: Record<string, unknown>[] })._fullData ??
    (node as unknown as { data?: Record<string, unknown>[] }).data ??
    [];
  let minimum = Infinity;
  let maximum = -Infinity;
  for (const trace of traces) {
    const values = trace?.[axis];
    if (!values || typeof (values as ArrayLike<number>).length !== "number") continue;
    const list = values as ArrayLike<number>;
    for (let index = 0; index < list.length; index++) {
      const value = Number(list[index]);
      if (!Number.isFinite(value)) continue;
      if (value < minimum) minimum = value;
      if (value > maximum) maximum = value;
    }
  }
  return Number.isFinite(minimum) && Number.isFinite(maximum) ? [minimum, maximum] : [];
};

const sameTicks = (current: unknown[] | undefined, next: number[]): boolean => {
  if (!Array.isArray(current) || current.length !== next.length) return false;
  return next.every((value, index) => {
    const existing = Number(current[index]);
    if (!Number.isFinite(existing)) return false;
    const scale = Math.max(Math.abs(existing), Math.abs(value), Number.MIN_VALUE);
    return Math.abs(existing - value) <= scale * 1e-9;
  });
};

const PlotComponent: React.FC<Props> = React.memo(
  ({ plotJson, onRelayout, onClick, onHover, compact = false }) => {
    // Defer rapid plot updates to avoid flicker.
    const deferredPlotJson = useDeferredValue(plotJson);
    const appTheme = useThemeStore((state) => state.theme);
    const plotTheme = appTheme === "dark" ? darkTheme : lightTheme;

    const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
    const plotRef = useRef<HTMLDivElement>(null);
    const plottedNodeRef = useRef<HTMLDivElement | null>(null);
    const plotContainerRef = useRef<HTMLDivElement>(null);
    const lastPlotStructureRef = useRef<string>("");
    // Let the stable relayout listener read the current layout.
    const layoutBaseRef = useRef<Partial<Layout>>({});
    const dataRevisionRef = useRef<number>(0);
    // Distinguish a size-only update from changed plot data.
    const lastRenderRef = useRef<{
      data: Data[];
      layout: Partial<Layout>;
      config: Partial<Config>;
    } | null>(null);

    // Keep the listener stable while using the latest callback.
    const onRelayoutRef = useRef(onRelayout);
    const relayoutListenerRef = useRef<((event: Plotly.PlotRelayoutEvent) => void) | null>(null);
    onRelayoutRef.current = onRelayout;

    const onClickRef = useRef(onClick);
    onClickRef.current = onClick;
    const clickListenerRef = useRef<((event: Plotly.PlotMouseEvent) => void) | null>(null);

    const onHoverRef = useRef(onHover);
    onHoverRef.current = onHover;
    const hoverListenerRef = useRef<((event: Plotly.PlotMouseEvent) => void) | null>(null);
    const listenersNodeRef = useRef<HTMLDivElement | null>(null);

    const releaseImagesRef = useRef<(() => void) | null>(null);

    // Purge the old Plotly node when a collapsed container removes it.
    const attachPlotNode = useCallback((node: HTMLDivElement | null) => {
      if (node !== plotRef.current) {
        releaseImagesRef.current?.();
        releaseImagesRef.current = node ? releaseHeatmapImages(node) : null;
      }
      const previous = plottedNodeRef.current;
      if (previous && previous !== node) {
        try {
          Plotly.purge(previous);
        } catch (error) {
          console.warn("[Plot] Error purging a replaced plot:", error);
        }
        plottedNodeRef.current = null;
      }
      plotRef.current = node;
    }, []);

    // Wait for a measurable container before drawing.
    const plotDrawn = dimensions.width > 0 && dimensions.height > 0;

    // Hash the fields that require a full redraw when they change.
    const plotStructureHash = useMemo(() => {
      return JSON.stringify({
        dataLength: deferredPlotJson.data?.length || 0,
        traceTypes: deferredPlotJson.data?.map((d) => d.type) || [],
        layoutKeys: Object.keys(deferredPlotJson.layout || {}).sort(),
        hasConfig: !!deferredPlotJson.config,
      });
    }, [deferredPlotJson.data, deferredPlotJson.layout, deferredPlotJson.config]);

    const structureChanged = plotStructureHash !== lastPlotStructureRef.current;

    // Keep dimensions separate so resizing can use relayout.
    const layoutBase: Partial<Layout> = useMemo(() => {
      const themedLayout = applyThemeToLayout(deferredPlotJson.layout, plotTheme);
      return {
        ...themedLayout,
        autosize: true,
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
          // The Appearance grid toggle sets this; figures without one stay gridless.
          showgrid: themedLayout.xaxis?.showgrid ?? false,
          // Match the minor-grid default to the major grid.
          minor: {
            ...themedLayout.xaxis?.minor,
            showgrid: themedLayout.xaxis?.minor?.showgrid ?? themedLayout.xaxis?.showgrid ?? false,
          },
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
          // The Appearance grid toggle sets this; figures without one stay gridless.
          showgrid: themedLayout.yaxis?.showgrid ?? false,
          // Match the minor-grid default to the major grid.
          minor: {
            ...themedLayout.yaxis?.minor,
            showgrid: themedLayout.yaxis?.minor?.showgrid ?? themedLayout.yaxis?.showgrid ?? false,
          },
          linecolor: plotTheme.colors.text,
        },
      };
    }, [deferredPlotJson.layout, plotTheme]);

    layoutBaseRef.current = layoutBase;

    const enhancedLayout: Partial<Layout> = useMemo(
      () => ({
        ...layoutBase,
        width: dimensions.width || undefined,
        height: dimensions.height || undefined,
      }),
      [layoutBase, dimensions.width, dimensions.height],
    );

    const enhancedConfig: Partial<Config> = useMemo(
      () => ({
        editable: true,
        edits: {
          annotationTail: true,
          annotationText: true,
          annotationPosition: true,
          axisTitleText: true,
          // Heatmap colorbar titles use the MathJax annotation. Enabling the
          // empty native title exposes Plotly's placeholder behind it. The
          // layout coloraxis placeholder is hidden in PlotWrapper.css.
          colorbarTitleText: false,
          colorbarPosition: true,
          titleText: false,
        },
        responsive: true,
        displaylogo: false,
        displayModeBar: "hover",
        modeBarButtonsToAdd: [],
        // Omit dimensions to export at the current plot size.
        toImageButtonOptions: {
          format: "svg" as const,
          filename: "plot",
          scale: 2,
        },
        ...deferredPlotJson.config,
        // Fit equations and derivative labels are supplied as TeX by the
        // backend. Keep Plotly's own SVG MathJax conversion enabled even when
        // an older saved plot config did not know about this setting.
        typesetMath: true,
        // Disable Plotly's default upload-to-Chart-Studio action.
        showSendToCloud: false,
      }),
      [deferredPlotJson.config],
    );

    const updatePlot = useCallback(async () => {
      // Capture the target because the component may unmount while awaiting Plotly or MathJax.
      const node = plotRef.current;
      if (!node || dimensions.width === 0 || dimensions.height === 0) {
        return;
      }

      try {
        // A size-only update can reuse the existing traces.
        const rendered = lastRenderRef.current;
        const sizeOnly =
          plottedNodeRef.current === node &&
          !structureChanged &&
          rendered !== null &&
          rendered.data === deferredPlotJson.data &&
          rendered.layout === layoutBase &&
          rendered.config === enhancedConfig;

        if (sizeOnly) {
          await Plotly.relayout(node, {
            width: dimensions.width,
            height: dimensions.height,
          });
          retickForCurrentRange(node, layoutBase);
          forgetTypesetMath();
          return true;
        }

        if (structureChanged) {
          lastPlotStructureRef.current = plotStructureHash;
          dataRevisionRef.current = 0; // Reset data revision for new structure
        }

        // Wait for MathJax's tex-svg component before the first render.
        const mathJax = (window as any).MathJax;
        if (mathJax?.startup?.promise) {
          await mathJax.startup.promise;
        }
        if (plotRef.current !== node) return false;

        // Bump datarevision only when trace data changed.
        const layoutToRender = { ...enhancedLayout };
        if (
          !structureChanged &&
          lastPlotStructureRef.current &&
          rendered?.data !== deferredPlotJson.data
        ) {
          dataRevisionRef.current += 1;
          layoutToRender.datarevision = dataRevisionRef.current;
        }

        await Plotly.react(node, deferredPlotJson.data, layoutToRender, enhancedConfig);
        if (plotRef.current !== node) return false;
        plottedNodeRef.current = node;
        retickForCurrentRange(node, layoutBase);
        forgetTypesetMath();
        lastRenderRef.current = {
          data: deferredPlotJson.data,
          layout: layoutBase,
          config: enhancedConfig,
        };
        enableMathAxisTitleEditing(node);

        // Register interactions before optional MathJax work, which may stall.
        // A replacement node needs a fresh set of listeners.
        if (listenersNodeRef.current !== node) {
          relayoutListenerRef.current = null;
          clickListenerRef.current = null;
          hoverListenerRef.current = null;
          listenersNodeRef.current = node;
        }
        if (!relayoutListenerRef.current) {
          const plotEl = node as any;
          if (typeof plotEl.on === "function") {
            const handler = (event: Plotly.PlotRelayoutEvent) => {
              const node = plottedNodeRef.current;
              if (node && isOwnRelayout(node, event as Record<string, unknown>)) return;
              if (node) retickForCurrentRange(node, layoutBaseRef.current);
              onRelayoutRef.current?.(event as Record<string, unknown>);
            };
            relayoutListenerRef.current = handler;
            plotEl.on("plotly_relayout", handler);
          }
        }

        if (!clickListenerRef.current) {
          const plotEl = node as any;
          if (typeof plotEl.on === "function") {
            const handler = (event: Plotly.PlotMouseEvent) => {
              onClickRef.current?.(event);
            };
            clickListenerRef.current = handler;
            plotEl.on("plotly_click", handler);
          }
        }

        if (!hoverListenerRef.current) {
          const plotEl = node as any;
          if (typeof plotEl.on === "function") {
            const handler = (event: Plotly.PlotMouseEvent) => {
              onHoverRef.current?.(event);
            };
            hoverListenerRef.current = handler;
            plotEl.on("plotly_hover", handler);
          }
        }

        // Typeset labels and annotations inserted during this update.
        if (typeof mathJax?.typesetPromise === "function") {
          try {
            await mathJax.typesetPromise([node]);
          } catch (error) {
            // Plotly's own math is already rendered; this optional pass may fail safely.
            console.warn("[Plot] Additional MathJax typeset failed", error);
          }
        } else {
          console.warn("[Plot] MathJax tex-svg component is not available");
        }

        if (plotRef.current !== node) return false;
        enableMathAxisTitleEditing(node);
        return true;
      } catch (error) {
        console.error("[Plot] Error updating plot:", error);
        return false;
      }
    }, [
      deferredPlotJson.data,
      layoutBase,
      enhancedLayout,
      enhancedConfig,
      dimensions.width,
      dimensions.height,
      structureChanged,
      plotStructureHash,
    ]);

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
    }, [plotDrawn]);

    // The listener is registered after Plotly initializes and removed on unmount.
    useEffect(() => {
      return () => {
        const plotEl = plottedNodeRef.current as any;
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
      // Defer off-screen resizes until the plot becomes visible.
      let visible = true;
      let resizePending = false;
      let hasMeasured = false;

      const updateDimensions = () => {
        if (!plotContainerRef.current) return;
        if (!visible && hasMeasured) {
          resizePending = true;
          return;
        }
        resizePending = false;
        hasMeasured = true;

        const { offsetWidth, offsetHeight } = plotContainerRef.current;
        const newWidth = offsetWidth;
        const newHeight = compact ? Math.max(120, offsetHeight) : Math.max(250, offsetHeight - 20);

        // Ignore subpixel layout noise.
        setDimensions((prev) => {
          if (Math.abs(prev.width - newWidth) > 5 || Math.abs(prev.height - newHeight) > 5) {
            return { width: newWidth, height: newHeight };
          }
          return prev;
        });
      };

      let timeoutId: ReturnType<typeof setTimeout>;
      const debouncedUpdate = () => {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(updateDimensions, 150);
      };

      // Resize shortly before the plot enters the viewport.
      const visibilityObserver = new IntersectionObserver(
        (entries) => {
          visible = entries.some((entry) => entry.isIntersecting);
          if (visible && resizePending) updateDimensions();
        },
        { rootMargin: "400px" },
      );
      if (plotContainerRef.current) visibilityObserver.observe(plotContainerRef.current);

      const timer = setTimeout(updateDimensions, 100);

      const resizeObserver = new ResizeObserver(() => {
        debouncedUpdate();
      });

      if (plotContainerRef.current) {
        resizeObserver.observe(plotContainerRef.current);
      }

      // ResizeObserver can miss browser-level layout changes.
      window.addEventListener("resize", debouncedUpdate);

      return () => {
        clearTimeout(timer);
        clearTimeout(timeoutId);
        window.removeEventListener("resize", debouncedUpdate);
        resizeObserver.disconnect();
        visibilityObserver.disconnect();
      };
    }, [compact]);

    // Purge on unmount. Without it Plotly's drag handlers and the trace data
    // stay reachable from detached SVG nodes, so a closed plot keeps its memory.
    useEffect(
      () => () => {
        const plotted = plottedNodeRef.current;
        plottedNodeRef.current = null;
        if (!plotted) return;
        try {
          Plotly.purge(plotted);
        } catch (error) {
          console.warn("[Plot] Error purging plot on unmount:", error);
        }
      },
      [],
    );

    return (
      <div ref={plotContainerRef} className={`w-full h-full ${compact ? "" : "min-h-[400px]"}`}>
        {plotDrawn && (
          <div
            ref={attachPlotNode}
            className="qimchi-plot"
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
  // Re-render when interaction callbacks change even if the figure is unchanged.
  if (prevProps.onHover !== nextProps.onHover || prevProps.onClick !== nextProps.onClick) {
    return false;
  }

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

  // Don't compare onRelayout callback - it's a function that may be recreated continuously
  // causing unwanted heavy re-renders.
  return true;
};

export default React.memo(PlotComponent, plotPropsAreEqual);

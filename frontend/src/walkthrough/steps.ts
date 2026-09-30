import type { Side } from "driver.js";

import type { BasketItem } from "../components/Basket";
import type { PlotConfiguration } from "../components/interfaces";
import {
  prepareDemo,
  startLiveDemo,
  stopLiveDemo,
  type DemoFiles,
  type LiveDemo,
} from "../services/demoAPI";
import { usePlotStore } from "../stores/plotStore";
import { useSidebarStore } from "../stores/sidebarStore";
import { detectDatasetKind } from "../utils/datasetPaths";
import { samePath, useWalkthroughStore, type WalkthroughBridge } from "./walkthroughStore";

export interface StepContext {
  demo: DemoFiles | null;
  live: LiveDemo | null;
  bridge: Partial<WalkthroughBridge>;
  setDemo: (demo: DemoFiles) => void;
  setLive: (live: LiveDemo | null) => void;
  previousExplorer: { path: string; submittedPath: string } | null;
  setPreviousExplorer: (location: { path: string; submittedPath: string }) => void;
}

export interface WalkthroughStep {
  id: string;
  title: string;
  /** Trusted HTML generated from static copy and escaped paths. */
  body: (ctx: StepContext) => string;
  /** Element to highlight; null centers the card. */
  target?: (ctx: StepContext) => Element | null;
  side?: Side;
  /** Use the wide card layout. */
  wide?: boolean;
  /** Runs when the step opens. */
  enter?: (ctx: StepContext) => void | Promise<void>;
  /** Completion condition used for automatic advancement. */
  done?: (ctx: StepContext) => boolean;
  /** Undo the step when reached through backward navigation. */
  back?: (ctx: StepContext) => void;
  /** Restore required state during each polling cycle. */
  repair?: (ctx: StepContext) => void;
  /** Optional automatic action for the step. */
  action?: { label: string; run: (ctx: StepContext) => void | Promise<void> };
  /** Label for the Next button; "action" makes Next run the action first. */
  next?: string | "action";
}

const LOGO_NAME = "qimchi_logo.nc";
const REVEAL_NAME = "measurement2.nc";
const QANARY_URL = "https://gitlab.com/squad-lab/qanary";
const CONNECT_URL = "https://gitlab.com/squad-lab/qimchi-connect";

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Render an instructional aside. */
const tip = (title: string, body: string) =>
  `<div class="qimchi-walkthrough-tip"><div class="qimchi-walkthrough-tip-title">${title}</div>${body}</div>`;

const datasetItem = (path: string, name: string): BasketItem => ({
  id: path,
  name,
  path,
  type: "file",
  tags: [detectDatasetKind(path)],
});

const plotsOf = (
  ctx: StepContext,
  path: string | undefined,
  type: PlotConfiguration["plotType"],
) =>
  path
    ? (ctx.bridge.plots?.() ?? []).filter((p) => p.plotType === type && samePath(p.fpath, path))
    : [];

// Return only fully rendered plot tiles so the target bounds are stable.
const plotTile = (plot: PlotConfiguration | undefined) => {
  const tile = plot ? document.querySelector(`[data-plot-id="${CSS.escape(plot.id)}"]`) : null;
  return tile?.querySelector(".js-plotly-plot .main-svg") ? tile : null;
};

// Panels are appended in opening order.
const lastOf = (selector: string) => {
  const all = document.querySelectorAll(selector);
  return all.length ? all[all.length - 1] : null;
};

const plotAction = (plot: PlotConfiguration | undefined, action: string) => {
  if (!plot) return;
  window.dispatchEvent(
    new CustomEvent("plot-shortcut-action", { detail: { id: plot.id, action } }),
  );
};

// Retry until the plot registers its shortcut listener and opens the panel.
const openPanel = async (
  plot: PlotConfiguration | undefined,
  action: "open-filters" | "open-appearance",
) => {
  const panel = action === "open-filters" ? "filters-panel" : "appearance-panel";
  for (let attempt = 0; attempt < 20; attempt += 1) {
    plotAction(plot, action);
    await new Promise((resolve) => window.setTimeout(resolve, 250));
    if (document.querySelector(`[data-tour="${panel}"]`)) return;
  }
};

const closePlotPanels = () => {
  window.dispatchEvent(new CustomEvent("qimchi:close-plot-panels"));
};

const logoHeatmap = (ctx: StepContext) => plotsOf(ctx, ctx.demo?.logo, "HeatMap")[0];
const logoLinePlot = (ctx: StepContext) => plotsOf(ctx, ctx.demo?.logo, "LinePlot")[0];
const revealHeatmap = (ctx: StepContext) => plotsOf(ctx, ctx.demo?.reveal, "HeatMap")[0];

const basketItemFor = (ctx: StepContext, path: string | undefined) =>
  path ? (ctx.bridge.basketItems?.() ?? []).find((item) => samePath(item.path, path)) : undefined;

const inBasket = (ctx: StepContext, path: string | undefined) => !!basketItemFor(ctx, path);

// Default heat-map fields for each demo measurement.
const DEMO_HEATMAPS = {
  logo: { indeps: ["P2", "P1"], deps: ["signal"] },
  reveal: { indeps: ["y", "x"], deps: ["brightness"] },
};

const addHeatmap = (ctx: StepContext, path: string, which: keyof typeof DEMO_HEATMAPS) =>
  ctx.bridge.addPlot?.({
    origin: "auto",
    fpath: path,
    ...DEMO_HEATMAPS[which],
    plotType: "HeatMap",
    source: "disk",
    preferredSource: "disk",
  });

/** Add a missing demo measurement or restore its missing default heat map. */
const showDemo = (ctx: StepContext, which: keyof typeof DEMO_HEATMAPS, name: string) => {
  const path = ctx.demo?.[which];
  if (!path) return;
  if (!inBasket(ctx, path)) {
    ctx.bridge.addToBasket?.(datasetItem(path, name));
  } else if (plotsOf(ctx, path, "HeatMap").length === 0) {
    addHeatmap(ctx, path, which);
  }
};

// Restore a removed default heat map after its variables load. The delay lets
// Viewer create its own default first and prevents duplicate plots.
const missingSince: Partial<Record<keyof typeof DEMO_HEATMAPS, number>> = {};
const keepHeatmap = (ctx: StepContext, which: keyof typeof DEMO_HEATMAPS) => {
  const path = ctx.demo?.[which];
  const missing =
    !!basketItemFor(ctx, path)?.attributes && plotsOf(ctx, path, "HeatMap").length === 0;
  if (!path || !missing) {
    delete missingSince[which];
    return;
  }
  missingSince[which] ??= Date.now();
  if (Date.now() - missingSince[which] > 1000) {
    delete missingSince[which];
    addHeatmap(ctx, path, which);
  }
};

/** Removes a measurement's plots, and the measurement itself unless only plots are wanted. */
const removeMeasurement = (
  ctx: StepContext,
  path: string | undefined,
  {
    plotType,
    keepInBasket = false,
  }: { plotType?: PlotConfiguration["plotType"]; keepInBasket?: boolean } = {},
) => {
  if (!path) return;
  for (const plot of ctx.bridge.plots?.() ?? []) {
    if (samePath(plot.fpath, path) && (!plotType || plot.plotType === plotType)) {
      ctx.bridge.removePlot?.(plot.id);
    }
  }
  if (keepInBasket) return;
  for (const item of ctx.bridge.basketItems?.() ?? []) {
    if (samePath(item.path, path)) ctx.bridge.removeFromBasket?.(item.id);
  }
};

// Snapshot plots removed by "Show me" for restoration on backward navigation.
let plotsBeforeQabbage: Omit<PlotConfiguration, "id">[] = [];

const plotState = (plot: PlotConfiguration | undefined) =>
  plot ? usePlotStore.getState().getPlotState(plot.id) : undefined;

const openExplorerAt = (folder: string) => {
  const sidebar = useSidebarStore.getState();
  sidebar.setSidebarCollapsed(false);
  sidebar.setActiveSection("explorer");
  sidebar.updateExplorerState({ path: folder, submittedPath: folder });
};

// Folder selection is available only through the desktop bridge.
const ownDataTip = () =>
  window.pywebview?.api?.open_folder_dialog
    ? "<p>Later, type your own folder into the path box at the top, or click the green folder button beside it to choose one.</p>"
    : "<p>Later, type your own folder into the path box at the top.</p>";

export const WALKTHROUGH_STEPS: WalkthroughStep[] = [
  {
    id: "welcome",
    title: "Welcome to Qimchi",
    body: (ctx) => {
      const busy =
        (ctx.bridge.basketItems?.().length ?? 0) > 0 || (ctx.bridge.plots?.().length ?? 0) > 0;
      return `
        <p>This walkthrough shows you around Qimchi with two demo measurements. It takes about
        five minutes.</p>
        <p>You'll plot a heat map and a line plot, try a filter, and change how a plot looks.
        Then you'll watch a measurement being plotted while it runs.</p>
        ${
          busy
            ? `<p class="qimchi-walkthrough-note"><strong>Heads up:</strong> the walkthrough starts
               with an empty Basket and Viewer, so it will clear yours. Your files are not
               touched.</p>`
            : ""
        }
        <p>You can leave at any time with the &times; in the corner. You can also come back
        later from Help.</p>`;
    },
    next: "action",
    action: {
      label: "Let's go",
      run: async (ctx) => {
        const demo = await prepareDemo();
        const { path, submittedPath } = useSidebarStore.getState().componentStates.explorer;
        ctx.setPreviousExplorer({ path, submittedPath });
        ctx.setDemo(demo);
        ctx.bridge.clearPlots?.();
        ctx.bridge.clearBasket?.();
        openExplorerAt(demo.folder);
      },
    },
  },
  {
    id: "explorer",
    title: "The Explorer",
    target: () => document.querySelector('[data-tour="sidebar"]'),
    side: "right",
    enter: (ctx) => {
      if (ctx.demo) openExplorerAt(ctx.demo.folder);
    },
    body: (ctx) => `
      <p>The Explorer lists the measurements in a folder. We've opened the demo folder:</p>
      <p class="qimchi-walkthrough-path">${escapeHtml(ctx.demo?.folder ?? "")}</p>
      <p>Open <strong>demo</strong> with the arrow beside it. Then double-click
      <strong>${LOGO_NAME}</strong> to add it to the Basket.</p>
      ${tip("Your own data", ownDataTip())}`,
    done: (ctx) => inBasket(ctx, ctx.demo?.logo),
    back: (ctx) => removeMeasurement(ctx, ctx.demo?.logo),
  },
  {
    id: "first-plot",
    title: "Your first plot",
    target: (ctx) => plotTile(logoHeatmap(ctx)),
    side: "left",
    repair: (ctx) => keepHeatmap(ctx, "logo"),
    body: () => `
      <p>The measurement is now in the Basket, at the top of the Viewer.</p>
      <p>The Viewer was empty, so Qimchi drew a plot for you. It saw a signal swept over two
      gates and chose a heat map. Look familiar?</p>
      <p>Hover over the plot to read values. Drag across it to zoom in, and double-click to zoom
      out.</p>`,
  },
  {
    id: "open-filters",
    title: "Filters",
    target: (ctx) => plotTile(logoHeatmap(ctx)),
    side: "left",
    body: () => `
      <p>Hover over the plot. A column of tools appears on its right.</p>
      <p>Click the Swiss knife to open the <strong>Filters</strong> menu.</p>`,
    done: () => lastOf('[data-tour="filters-panel"]') !== null,
    back: closePlotPanels,
  },
  {
    id: "use-filters",
    title: "Try a filter",
    target: () => lastOf('[data-tour="filters-panel"]'),
    side: "left",
    body: () => `
      <p>Choose <strong>Diff along Y</strong> from the list, then tick <strong>Apply</strong>.</p>
      <p>You should see the outline of the logo.</p>
      ${tip(
        "Stacking filters",
        "<p>Filters run in the order you apply them, and you can stack as many as you like. To change the order, open <strong>Applied</strong> and drag them around.</p>",
      )}`,
    back: (ctx) => {
      plotAction(logoHeatmap(ctx), "reset-plot");
      void openPanel(logoHeatmap(ctx), "open-filters");
    },
    done: (ctx) =>
      (plotState(logoHeatmap(ctx))?.applied_filters ?? []).some((filter) =>
        filter.name.startsWith("diff"),
      ),
  },
  {
    id: "open-appearance",
    title: "Appearance",
    enter: closePlotPanels,
    target: (ctx) => plotTile(logoHeatmap(ctx)),
    side: "left",
    body: () => `
      <p>Just above the Swiss knife is a palette. It opens <strong>Appearance</strong>, where you
      change how this plot looks.</p>
      <p>Give it a click.</p>`,
    done: () => lastOf('[data-tour="appearance-panel"]') !== null,
    back: closePlotPanels,
  },
  {
    id: "use-appearance",
    title: "Make it yours",
    target: () => lastOf('[data-tour="appearance-panel"]'),
    side: "right",
    body: () => `
      <p>Pick another colour scale, such as Balance or Cividis. Hover over one to preview it.</p>
      <p>You can also flip <strong>Reverse</strong>, or try the X-Axis and Y-Axis tabs.</p>
      ${tip(
        "This plot only",
        "<p>Changes here apply to this plot. To change the defaults for every plot, use Settings, the gear on the left.</p>",
      )}`,
    back: (ctx) => void openPanel(logoHeatmap(ctx), "open-appearance"),
    done: (ctx) => Object.keys(plotState(logoHeatmap(ctx))?.appearance_overrides ?? {}).length > 0,
  },
  {
    id: "line-plot",
    title: "Build a line plot",
    enter: closePlotPanels,
    // Highlight their shared Viewer container so both controls remain interactive.
    target: () => document.querySelector('[data-tour="viewer"]'),
    side: "left",
    body: () => `
      <p>The Composer, below the Basket, builds plots from a measurement's variables.</p>
      <p>On the measurement's card, double-click the blue <strong>P1 (or P2)</strong> chip. Then
      double-click the red <strong>signal</strong> chip. They fill the X and Y axes.</p>
      <p>Set the Composer to <strong>LinePlot</strong> (press L). Then click the play button, or
      press P.</p>`,
    done: (ctx) => logoLinePlot(ctx) !== undefined,
    back: (ctx) => {
      ctx.bridge.clearComposer?.();
      removeMeasurement(ctx, ctx.demo?.logo, { plotType: "LinePlot", keepInBasket: true });
    },
  },
  {
    id: "line-result",
    title: "One slice at a time",
    target: (ctx) => plotTile(logoLinePlot(ctx)),
    side: "left",
    body: () => `
      <p>A line plot has one axis to spare, but this measurement was swept over two gates.</p>
      <p>So, Qimchi shows one value of P2 (or P1) at a time. Step through the rest with the P2 (or P1) slider,
      under <strong>Sliders</strong> in the Filters menu.</p>
      ${tip("Extra dimensions", "<p>Qimchi does this for any extra dimension.</p>")}`,
  },
  {
    id: "live-start",
    title: "Live plotting",
    enter: () => closePlotPanels(),
    target: () => document.querySelector('button[aria-label="Live Measurements"]'),
    back: (ctx) => {
      if (!ctx.live) return;
      void stopLiveDemo().catch(() => {});
      removeMeasurement(ctx, ctx.live.path);
      ctx.setLive(null);
      useSidebarStore.getState().setActiveSection("explorer");
    },
    side: "right",
    body: () => `
      <p>Qimchi can plot a measurement while it is still running. Running measurements appear
      under <strong>Live Measurements</strong>.</p>
      <p>Let's start one. The demo measures the logo again, one row at a time. It sends the data
      the same way your own measurement code would.</p>`,
    next: "action",
    action: {
      label: "Start the measurement",
      run: async (ctx) => {
        // Disable custom-plot recreation so only the default heat map follows the live data.
        useWalkthroughStore.getState().onlyRecreateDefaultPlots();
        const live = await startLiveDemo();
        ctx.setLive(live);
        useSidebarStore.getState().setActiveSection("live");
        ctx.bridge.addToBasket?.({
          id: live.nodeId,
          name: live.name,
          path: live.path,
          type: "file",
          tags: ["live"],
        });
      },
    },
  },
  {
    id: "live-watch",
    title: "Watch it fill in",
    target: () => document.querySelector('[data-tour="plots"]'),
    side: "left",
    body: () => `
      <p>You didn't have to build this heat map again. When you add a measurement, Qimchi
      recreates the Viewer's plots for it, <strong>filters included</strong>.</p>
      ${tip(
        "Your own plots",
        `<p>Plots you build yourself can be recreated too. That's <strong>Recreate custom
        plots</strong> in Settings. We've switched it off for this demo, and will switch it back
        when you finish.</p>`,
      )}
      ${tip(
        "When it ends",
        "<p>Live plots refresh as new points arrive. When the measurement ends, Qimchi reads it from disk instead.</p>",
      )}`,
  },
  {
    id: "your-code",
    title: "Plot your own measurements live",
    wide: true,
    body: () => `
      <p>Your own measurement code can send data to Qimchi while it runs, just like the demo.</p>
      ${tip(
        "Libraries that send live data",
        `<ul>
          <li><a href="${QANARY_URL}" target="_blank" rel="noreferrer">qanary</a> runs sweeps and
          measurements, and publishes them for you.</li>
          <li><a href="${CONNECT_URL}" target="_blank" rel="noreferrer">qimchi-connect</a> works
          with any measurement code. It has ready-made support for QCoDeS and Quantify.</li>
        </ul>`,
      )}
      <p>With qimchi-connect, a few lines are enough:</p>
      <pre class="qimchi-walkthrough-code">from qimchi_connect import live_measurement

with live_measurement(
    measurement_id="my-sweep",
    snapshot=lambda: dataset.copy(deep=True),
    disk_path="data/my-sweep.nc",
):
    run_my_sweep()</pre>`,
  },
  {
    id: "qabbage-intro",
    title: "One more thing",
    back: (ctx) => {
      closePlotPanels();
      removeMeasurement(ctx, ctx.demo?.reveal);
      // `addPlot` prepends, so restore the snapshot in reverse order.
      for (const plot of [...plotsBeforeQabbage].reverse()) ctx.bridge.addPlot?.(plot);
      plotsBeforeQabbage = [];
    },
    body: () => `
      <p>There's a second measurement in the demo folder. It's a bit of fun, and it shows off
      sliders.</p>
      <p>We'll clear the Viewer to make room for it.</p>`,
    next: "action",
    action: {
      label: "Show me",
      run: (ctx) => {
        closePlotPanels();
        // Include filters from the plot store in the snapshot.
        plotsBeforeQabbage = (ctx.bridge.plots?.() ?? []).map((plot) => {
          const filters = plotState(plot)?.applied_filters ?? [];
          return {
            ...plot,
            filters_order: filters.map((filter) => filter.name),
            filters_opts: Object.fromEntries(
              filters.map((filter) => [filter.name, filter.options ?? {}]),
            ),
          };
        });
        ctx.bridge.clearPlots?.();
        showDemo(ctx, "reveal", REVEAL_NAME);
      },
    },
  },
  {
    id: "qabbage-open",
    title: "Who's that Poqémon?",
    target: (ctx) => plotTile(revealHeatmap(ctx)),
    side: "right",
    repair: (ctx) => keepHeatmap(ctx, "reveal"),
    body: () => `
      <p>Someone is hiding in this plot.</p>
      <p>Open its <strong>Filters</strong> menu, with the Swiss knife, to find out who.</p>`,
    done: () => lastOf('[data-tour="filters-panel"]') !== null,
    back: closePlotPanels,
  },
  {
    id: "qabbage-reveal",
    title: "Who's that Poqémon?",
    target: () => lastOf('[data-tour="filters-panel"]'),
    side: "left",
    body: () => `
      <p>This measurement has a third dimension, <strong>reveal</strong>, that the heat map
      doesn't use.</p>
      <p>Open <strong>Sliders</strong> at the top of the list. Then move the reveal slider all the
      way to the right.</p>`,
    back: (ctx) => {
      plotAction(revealHeatmap(ctx), "reset-plot");
      void openPanel(revealHeatmap(ctx), "open-filters");
    },
    done: (ctx) => (plotState(revealHeatmap(ctx))?.slider_settings?.reveal?.value ?? 0) >= 1,
  },
  {
    id: "finish",
    title: "It's Qabbage!",
    enter: closePlotPanels,
    target: (ctx) => plotTile(revealHeatmap(ctx)),
    side: "right",
    body: (ctx) => `
      <p>That's the end of the tour. Thanks for sticking with it!</p>
      ${tip(
        "There's plenty more to find",
        `<ul>
          <li>Linecuts through heat maps</li>
          <li>Notes on every measurement</li>
          <li>Exporting plots as images</li>
          <li>Custom tags and hearts for your measurements</li>
          <li>Keyboard shortcuts for most things</li>
        </ul>`,
      )}
      <p><strong>Help</strong> (Shift+H) covers all of it. You can take this walkthrough again
      from there.</p>
      <p>The demo measurements stay in
      <span class="qimchi-walkthrough-path">${escapeHtml(ctx.demo?.folder ?? "")}</span>
      if you want to play with them later.</p>`,
    next: "action",
    action: {
      label: "Finish",
      run: (ctx) => {
        const qabbage = revealHeatmap(ctx);
        ctx.bridge.clearComposer?.();
        for (const plot of ctx.bridge.plots?.() ?? []) {
          if (plot.id !== qabbage?.id) ctx.bridge.removePlot?.(plot.id);
        }
        for (const item of ctx.bridge.basketItems?.() ?? []) {
          if (!ctx.demo || !samePath(item.path, ctx.demo.reveal)) {
            ctx.bridge.removeFromBasket?.(item.id);
          }
        }
        useSidebarStore.getState().setActiveSection("explorer");
      },
    },
  },
];

/** Remove walkthrough data and restore the previous Explorer location. */
/** Keeps the second demo measurement a surprise until the tour gets to it. */
export const isHeldBackByWalkthrough = (path: string): boolean => {
  const { active, demo, stepIndex } = useWalkthroughStore.getState();
  if (!active || !demo || !samePath(path, demo.reveal)) return false;
  return stepIndex < WALKTHROUGH_STEPS.findIndex((step) => step.id === "qabbage-intro");
};

export const putThingsBack = (ctx: StepContext) => {
  const added = [ctx.demo?.logo, ctx.demo?.reveal, ctx.live?.path].filter(
    (path): path is string => !!path,
  );
  const isDemo = (path: string) => added.some((demoPath) => samePath(path, demoPath));

  closePlotPanels();
  ctx.bridge.clearComposer?.();
  for (const plot of ctx.bridge.plots?.() ?? []) {
    if (isDemo(plot.fpath)) ctx.bridge.removePlot?.(plot.id);
  }
  for (const item of ctx.bridge.basketItems?.() ?? []) {
    if (isDemo(item.path)) ctx.bridge.removeFromBasket?.(item.id);
  }
  if (ctx.live) void stopLiveDemo().catch(() => {});

  const sidebar = useSidebarStore.getState();
  sidebar.setActiveSection("explorer");
  sidebar.updateExplorerState(ctx.previousExplorer ?? { path: "", submittedPath: "" });
};

export const closingCard = (ctx: StepContext) => ({
  title: "Before you go",
  body: `
    <p>Would you like to put things back the way they were? This removes the demo measurements
    from the Basket and the Viewer, and ${
      ctx.previousExplorer?.submittedPath
        ? "takes the Explorer back to the folder you had open"
        : "clears the demo folder from the Explorer"
    }.</p>
    <p>The demo files stay on disk, so you can come back to them any time.</p>`,
});

import axios from "axios";
import { PROD_BACKEND_URL } from "../config";
import { useState, useEffect, useRef } from "react";
import { Panel } from "react-resizable-panels";
import { ChartScatter, Lightbulb } from "lucide-react";

// Local imports
import Basket, { BasketItem } from "./Basket";
import { TreeNode } from "./DirTree";
import { AttrData } from "./interfaces";
import PlotComposer, { PlotComposerConfig } from "./PlotComposer";
import PlotContainer from "./PlotContainer";
import { usePlotCollection } from "../hooks/usePlotCollection";
import { usePlotStore } from "../stores/plotStore";
import { useToast } from "../hooks/useToast";
import Tooltip from "./Tooltip";
import { generateAutoPlotConfigs } from "../utils/autoPlot";

interface ViewerProps {
  defaultWidth?: number; // In percentage (0-100)
  onSelectNode: (node: TreeNode) => void;
  basketItems: BasketItem[];
  onRemoveBasketItem: (id: string) => void;
  onClearBasket: () => void;
  onAddToBasket: (item: BasketItem) => void;
  selectedNode?: TreeNode | null;
  loadingAttributes: Set<string>;
  onStartLoadingAttributes: (itemId: string) => void;
  onUpdateBasketItemAttributes: (itemId: string, attributes: AttrData) => void;
  // live dataset toggling removed
}

const Viewer = ({
  defaultWidth = 80,
  basketItems,
  onRemoveBasketItem,
  onClearBasket,
  onAddToBasket,
  loadingAttributes,
  onStartLoadingAttributes,
  onUpdateBasketItemAttributes,
}: ViewerProps) => {
  const { plotConfigs, addPlot, removePlot, clearPlots, updatePlotDataSource } =
    usePlotCollection();
  const { getPlotState } = usePlotStore();
  const { showToast } = useToast();
  // Global default percent and per-plot overrides
  const [plotWidthPercent, setPlotWidthPercent] = useState<number>(50);
  const [perPlotWidthMap, setPerPlotWidthMap] = useState<
    Record<string, number>
  >({});
  // Global squarify toggle affecting all plots
  const [isSquareModeGlobal, setIsSquareModeGlobal] = useState<boolean>(false);
  const [viewerHeight, setViewerHeight] = useState<string>(
    "calc(100vh - 200px)",
  );

  const basketRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const previousBasketItems = useRef<BasketItem[]>([]);
  const processedAutoPlotItems = useRef<Set<string>>(new Set());

  // Monitor basket changes for dataset cycling
  useEffect(() => {
    const zarrItems = basketItems.filter(
      (item) => item.type === "file" && item.path.endsWith(".zarr"),
    );
    const prevZarrItems = previousBasketItems.current.filter(
      (item) => item.type === "file" && item.path.endsWith(".zarr"),
    );

    const buildMemoryPath = (item: BasketItem): string | null => {
      const baseName = item.name?.endsWith(".zarr")
        ? item.name.slice(0, -5)
        : item.name;
      if (!baseName) {
        return null;
      }
      return `memory://${baseName}`;
    };

    let nextPreviousItems: BasketItem[] = basketItems;

    // Check if we have exactly one zarr item and it's different from before
    if (
      zarrItems.length === 1 &&
      prevZarrItems.length === 1 &&
      zarrItems[0].path !== prevZarrItems[0].path &&
      plotConfigs.length > 0
    ) {
      // This indicates a dataset cycle - update all plot data sources
      const prevItem = prevZarrItems[0];
      const newItem = zarrItems[0];

      let preferredPath = newItem.path;

      const newIsMemory = preferredPath.startsWith("memory://");
      const prevIsMemory = prevItem.path.startsWith("memory://");
      const sameDataset = prevItem.name === newItem.name;
      const isLiveDataset = newItem.tags?.includes("live");
      const isDiskFallback = newItem.tags?.includes("disk-fallback");

      if (!newIsMemory) {
        if (sameDataset && prevIsMemory) {
          // Preserve the memory path we were already using for the same dataset
          preferredPath = prevItem.path;
        } else if (isLiveDataset && !isDiskFallback) {
          // Prefer the memory URI when the basket item represents a live dataset with an in-memory store
          const memoryPath = buildMemoryPath(newItem);
          if (memoryPath) {
            preferredPath = memoryPath;
          }
        }
      }

      const preferMemory =
        preferredPath.startsWith("memory://") ||
        prevItem.path.startsWith("memory://");

      updatePlotDataSource(preferredPath, { preferMemory });
      console.log(
        `Updated ${plotConfigs.length} plots with new dataset: ${preferredPath}`,
      );

      // Keep the "previous" snapshot aligned with the path we actually applied to avoid flip-flop churn
      nextPreviousItems = basketItems.map((item) =>
        item.id === newItem.id ? { ...item, path: preferredPath } : item,
      );
    }

    // Update the reference for next comparison
    previousBasketItems.current = nextPreviousItems;
  }, [basketItems, plotConfigs.length, updatePlotDataSource]);

  // Auto-create default plots when new items with attributes are added to basket
  useEffect(() => {
    basketItems.forEach((item) => {
      // Skip if already processed
      if (processedAutoPlotItems.current.has(item.id)) {
        return;
      }

      // Skip if item doesn't have attributes yet (still loading)
      if (!item.attributes || loadingAttributes.has(item.id)) {
        return;
      }

      // Skip auto-plotting if there are existing plots AND this specific item already has plots
      // Check if any existing plot uses this item's path (either directly or via memory://)
      if (plotConfigs.length > 0) {
        const itemBaseName = item.name?.endsWith(".zarr")
          ? item.name.slice(0, -5)
          : item.name;
        const itemMemoryPath = itemBaseName ? `memory://${itemBaseName}` : null;

        const hasExistingPlots = plotConfigs.some((config) => {
          return (
            config.fpath === item.path ||
            (itemMemoryPath && config.fpath === itemMemoryPath)
          );
        });

        if (hasExistingPlots) {
          // Still mark as processed to avoid future attempts
          processedAutoPlotItems.current.add(item.id);
          return;
        }

        // Find the first existing heatmap and lineplot to copy their filters
        const existingHeatmap = plotConfigs.find(
          (config) => config.plotType === "HeatMap",
        );
        const existingLineplot = plotConfigs.find(
          (config) => config.plotType === "LinePlot",
        );

        const heatmapFilters = existingHeatmap
          ? getPlotState(existingHeatmap.id)?.applied_filters
          : undefined;
        const lineplotFilters = existingLineplot
          ? getPlotState(existingLineplot.id)?.applied_filters
          : undefined;

        // Mark as processed
        processedAutoPlotItems.current.add(item.id);

        // Generate auto-plot configs with copied filters
        const result = generateAutoPlotConfigs(
          item,
          heatmapFilters,
          lineplotFilters,
        );

        if (result.success && result.plotConfigs.length > 0) {
          // Add each generated plot config to the viewer
          result.plotConfigs.forEach((config) => {
            addPlot(config);
          });
          const filterMsg =
            (heatmapFilters?.length ?? 0) > 0 ||
            (lineplotFilters?.length ?? 0) > 0
              ? " with copied filters"
              : "";
          showToast(result.message + filterMsg, "success");
        } else {
          // Only show error if there were actual issues (not just non-qualifying items)
          if (
            !result.message.includes("not a valid measurement") &&
            !result.message.includes("no independents or dependents")
          ) {
            showToast(result.message, "error");
          }
        }
      } else {
        // No existing plots - mark as processed
        processedAutoPlotItems.current.add(item.id);

        // Generate auto-plot configs without copied filters (first dataset)
        const result = generateAutoPlotConfigs(item);

        if (result.success && result.plotConfigs.length > 0) {
          // Add each generated plot config to the viewer
          result.plotConfigs.forEach((config) => {
            addPlot(config);
          });
          showToast(result.message, "success");
        } else {
          // Only show error if there were actual issues (not just non-qualifying items)
          if (
            !result.message.includes("not a valid measurement") &&
            !result.message.includes("no independents or dependents")
          ) {
            showToast(result.message, "error");
          }
        }
      }
    });
  }, [
    basketItems,
    loadingAttributes,
    addPlot,
    showToast,
    plotConfigs,
    getPlotState,
  ]);

  // Calculate dynamic height based on actual rendered heights
  const updateViewerHeight = () => {
    if (basketRef.current && composerRef.current && containerRef.current) {
      const basketHeight = basketRef.current.offsetHeight;
      const composerHeight = composerRef.current.offsetHeight;
      const containerPadding = 16; // p-2 = 8px top + 8px bottom = 16px
      const gap = 16; // gap-2 = 8px * 2 = 16px (two gaps: basket-composer, composer-viewer)
      const totalUsedHeight =
        basketHeight + composerHeight + containerPadding + gap;

      setViewerHeight(`calc(100vh - ${totalUsedHeight}px)`);
    }
  };

  // Update height when basket items change or components mount/unmount
  useEffect(() => {
    updateViewerHeight();

    // Use ResizeObserver to detect height changes in basket and composer
    const resizeObserver = new ResizeObserver(() => {
      updateViewerHeight();
    });

    if (basketRef.current) {
      resizeObserver.observe(basketRef.current);
    }
    if (composerRef.current) {
      resizeObserver.observe(composerRef.current);
    }

    return () => {
      resizeObserver.disconnect();
    };
  }, [basketItems.length]); // Re-run when basket items change

  // Listen for global plot size preset events from PlotWrapper
  useEffect(() => {
    const handler = (e: Event) => {
      try {
        const ce = e as CustomEvent<{ id: string | null; percent: number }>;
        const payload = ce.detail;
        const pct = Number(payload?.percent);
        const id = payload?.id;
        if (id && !Number.isNaN(pct) && pct > 0 && pct <= 100) {
          // set per-plot override
          setPerPlotWidthMap((prev) => ({ ...prev, [id]: pct }));
        } else if (!id && !Number.isNaN(pct) && pct > 0 && pct <= 100) {
          // global override
          setPlotWidthPercent(pct);
          // clear per-plot overrides when global set without id
          setPerPlotWidthMap({});
        }
      } catch {
        // ignore
      }
    };
    window.addEventListener("plot-size-preset", handler as EventListener);
    return () =>
      window.removeEventListener("plot-size-preset", handler as EventListener);
  }, []);

  // Keep processedAutoPlotItems in sync: remove IDs for items no longer in the basket
  useEffect(() => {
    const currentIds = new Set(basketItems.map((it) => it.id));
    // Remove any processed IDs that are no longer present
    processedAutoPlotItems.current.forEach((id) => {
      if (!currentIds.has(id)) {
        processedAutoPlotItems.current.delete(id);
      }
    });
  }, [basketItems]);

  // Also update on window resize
  useEffect(() => {
    const handleResize = () => updateViewerHeight();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const VIEWER_TIPS = (
    <div className="space-y-1 text-sm">
      <div>• Click Appearance / Filters to edit a plot.</div>
      <div>
        • Hold Shift while hovering those buttons to switch to Paint mode.
      </div>
      <div>
        • In Paint mode, Shift+Click other plots to apply copied settings.
      </div>
      <div>• Incompatible plot types will show an error toast.</div>
      <div>
        • Use the size preset buttons (33 / 50 / 66 / 100) to set plot widths
        for all plots; 50% forces side-by-side.
      </div>
      <div>
        • Use the Squarify button to force a 1:1 aspect ratio for all plots.
      </div>
    </div>
  );

  const handleCreatePlot = (config: PlotComposerConfig) => {
    console.log(
      `[Viewer] handleCreatePlot received config:`,
      JSON.stringify(config, null, 2),
    );
    // live dataset flags removed; just add the provided config
    addPlot({ ...config });
  };

  const handleDownload = async (items: BasketItem[]) => {
    try {
      console.log("Downloading items:", items);

      // Filter only .zarr files
      const zarrItems = items.filter(
        (item) => item.type === "file" && item.path.endsWith(".zarr"),
      );

      if (zarrItems.length === 0) {
        showToast("No .zarr files to download", "warning");
        console.warn("No .zarr files to download");
        return;
      }

      // Prepare paths for the API
      const paths = zarrItems.map((item) => ({ path: item.path }));

      // Call the backend download-selected endpoint
      const response = await axios.post(
        `${PROD_BACKEND_URL}/download-selected/`,
        paths,
        { responseType: "blob" },
      );

      // Create a download link
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute(
        "download",
        `selected_datasets_${zarrItems.length}_files.zip`,
      );
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);

      console.log("Download initiated successfully");
    } catch (error) {
      console.error("Error downloading selected items:", error);
      showToast("Failed to download selected items", "error");
    }
  };

  const handleDropItem = async (item: BasketItem) => {
    // Add the item to basket immediately (without attributes)
    onAddToBasket(item);

    // Load attributes from backend asynchronously if it's a file
    if (item.type === "file") {
      // Start loading state
      onStartLoadingAttributes(item.id);

      try {
        console.log("Loading attributes for dropped item:", item.path);
        const response = await axios.post(`${PROD_BACKEND_URL}/load-attrs/`, {
          path: item.path,
        });
        console.log(
          "Attributes loaded for dropped item:",
          item.id,
          response.data,
        );

        // Update the basket item with the loaded attributes (this also removes from loading state)
        onUpdateBasketItemAttributes(item.id, response.data);
      } catch (error) {
        showToast("Failed to load file attributes", "error");
        console.error("Error loading attributes for dropped item:", error);
        // Remove from loading state even if there's an error
        onUpdateBasketItemAttributes(item.id, {});
      }
    }
  };

  return (
    <Panel defaultSize={defaultWidth}>
      <div className="h-full flex flex-col bg-gray-100 border-r shadow-inner">
        <div ref={containerRef} className="flex flex-col h-full p-2 gap-2">
          {/* Basket Component */}
          <div ref={basketRef} className="flex-shrink-0">
            <Basket
              items={basketItems}
              onRemoveItem={onRemoveBasketItem}
              onClearAll={onClearBasket}
              onDownload={handleDownload}
              onDropItem={handleDropItem}
              externalLoadingAttributes={loadingAttributes}
            />
          </div>

          {/* Plot Composer */}
          <div
            ref={composerRef}
            className="flex-shrink-0 border border-gray-200 rounded-lg"
          >
            <PlotComposer onCreatePlot={handleCreatePlot} />
          </div>

          {/* Main Content Area - Plots Viewer */}
          <div
            className="flex-1 bg-white rounded-lg border border-gray-300 flex flex-col"
            style={{ maxHeight: viewerHeight }}
          >
            <div className="flex items-center justify-between flex-shrink-0 bg-gray-50 border-b border-gray-200 rounded-t-lg p-2">
              <h3 className="font-semibold text-gray-900 flex items-center">
                <ChartScatter
                  size={16}
                  className="mr-1.5 align-middle mb-0.5"
                />{" "}
                Viewer<span className="ml-[1.5px]">({plotConfigs.length})</span>
              </h3>
              <div className="flex items-center space-x-2">
                {/* Tips */}
                <Tooltip
                  content={VIEWER_TIPS}
                  position="left"
                  className="p-1 text-gray-600 hover:text-yellow-600 hover:bg-yellow-200 rounded disabled:opacity-50 transition-colors"
                >
                  <Lightbulb size={16} />
                </Tooltip>

                {/* Squarify toggle - applies to all plots */}
                <Tooltip
                  content={
                    isSquareModeGlobal
                      ? "Unsquarify all plots"
                      : "Squarify all plots"
                  }
                  position="left"
                >
                  <button
                    title={
                      isSquareModeGlobal ? "Unsquarify all" : "Squarify all"
                    }
                    onClick={() => {
                      // Toggle local state and broadcast
                      const next = !isSquareModeGlobal;
                      setIsSquareModeGlobal(next);
                      try {
                        window.dispatchEvent(
                          new CustomEvent("plot-squarify", {
                            detail: { enabled: next },
                          }),
                        );
                      } catch {
                        /* ignore */
                      }
                    }}
                    className={`p-1.5 rounded transition-colors duration-150 ${
                      isSquareModeGlobal ? "bg-blue-50" : "hover:bg-gray-200"
                    }`}
                  >
                    <svg
                      className={`w-4 h-4 ${
                        isSquareModeGlobal ? "text-blue-600" : "text-gray-600"
                      }`}
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <rect
                        x="3"
                        y="3"
                        width="18"
                        height="18"
                        rx="2"
                        ry="2"
                      ></rect>
                      <rect
                        x="8"
                        y="8"
                        width="8"
                        height="8"
                        rx="1"
                        ry="1"
                      ></rect>
                    </svg>
                  </button>
                </Tooltip>

                {/* Size preset ButtonGroup - affects all plots by default */}
                <div className="inline-flex items-center bg-white border border-gray-200 rounded">
                  {[33, 50, 66, 100].map((pct, idx) => (
                    <Tooltip
                      key={pct}
                      content={`${pct}% width (all plots)`}
                      position="left"
                    >
                      <button
                        onClick={() => {
                          // When applying globally, clear per-plot overrides
                          setPlotWidthPercent(pct);
                          setPerPlotWidthMap({});
                          try {
                            window.dispatchEvent(
                              new CustomEvent("plot-size-preset", {
                                detail: { id: null, percent: pct },
                              }),
                            );
                          } catch {
                            /* ignore */
                          }
                        }}
                        title={`${pct}% width`}
                        className={`px-2 py-1 text-xs font-medium ${
                          plotWidthPercent === pct
                            ? "bg-gray-100"
                            : "hover:bg-gray-50"
                        } ${idx > 0 ? "-ml-px" : ""}`}
                      >
                        {pct}
                      </button>
                    </Tooltip>
                  ))}
                </div>

                <Tooltip
                  content="Remove all plots from the viewer"
                  position="left"
                >
                  <button
                    onClick={clearPlots}
                    className="px-3 py-1 text-sm text-red-600 hover:bg-gray-300 rounded transition-colors"
                  >
                    Clear All Plots
                  </button>
                </Tooltip>
              </div>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
              {plotConfigs.length > 0 ? (
                <div className="p-2">
                  <PlotContainer
                    plotConfigs={plotConfigs}
                    onRemovePlot={removePlot}
                    widthPercent={plotWidthPercent}
                    perPlotWidthMap={perPlotWidthMap}
                  />
                </div>
              ) : (
                <div className="h-full flex items-center justify-center text-gray-500 p-4">
                  <div className="text-center">
                    <ChartScatter
                      size={48}
                      className="mx-auto mb-2 opacity-50"
                    />
                    <p>No plots to display</p>
                    <p className="text-sm mt-1">
                      Create a plot using the composer above
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </Panel>
  );
};

export default Viewer;

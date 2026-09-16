import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { PROD_BACKEND_URL } from "./config";

// Local imports
import BaseLayout from "./components/BaseLayout";
import Sidebar from "./components/Sidebar";
import SidebarRail from "./components/SidebarRail";
import Viewer from "./components/Viewer";
import ErrorBoundary from "./components/ErrorBoundary";
import { ToastProvider } from "./components/Toast";
import { TreeNode } from "./components/treeUtils";
import { BasketItem } from "./components/Basket";
import { AttrData } from "./components/interfaces";
import { useSidebarStore } from "./stores/sidebarStore";
import { useThemeStore } from "./stores/themeStore";
import HelpModal from "./components/HelpModal";
import { useShortcut } from "./hooks/useGlobalShortcuts";
import { isDatasetPath, detectDatasetKind } from "./utils/datasetPaths";
import { useToast } from "./hooks/useToast";

// Browser default, and what the rem-based Tailwind scales assume at 100%.
const BASE_FONT_SIZE_PX = 16;

const MAX_BASKET_ITEMS = 50;

const AppContent: React.FC = () => {
  const [basketItems, setBasketItems] = useState<BasketItem[]>([]);
  // Several adds can run in one event (a multi-selection, a drop), before the
  // state re-renders, so the limit is checked against this synchronous copy.
  const basketItemsRef = useRef<BasketItem[]>([]);
  const lastLimitWarningRef = useRef(0);
  const { showToast } = useToast();
  const [selectedNode, setSelectedNode] = useState<TreeNode | null>(null);
  const [loadingAttributes, setLoadingAttributes] = useState<Set<string>>(new Set());
  const [notesSelectedItemId, setNotesSelectedItemId] = useState<string | null>(null);
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const { setSidebarCollapsed, setNotesCollapsed, updateExplorerState } = useSidebarStore();
  const theme = useThemeStore((state) => state.theme);
  const zoomLevel = useSidebarStore((state) => state.zoomLevel);

  useLayoutEffect(() => {
    const root = document.documentElement;

    // Theme changes touch many elements that normally animate hover/state
    // colors. Disable those transitions for this style flush so the entire UI
    // switches as one frame instead of showing a low-contrast mixed theme.
    root.classList.add("qimchi-theme-switching");
    root.classList.toggle("dark", theme === "dark");
    void root.offsetWidth;
    root.classList.remove("qimchi-theme-switching");
  }, [theme]);

  // App zoom, as root font size rather than CSS `zoom`.
  //
  // `zoom` puts layout into a scaled coordinate space while pointer events and
  // getBoundingClientRect stay in the viewport's, so anything that mixes the
  // two lands in the wrong place: our tooltips, react-rnd's drag maths, and
  // Plotly's hover labels. Only the first is ours to fix.
  //
  // Root font size has no second coordinate space. Tailwind's spacing and type
  // scales are rem-based, so the UI scales and every pointer position stays
  // exactly where the browser says it is. The trade-off is that arbitrary
  // pixel values (h-[166px] and friends) keep their size.
  useLayoutEffect(() => {
    document.documentElement.style.fontSize = `${BASE_FONT_SIZE_PX * zoomLevel}px`;
  }, [zoomLevel]);

  const datasetKeys = useMemo(
    () =>
      basketItems.map((item) => ({
        id: item.id,
        key: item.path
          .replace(/\\/g, "/")
          .replace(/^memory:\/\//, "")
          .split("/")
          .pop()
          ?.replace(/\.(zarr|nc|h5|hdf5|csv|txt|dat)$/i, "")
          .toLowerCase(),
      })),
    [basketItems],
  );

  const openNotesPanel = useCallback(
    (openPanel: boolean) => {
      if (!openPanel) return;
      setSidebarCollapsed(false);
      setNotesCollapsed(false);
    },
    [setNotesCollapsed, setSidebarCollapsed],
  );

  const handleSelectNode = (node: TreeNode) => {
    // console.log("Selected node:", node);
    setSelectedNode(node);
  };

  const handleOpenNotes = async (node: TreeNode) => {
    openNotesPanel(true);

    // First, ensure the item is in the basket
    const existingItem = basketItems.find((item) => item.id === node.id);
    if (!existingItem) {
      // Add to basket if not already there
      const newBasketItem: BasketItem = {
        id: node.id,
        name: node.name,
        path: node.path,
        type: node.type,
        size: node.size,
        timestamp: node.timestamp,
        tags: node.tags,
      };

      if (!handleAddToBasket(newBasketItem)) return;

      // Load attributes for the new item
      try {
        handleStartLoadingAttributes(node.id);

        const response = await axios.post(`${PROD_BACKEND_URL}/load-attrs/`, {
          path: node.path,
        });

        handleUpdateBasketItemAttributes(node.id, response.data);
        console.log("Attributes loaded for item:", node.id, response.data);
      } catch (error) {
        console.error("Error loading attributes:", error);
        // Remove from loading state even if failed
        setLoadingAttributes((prev) => {
          const newSet = new Set(prev);
          newSet.delete(node.id);
          return newSet;
        });
      }
    }

    // Set the notes to show this item
    setNotesSelectedItemId(node.id);
  };

  const handleOpenSampleNotes = (node: TreeNode) => {
    openNotesPanel(true);
    window.dispatchEvent(
      new CustomEvent("notes:select-sample", {
        detail: { samplePath: node.path },
      }),
    );
  };

  const handleOpenNotesFromBasketItem = (item: BasketItem) => {
    openNotesPanel(true);
    setNotesSelectedItemId(item.id);
  };

  const handleNotesSelectedItemChange = (itemId: string | null) => {
    setNotesSelectedItemId(itemId);
  };

  // Returns whether the item was newly added, so callers skip loading its attributes otherwise.
  const handleAddToBasket = (item: BasketItem): boolean => {
    try {
      // Validate item before adding
      if (!item || !item.id || !item.name || !item.path) {
        console.error("Invalid item passed to handleAddToBasket:", item);
        return false;
      }

      const current = basketItemsRef.current;
      if (current.some((existing) => existing.id === item.id)) {
        return false;
      }
      if (current.length >= MAX_BASKET_ITEMS) {
        // One warning for a whole multi-item add, not one per item.
        const now = Date.now();
        if (now - lastLimitWarningRef.current > 2000) {
          lastLimitWarningRef.current = now;
          showToast(
            `The basket holds at most ${MAX_BASKET_ITEMS} measurements. Remove some before adding more.`,
            "warning",
            6000,
            "Basket",
          );
        }
        return false;
      }

      // Prepend so newly added items appear at the beginning of the basket.
      const next = [item, ...current];
      basketItemsRef.current = next;
      setBasketItems(next);
      // Keep Notes dropdown aligned to the latest added basket item.
      setNotesSelectedItemId(item.id);
      return true;
    } catch (error) {
      console.error("Error adding item to basket:", error);
      return false;
    }
  };

  useEffect(() => {
    const handleNotesOpen = (event: Event) => {
      const customEvent = event as CustomEvent<{
        datasetPath?: string;
        openPanel?: boolean;
      }>;
      const datasetPath = customEvent.detail?.datasetPath;
      if (!datasetPath) return;

      const key = datasetPath
        .replace(/\\/g, "/")
        .replace(/^memory:\/\//, "")
        .split("/")
        .pop()
        ?.replace(/\.(zarr|nc|h5|hdf5|csv|txt|dat)$/i, "")
        .toLowerCase();

      const matched = datasetKeys.find((entry) => entry.key === key);
      if (!matched) return;

      openNotesPanel(customEvent.detail?.openPanel !== false);
      setNotesSelectedItemId(matched.id);
    };

    window.addEventListener("notes:open", handleNotesOpen as EventListener);
    return () => {
      window.removeEventListener("notes:open", handleNotesOpen as EventListener);
    };
  }, [datasetKeys, openNotesPanel]);

  const handleRemoveBasketItem = (id: string) => {
    const next = basketItemsRef.current.filter((item) => item.id !== id);
    basketItemsRef.current = next;
    setBasketItems(next);
  };

  const handleClearBasket = () => {
    basketItemsRef.current = [];
    setBasketItems([]);
  };

  const handleUpdateBasketItemAttributes = (itemId: string, attributes: AttrData) => {
    const next = basketItemsRef.current.map((item) =>
      item.id === itemId ? { ...item, attributes } : item,
    );
    basketItemsRef.current = next;
    setBasketItems(next);
    // Remove from loading state when attributes are loaded
    setLoadingAttributes((prev) => {
      const newSet = new Set(prev);
      newSet.delete(itemId);
      return newSet;
    });
  };

  const handleStartLoadingAttributes = (itemId: string) => {
    setLoadingAttributes((prev) => new Set(prev).add(itemId));
  };

  // Cycling handler that will be passed to both Sidebar and Viewer
  const handleCycleDataset = (direction: "prev" | "next") => {
    // This is intentionally empty - the actual cycling is handled by DirTree
    // which updates the basket items, and then Viewer responds to those changes
    console.log(`Cycling dataset: ${direction}`);
  };

  useShortcut("toggle-help", () => setIsHelpOpen((prev) => !prev));

  // TODO: WIP <:egg:>
  // Deep-link open (used by the open_in_qimchi MCP tool). On first load, read
  // ?dataset=<abs path> or ?folder=<abs path> from the URL:
  //   - dataset: add it to the basket + load attrs; Viewer auto-plots defaults.
  //   - folder:  root the Explorer there (same as the Explorer's path box).
  // The params are stripped afterwards so a manual reload doesn't re-trigger.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const datasetParam = params.get("dataset");
    const folderParam = params.get("folder");
    if (!datasetParam && !folderParam) return;

    const url = new URL(window.location.href);
    url.searchParams.delete("dataset");
    url.searchParams.delete("folder");
    window.history.replaceState({}, "", url.toString());

    if (folderParam) {
      setSidebarCollapsed(false);
      updateExplorerState({ path: folderParam, submittedPath: folderParam });
    }

    if (datasetParam && isDatasetPath(datasetParam)) {
      const name =
        datasetParam.replace(/\\/g, "/").replace(/\/+$/, "").split("/").pop() || datasetParam;
      const item: BasketItem = {
        id: datasetParam,
        name,
        path: datasetParam,
        type: "file",
        tags: [detectDatasetKind(datasetParam)],
      };
      if (!handleAddToBasket(item)) return;
      handleStartLoadingAttributes(item.id);
      axios
        .post(`${PROD_BACKEND_URL}/load-attrs/`, { path: datasetParam })
        .then((response) => handleUpdateBasketItemAttributes(item.id, response.data))
        .catch((error) => {
          console.error("Deep-link attribute load failed:", error);
          setLoadingAttributes((prev) => {
            const next = new Set(prev);
            next.delete(item.id);
            return next;
          });
        });
    }
    // Run once on mount; handlers are stable for this purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <ErrorBoundary>
        <BaseLayout
          rail={<SidebarRail onOpenHelp={() => setIsHelpOpen(true)} />}
          sidebar={
            <ErrorBoundary>
              <Sidebar
                onSelectNode={handleSelectNode}
                basketItems={basketItems}
                onRemoveBasketItem={handleRemoveBasketItem}
                onAddToBasket={handleAddToBasket}
                onUpdateBasketItemAttributes={handleUpdateBasketItemAttributes}
                onStartLoadingAttributes={handleStartLoadingAttributes}
                loadingAttributes={loadingAttributes}
                onOpenNotes={handleOpenNotes}
                onOpenSampleNotes={handleOpenSampleNotes}
                notesSelectedItemId={notesSelectedItemId}
                onNotesSelectedItemChange={handleNotesSelectedItemChange}
                onCycleDataset={handleCycleDataset}
              />
            </ErrorBoundary>
          }
          viewer={
            <ErrorBoundary>
              <Viewer
                onSelectNode={handleSelectNode}
                basketItems={basketItems}
                onRemoveBasketItem={handleRemoveBasketItem}
                onClearBasket={handleClearBasket}
                onAddToBasket={handleAddToBasket}
                selectedNode={selectedNode}
                loadingAttributes={loadingAttributes}
                onStartLoadingAttributes={handleStartLoadingAttributes}
                onUpdateBasketItemAttributes={handleUpdateBasketItemAttributes}
                onOpenNotesItem={handleOpenNotesFromBasketItem}
              />
            </ErrorBoundary>
          }
        />
      </ErrorBoundary>
      <HelpModal isOpen={isHelpOpen} onClose={() => setIsHelpOpen(false)} />
    </>
  );
};

// The provider wraps the content so the basket can raise toasts too.
const App: React.FC = () => (
  <ToastProvider>
    <AppContent />
  </ToastProvider>
);

export default App;

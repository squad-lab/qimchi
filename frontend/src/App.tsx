import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import axios from "axios";
import { PROD_BACKEND_URL } from "./config";

// Local imports
import BaseLayout from "./components/BaseLayout";
import Sidebar from "./components/Sidebar";
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

const App: React.FC = () => {
  const [basketItems, setBasketItems] = useState<BasketItem[]>([]);
  const [selectedNode, setSelectedNode] = useState<TreeNode | null>(null);
  const [loadingAttributes, setLoadingAttributes] = useState<Set<string>>(new Set());
  const [notesSelectedItemId, setNotesSelectedItemId] = useState<string | null>(null);
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const { setSidebarCollapsed, setNotesCollapsed, updateExplorerState } = useSidebarStore();
  const theme = useThemeStore((state) => state.theme);

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

      handleAddToBasket(newBasketItem);

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

  const handleAddToBasket = (item: BasketItem) => {
    try {
      // Validate item before adding
      if (!item || !item.id || !item.name || !item.path) {
        console.error("Invalid item passed to handleAddToBasket:", item);
        return;
      }

      let added = false;
      setBasketItems((prev) => {
        // Check if item already exists in basket
        if (prev.some((existing) => existing.id === item.id)) {
          console.log("Item already in basket:", item.name);
          return prev;
        }
        console.log("Added to basket:", item.name);
        added = true;
        // Prepend so newly added items appear at the beginning of the basket.
        return [item, ...prev];
      });

      // Keep Notes dropdown aligned to the latest added basket item.
      if (added) {
        setNotesSelectedItemId(item.id);
      }
    } catch (error) {
      console.error("Error adding item to basket:", error);
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
    setBasketItems((prev) => prev.filter((item) => item.id !== id));
  };

  const handleClearBasket = () => {
    setBasketItems([]);
  };

  const handleUpdateBasketItemAttributes = (itemId: string, attributes: AttrData) => {
    setBasketItems((prev) =>
      prev.map((item) => (item.id === itemId ? { ...item, attributes } : item)),
    );
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
      handleAddToBasket(item);
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
    <ToastProvider>
      <ErrorBoundary>
        <BaseLayout
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
                onOpenHelp={() => setIsHelpOpen(true)}
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
    </ToastProvider>
  );
};

export default App;

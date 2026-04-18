import axios from "axios";
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Folder } from "lucide-react";

// Local imports
import { AttrData } from "./interfaces";
import { useToast } from "../hooks/useToast";
import { PROD_BACKEND_URL } from "../config";
import { BasketItem } from "./Basket";
import DirTree from "./DirTree";
import { TreeNode } from "./treeUtils";
import Tooltip from "./Tooltip";
import { useSidebarStore } from "../stores/sidebarStore";

interface ExplorerProps {
  onSelectNode: (node: TreeNode) => void;
  basketItems: BasketItem[];
  onAddToBasket: (item: BasketItem) => void;
  onRemoveBasketItem: (id: string) => void;
  onUpdateBasketItemAttributes: (itemId: string, attributes: AttrData) => void;
  onStartLoadingAttributes: (itemId: string) => void;
  onOpenNotes: (node: TreeNode) => void;
  onOpenSampleNotes?: (node: TreeNode) => void;
  onCycleDataset?: (direction: "prev" | "next") => void; // For cycling through datasets
  onOpenHelp?: () => void; // For opening Help modal
}

const Explorer = ({
  onSelectNode,
  basketItems,
  onAddToBasket,
  onRemoveBasketItem,
  onUpdateBasketItemAttributes,
  onStartLoadingAttributes,
  onOpenNotes,
  onOpenSampleNotes,
  onCycleDataset,
  onOpenHelp,
}: ExplorerProps) => {
  // Use Zustand store for path and submittedPath
  const { componentStates, updateExplorerState } = useSidebarStore();
  const { path, submittedPath } = componentStates.explorer;
  const { showToast } = useToast();
  const historyRef = useRef<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number>(-1);

  const canGoBack = historyIndex > 0;
  const canGoForward =
    historyIndex >= 0 && historyIndex < historyRef.current.length - 1;

  const pushHistory = (rawPath: string) => {
    const nextPath = rawPath.trim();
    if (!nextPath) return;

    const currentPath =
      historyIndex >= 0 ? historyRef.current[historyIndex] : undefined;
    if (currentPath === nextPath) return;

    const truncated =
      historyIndex >= 0
        ? historyRef.current.slice(0, historyIndex + 1)
        : historyRef.current.slice();

    const merged =
      truncated.length > 0 && truncated[truncated.length - 1] === nextPath
        ? truncated
        : [...truncated, nextPath];

    historyRef.current = merged;
    setHistoryIndex(merged.length - 1);
  };

  useEffect(() => {
    const initial = submittedPath.trim();
    if (!initial || historyRef.current.length > 0) return;
    historyRef.current = [initial];
    setHistoryIndex(0);
  }, [submittedPath]);

  const handleSubmit = () => {
    const nextPath = path.trim();
    if (nextPath) {
      console.log("Loading directory for path:", nextPath);
      updateExplorerState({ path: nextPath, submittedPath: nextPath });
      pushHistory(nextPath);
    }
  };

  const handlePathChange = (newPath: string) => {
    const nextPath = newPath.trim();
    updateExplorerState({
      path: nextPath,
      submittedPath: nextPath,
    });
    pushHistory(nextPath);
  };

  const navigateHistory = (direction: "back" | "forward") => {
    const delta = direction === "back" ? -1 : 1;
    const nextIndex = historyIndex + delta;
    const nextPath = historyRef.current[nextIndex];
    if (!nextPath) return;

    setHistoryIndex(nextIndex);
    updateExplorerState({
      path: nextPath,
      submittedPath: nextPath,
    });
  };

  const handleSelectNode = (node: TreeNode) => {
    onSelectNode(node);
    // console.log("Selected node:", node);
  };

  const handleAddToBasket = async (node: TreeNode) => {
    const basketItem: BasketItem = {
      id: node.id,
      name: node.name,
      path: node.path,
      type: node.type,
      size: node.size,
      timestamp: node.timestamp, // This will be Date | undefined, which is compatible with BasketItem
      tags: node.tags,
      lastModified: node.lastModified,
    };

    // Add the item to basket immediately (without attributes)
    onAddToBasket(basketItem);

    // Load attributes from backend asynchronously if it's a file
    if (node.type === "file") {
      // Start loading state
      onStartLoadingAttributes(node.id);

      try {
        // console.log("Loading attributes for:", node.path);
        const response = await axios.post(`${PROD_BACKEND_URL}/load-attrs/`, {
          path: node.path,
        });
        // console.log("Attributes loaded for item:", node.id, response.data);

        // Update the basket item with the loaded attributes (this also removes from loading state)
        onUpdateBasketItemAttributes(node.id, response.data);
      } catch {
        showToast("Failed to load file attributes", "error", 3000, "Explorer", {
          path: node.path,
          error: "API Request Failed",
        });
        // console.error("Error loading attributes for item:", error);
        // Remove from loading state even if there's an error
        onUpdateBasketItemAttributes(node.id, {});
      }
    }
  };

  // Handle download
  const handleDownload = async (node: TreeNode) => {
    try {
      console.log("Downloading dataset:", node.path);

      // Call the backend download endpoint
      const response = await axios.post(
        `${PROD_BACKEND_URL}/download/`,
        { path: node.path },
        { responseType: "blob" },
      );

      // Create a download link
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `${node.name}.zip`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);

      console.log("Download initiated successfully");
    } catch (error) {
      console.error("Error downloading dataset:", error);
      showToast("Failed to download dataset", "error", 3000, "Explorer", {
        path: node.path,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  return (
    <div className="flex flex-col h-full p-2">
      {/* Path input section */}
      <div className="flex mb-4 w-full">
        {/* Path history navigation - no persistence */}
        <Tooltip content="Back" className="flex">
          <button
            type="button"
            onClick={() => navigateHistory("back")}
            disabled={!canGoBack}
            className="border border-gray-300 border-r-0 px-2 py-2 rounded-l shadow-sm bg-white text-gray-700 disabled:text-gray-300 disabled:bg-gray-100 hover:bg-gray-50 disabled:hover:bg-gray-100 transition-colors"
            title="Back"
            aria-label="Go back"
          >
            <ChevronLeft size={18} />
          </button>
        </Tooltip>
        <Tooltip content="Forward" className="flex">
          <button
            type="button"
            onClick={() => navigateHistory("forward")}
            disabled={!canGoForward}
            className="border border-gray-300 border-r-0 px-2 py-2 shadow-sm bg-white text-gray-700 disabled:text-gray-300 disabled:bg-gray-100 hover:bg-gray-50 disabled:hover:bg-gray-100 transition-colors"
            title="Forward"
            aria-label="Go forward"
          >
            <ChevronRight size={18} />
          </button>
        </Tooltip>
        <input
          type="text"
          className="flex-1 min-w-0 border border-gray-300 px-3 py-2 shadow-sm focus:outline-none focus:ring focus:ring-blue-300 focus:border-blue-300 text-sm"
          placeholder="Enter folder path"
          value={path}
          onChange={(e) => updateExplorerState({ path: e.target.value })}
          onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
        />
        {/* Load button */}
        <Tooltip content="Load folder" className="flex">
          <button
            type="button"
            onClick={handleSubmit}
            className="bg-[#6ea030] hover:bg-[#5a8526] text-white px-4 py-2 rounded-r transition-colors focus:outline-none focus:ring focus:ring-[#8DC63F] flex items-center justify-center"
            title="Load folder"
          >
            <Folder size={20} />
          </button>
        </Tooltip>
      </div>
      {/* Directory tree - only show when path is provided */}
      <div className="flex-1 overflow-y-auto">
        {submittedPath && submittedPath.trim() ? (
          <DirTree
            key={submittedPath}
            path={submittedPath}
            onSelectNode={handleSelectNode}
            basketItems={basketItems}
            onAddToBasket={handleAddToBasket}
            onRemoveBasketItem={onRemoveBasketItem}
            onPathChange={handlePathChange}
            onOpenNotes={onOpenNotes}
            onOpenSampleNotes={onOpenSampleNotes}
            onDownload={handleDownload}
            onCycleDataset={onCycleDataset}
            onStartLoadingAttributes={onStartLoadingAttributes}
            onUpdateBasketItemAttributes={onUpdateBasketItemAttributes}
            onOpenHelp={onOpenHelp}
          />
        ) : (
          <div className="h-32 flex flex-col items-center justify-center text-gray-500">
            <Folder size={48} className="mb-2 text-gray-400" />
            <p>No path specified</p>
            <p className="text-sm mt-1">Enter a folder path above</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default Explorer;

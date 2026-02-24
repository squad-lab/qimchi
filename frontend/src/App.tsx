import { useState } from "react";
import axios from "axios";
import { PROD_BACKEND_URL } from "./config";

// Local imports
import BaseLayout from "./components/BaseLayout";
import Sidebar from "./components/Sidebar";
import Viewer from "./components/Viewer";
import ErrorBoundary from "./components/ErrorBoundary";
import { ToastProvider } from "./components/Toast";
import { TreeNode } from "./components/DirTree";
import { BasketItem } from "./components/Basket";
import { AttrData } from "./components/interfaces";

const App: React.FC = () => {
  const [basketItems, setBasketItems] = useState<BasketItem[]>([]);
  const [selectedNode, setSelectedNode] = useState<TreeNode | null>(null);
  const [loadingAttributes, setLoadingAttributes] = useState<Set<string>>(
    new Set()
  );
  const [notesSelectedItemId, setNotesSelectedItemId] = useState<string | null>(
    null
  );

  const handleSelectNode = (node: TreeNode) => {
    // console.log("Selected node:", node);
    setSelectedNode(node);
  };

  const handleOpenNotes = async (node: TreeNode) => {
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

      setBasketItems((prev) => {
        // Check if item already exists in basket
        if (prev.some((existing) => existing.id === item.id)) {
          console.log("Item already in basket:", item.name);
          return prev;
        }
        console.log("Added to basket:", item.name);

        return [...prev, item];
      });
    } catch (error) {
      console.error("Error adding item to basket:", error);
    }
  };

  const handleRemoveBasketItem = (id: string) => {
    setBasketItems((prev) => prev.filter((item) => item.id !== id));
  };

  const handleClearBasket = () => {
    setBasketItems([]);
  };

  const handleUpdateBasketItemAttributes = (
    itemId: string,
    attributes: AttrData
  ) => {
    setBasketItems((prev) =>
      prev.map((item) => (item.id === itemId ? { ...item, attributes } : item))
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
              />
            </ErrorBoundary>
          }
        />
      </ErrorBoundary>
    </ToastProvider>
  );
};

export default App;

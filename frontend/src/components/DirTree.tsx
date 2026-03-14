import {
  useState,
  useMemo,
  useEffect,
  useRef,
  useCallback,
  forwardRef,
  useImperativeHandle,
} from "react";
import axios from "axios";
import { PROD_BACKEND_URL } from "../config";
import { useVirtualizer, Virtualizer } from "@tanstack/react-virtual";
import { useTree } from "@headless-tree/react";
import type { TreeInstance } from "@headless-tree/core";
import {
  syncDataLoaderFeature,
  selectionFeature,
  expandAllFeature,
  hotkeysCoreFeature,
  ItemInstance,
  buildProxiedInstance,
  propMemoizationFeature,
} from "@headless-tree/core";
import {
  Search,
  SortAsc,
  SortDesc,
  Filter,
  Plus,
  Minus,
  GripVertical,
  ChevronDown,
  ChevronRight,
  Expand,
  Minimize,
  RefreshCw,
  Copy,
  Check,
  FolderClosedIcon,
  FolderOpenIcon,
  DatabaseIcon,
  SearchXIcon,
  Lightbulb,
  X,
  FileText,
  LoaderCircle,
  Download,
  MoveUp,
  MoveDown,
  Radio,
} from "lucide-react";

// Local imports
import { useCopyToClipboard } from "../hooks/useCopyToClipboard";
import { useToast } from "../hooks/useToast";
import { useSidebarStore } from "../stores/sidebarStore";
import Tooltip from "./Tooltip";
import { BasketItem } from "./Basket";
import type { AttrData } from "./interfaces";

// NOTE: API for items that will go on the Tree
export interface TreeNode {
  id: string;
  name: string;
  path: string;
  type: "file" | "folder";
  size?: number;
  timestamp?: Date;
  tags?: string[];
  children?: TreeNode[];
  lastModified?: number;
}

// Global cache to persist data across component mounts/unmounts
const globalDirTreeCache = new Map<
  string,
  {
    data: TreeNode[];
    timestamp: number;
  }
>();

const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

interface DirTreeProps {
  path?: string; // Path to load directory from
  onSelectNode?: (node: TreeNode) => void;
  basketItems?: BasketItem[]; // Items already in the basket
  onAddToBasket?: (node: TreeNode) => void;
  onRemoveBasketItem?: (id: string) => void;
  onPathChange?: (newPath: string) => void; // For folder double-click navigation
  onOpenNotes?: (node: TreeNode) => void; // For opening notes
  onDownload?: (node: TreeNode) => void; // For downloading datasets
  onCycleDataset?: (direction: "prev" | "next") => void; // For cycling through datasets
  onStartLoadingAttributes?: (itemId: string) => void;
  onUpdateBasketItemAttributes?: (itemId: string, attributes: AttrData) => void;
}

/**
 * DirTree Component with Virtualization and Performance Optimizations
 *
 * Features:
 * - Proxy item instances: Reduces memory usage by creating lightweight proxy objects
 * - Virtualization: Only renders visible items for large datasets (1000+ items)
 * - Prop memoization: Caches component props to prevent unnecessary re-renders
 * - Smart suggestions: Automatically suggests virtualization for large datasets
 *
 * Performance benefits:
 * - Handles datasets with thousands of items efficiently
 * - Maintains smooth scrolling and interactions
 * - Reduces memory footprint for large tree structures
 */
const DirTree = ({
  path,
  onSelectNode,
  basketItems = [],
  onAddToBasket,
  onRemoveBasketItem,
  onPathChange,
  onOpenNotes,
  onDownload,
  onCycleDataset,
  onStartLoadingAttributes,
  onUpdateBasketItemAttributes,
}: DirTreeProps) => {
  const { showToast } = useToast();

  // Use Zustand store for persistent state
  const { componentStates, updateDirTreeState } = useSidebarStore();
  const {
    searchInput,
    searchTerm,
    sortBy,
    sortDirection,
    filterBy,
    showFilters,
    isExpanded,
    showLiveOnly,
    // lastPath, // TODO: Use this to track the last loaded path
  } = componentStates.dirTree;

  // Local state that doesn't need persistence
  const [draggedItem, setDraggedItem] = useState<string | null>(null);
  const [treeError, setTreeError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [apiData, setApiData] = useState<TreeNode[]>([]);
  const autoAddedMeasurements = useRef<Set<string>>(new Set());

  // Debounce search input
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      updateDirTreeState({ searchTerm: searchInput });
    }, 300); // 300ms debounce delay

    return () => clearTimeout(timeoutId);
  }, [searchInput, updateDirTreeState]);

  // Reset error when dependencies change
  useEffect(() => {
    setTreeError(null);
  }, [searchTerm, sortBy, sortDirection, filterBy]);

  // Load data from API
  const loadDirectoryData = useCallback(
    (path: string, forceReload: boolean = false) => {
      // If showLiveOnly is true, load from /load-live/ endpoint instead
      if (showLiveOnly) {
        setIsLoading(true);
        setTreeError(null);
        console.log("Loading live measurements...");

        axios
          .post(`${PROD_BACKEND_URL}/load-live/`)
          .then((response) => {
            if (response.data.success && response.data.children) {
              const children = response.data.children;
              setApiData(children);
              console.log(`Loaded ${children.length} live measurements`);
            } else {
              setApiData([]);
              console.log("No live measurements found");
            }
          })
          .catch((error) => {
            console.error("Error loading live measurements:", error);
            let errorMessage = "Failed to load live measurements";
            if (error.response) {
              errorMessage = error.response.data.detail || errorMessage;
            } else if (error.request) {
              errorMessage = "Server not responding";
            } else {
              errorMessage = error.message;
            }
            setTreeError(errorMessage);
          })
          .finally(() => {
            setIsLoading(false);
          });
        return;
      }

      // Check global cache first
      const cached = globalDirTreeCache.get(path);
      const now = Date.now();

      if (!forceReload && cached && now - cached.timestamp < CACHE_DURATION) {
        console.log("Using cached directory data for:", path);
        setApiData(cached.data);
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setTreeError(null);
      console.log("Loading directory data from:", path);

      axios
        .post(`${PROD_BACKEND_URL}/load/`, {
          path,
        })
        .then((response) => {
          console.log("API Response status:", response.status);
          // console.log("API Response data:", response.data);

          // Convert the API response to TreeNode format
          interface ApiNode {
            id: string;
            name: string;
            path: string;
            type: "file" | "folder";
            size?: number;
            timestamp?: string;
            tags?: string[];
            children?: ApiNode[];
            lastModified?: number;
          }

          const convertApiData = (apiNode: ApiNode): TreeNode => {
            return {
              id: apiNode.id,
              name: apiNode.name,
              path: apiNode.path,
              type: apiNode.type,
              size: apiNode.size,
              timestamp: apiNode.timestamp
                ? new Date(apiNode.timestamp)
                : undefined,
              tags: apiNode.tags,
              children: apiNode.children
                ? apiNode.children.map(convertApiData)
                : undefined,
              lastModified: apiNode.lastModified,
            };
          };

          // If the response is a single node, wrap it in an array
          const treeData = Array.isArray(response.data)
            ? response.data.map(convertApiData)
            : [convertApiData(response.data)];
          // console.log("Converted tree data:", treeData);

          // Store in global cache
          globalDirTreeCache.set(path, {
            data: treeData,
            timestamp: Date.now(),
          });

          setApiData(treeData);
        })
        .catch((error) => {
          console.error("Error loading directory data:", error);
          showToast("Failed to load directory data", "error");

          // Extract the detail message from the backend response
          let errorMessage = "Unknown error";

          if (error instanceof Error) {
            // Check if it's an axios error with response data
            if (axios.isAxiosError(error) && error.response?.data?.detail) {
              errorMessage = error.response.data.detail;
            } else {
              errorMessage = error.message;
            }
          }

          setTreeError(`Failed to load directory: ${errorMessage}`);
        })
        .finally(() => {
          setIsLoading(false);
        });
    },
    [showLiveOnly, showToast],
  );

  // Load data when path or showLiveOnly changes
  useEffect(() => {
    if (showLiveOnly) {
      // Load live measurements
      loadDirectoryData("", true); // Pass empty path for live mode
    } else if (path && path.trim()) {
      console.log("Loading directory data for path:", path);
      loadDirectoryData(path);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, showLiveOnly]); // Depend on both path and showLiveOnly

  // Periodic polling for live measurements (only when showLiveOnly is true)
  useEffect(() => {
    // Don't poll when not in live mode
    if (!showLiveOnly) {
      return;
    }

    // console.log("Starting live measurement polling (1s interval)");

    // Poll every 1 second
    const pollInterval = setInterval(() => {
      axios
        .post(`${PROD_BACKEND_URL}/load-live/`)
        .then((response) => {
          if (response.data.success && response.data.children) {
            const newMeasurements = response.data.children;

            // Incrementally update apiData without full rebuild
            setApiData((prevData) => {
              // Create a map of existing measurements by ID for quick lookup
              const existingMap = new Map(
                prevData.map((node) => [node.id, node]),
              );

              // Create a map of new measurements by ID
              const newMap = new Map(
                newMeasurements.map((node: TreeNode) => [node.id, node]),
              );

              // Find measurements to add (in new but not in existing)
              const toAdd = newMeasurements.filter(
                (node: TreeNode) => !existingMap.has(node.id),
              );

              // Find measurements to remove (in existing but not in new)
              const toRemove = new Set(
                prevData
                  .filter((node) => !newMap.has(node.id))
                  .map((node) => node.id),
              );

              // Update existing nodes and add new ones
              const updated = prevData
                .filter((node) => !toRemove.has(node.id)) // Remove old nodes
                .map((node) => {
                  // Update existing nodes with fresh data
                  const newNode = newMap.get(node.id);
                  return newNode || node;
                });

              // Add new nodes
              const result = [...updated, ...toAdd];

              // Log changes for debugging
              if (toAdd.length > 0) {
                console.log(`Added ${toAdd.length} new live measurement(s)`);

                // Auto-add new live measurements to basket
                toAdd.forEach((node: TreeNode) => {
                  // Check if already in basket or already auto-added
                  const inBasket = basketItems?.some(
                    (item) => item.id === node.id,
                  );
                  const alreadyAutoAdded = autoAddedMeasurements.current.has(
                    node.id,
                  );

                  if (!inBasket && !alreadyAutoAdded && onAddToBasket) {
                    console.log(
                      `Auto-adding live measurement to basket: ${node.name}`,
                    );
                    onAddToBasket(node);
                    autoAddedMeasurements.current.add(node.id);

                    // Load attributes for the new live measurement
                    if (
                      node.type === "file" &&
                      onStartLoadingAttributes &&
                      onUpdateBasketItemAttributes
                    ) {
                      onStartLoadingAttributes(node.id);
                      axios
                        .post(`${PROD_BACKEND_URL}/load-attrs/`, {
                          path: node.path,
                        })
                        .then((response) => {
                          console.log(
                            "Attributes loaded for auto-added live measurement:",
                            node.id,
                            // response.data,
                          );
                          onUpdateBasketItemAttributes(node.id, response.data);
                        })
                        .catch((error) => {
                          console.error(
                            "Error loading attributes for auto-added live measurement:",
                            error,
                          );
                          onUpdateBasketItemAttributes(node.id, {});
                        });
                    }
                  }
                });
              }
              if (toRemove.size > 0) {
                console.log(`Removed ${toRemove.size} ended measurement(s)`);

                // Clean up auto-added tracking for removed measurements
                toRemove.forEach((id) => {
                  autoAddedMeasurements.current.delete(id);
                });
              }

              return result;
            });
          }
        })
        .catch((error) => {
          console.error("Error polling live measurements:", error);
          // Don't show error toast for polling failures to avoid spam
        });
    }, 1000); // Poll every 1 second

    // Cleanup interval on unmount or when showLiveOnly changes
    return () => {
      console.log("Stopping live measurement polling");
      clearInterval(pollInterval);
    };
  }, [showLiveOnly]); // Only re-run when showLiveOnly changes

  // Process and filter data for headless-tree with sorting
  const processedData = useMemo(() => {
    const allNodes = new Map<string, TreeNode>();

    // Helper function to collect all leaf nodes (files) from the tree
    const collectLeafNodes = (nodes: TreeNode[]): TreeNode[] => {
      const leaves: TreeNode[] = [];

      const traverse = (node: TreeNode) => {
        if (node.type === "file") {
          leaves.push(node);
        }
        if (node.children) {
          node.children.forEach(traverse);
        }
      };

      nodes.forEach(traverse);
      return leaves;
    };

    // Helper function to sort nodes
    const sortNodes = (nodes: TreeNode[]): TreeNode[] => {
      return [...nodes].sort((a, b) => {
        let comparison = 0;

        switch (sortBy) {
          case "name": {
            // Use natural sort for names to handle numeric sequences properly
            comparison = a.name.localeCompare(b.name, undefined, {
              numeric: true,
              sensitivity: "base",
            });
            break;
          }
          case "timestamp": {
            const aTime = a.timestamp?.getTime() || 0;
            const bTime = b.timestamp?.getTime() || 0;
            comparison = aTime - bTime;
            break;
          }
          case "size": {
            const aSize = a.size || 0;
            const bSize = b.size || 0;
            comparison = aSize - bSize;
            break;
          }
          case "chrono": {
            // Chronological sorting by timestamp for dataset files only
            const aTime = a.timestamp?.getTime() || 0;
            const bTime = b.timestamp?.getTime() || 0;
            comparison = aTime - bTime;
            break;
          }
        }

        return sortDirection === "desc" ? -comparison : comparison;
      });
    };

    // Helper function to check if a node matches search
    const matchesSearch = (node: TreeNode): boolean => {
      if (!searchTerm) return true;
      return (
        node.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        node.path.toLowerCase().includes(searchTerm.toLowerCase())
      );
    };

    // Helper function to check if a node should be included based on filter
    const shouldIncludeNode = (node: TreeNode): boolean => {
      if (filterBy === "all") return true;
      if (filterBy === "zarr") {
        return (
          node.name.endsWith(".zarr") || (node.tags?.includes("zarr") ?? false)
        );
      }
      if (filterBy === "folder") {
        return node.type === "folder";
      }
      return true;
    };

    // Helper function to check if a folder has any matching children (recursively)
    const hasMatchingChildren = (node: TreeNode): boolean => {
      if (!node.children) return false;

      return node.children.some((child) => {
        const childMatches = shouldIncludeNode(child) && matchesSearch(child);
        if (childMatches) return true;
        if (child.type === "folder") return hasMatchingChildren(child);
        return false;
      });
    };

    const processNodes = (nodes: TreeNode[]): TreeNode[] => {
      // For chronological sorting, flatten to show only leaf nodes (dataset files)
      if (sortBy === "chrono") {
        const allLeaves = collectLeafNodes(nodes);
        const filteredLeaves = allLeaves.filter((node) => {
          const shouldInclude = shouldIncludeNode(node);
          const nodeMatchesSearch = matchesSearch(node);
          return shouldInclude && nodeMatchesSearch;
        });
        const sortedLeaves = sortNodes(filteredLeaves);

        // Add all leaf nodes to the allNodes map, ensuring they have no children
        sortedLeaves.forEach((leaf) => {
          const leafWithoutChildren = { ...leaf, children: undefined };
          allNodes.set(leaf.id, leafWithoutChildren);
        });

        return sortedLeaves.map((leaf) => ({ ...leaf, children: undefined }));
      }

      // Regular hierarchical processing for other sort types
      const sortedNodes = sortNodes(nodes);
      const processedNodes: TreeNode[] = [];

      sortedNodes.forEach((node) => {
        const shouldInclude = shouldIncludeNode(node);
        const nodeMatchesSearch = matchesSearch(node);
        const isFolder = node.type === "folder";
        const folderHasMatches = isFolder ? hasMatchingChildren(node) : false;

        // Include node if:
        // 1. It matches both the filter criteria AND search term, OR
        // 2. It's a folder that contains matching children (to maintain hierarchy)
        if (
          (shouldInclude && nodeMatchesSearch) ||
          (isFolder && folderHasMatches)
        ) {
          let processedNode = { ...node };

          // Process children if they exist
          if (node.children) {
            const processedChildren = processNodes(node.children);
            processedNode = {
              ...processedNode,
              children: processedChildren,
            };
          }

          allNodes.set(processedNode.id, processedNode);
          processedNodes.push(processedNode);
        }
      });

      return processedNodes;
    };

    const processedRootNodes = processNodes(apiData);
    return { allNodes, rootNodes: processedRootNodes };
  }, [apiData, filterBy, sortBy, sortDirection, searchTerm]);

  // Get root level nodes for tree (now comes from processedData)
  const rootNodes = useMemo(() => {
    return processedData.rootNodes;
  }, [processedData]);

  // Initialize headless-tree with search feature
  // Use a key that changes when switching between chrono and non-chrono modes
  // This forces the tree to completely re-initialize
  const treeKey = `${sortBy}-${filterBy}-${searchTerm}`;

  const tree = useTree<TreeNode>({
    rootItemId: "root",
    initialState: {
      expandedItems: ["root"], // NOTE: Always start with root expanded
    },
    // Use proxy instances for better performance with large datasets
    instanceBuilder: buildProxiedInstance,
    getItemName: (item) => item.getItemData().name,
    isItemFolder: (item) => {
      const itemData = item.getItemData();
      // In chrono mode, we only collect and show leaf nodes (files),
      // so no item should be a folder
      if (sortBy === "chrono") {
        return false;
      }
      return itemData.type === "folder";
    },
    dataLoader: {
      getItem: (itemId: string) => {
        if (itemId === "root") {
          return {
            id: "root",
            name: "Root",
            path: "/",
            type: "folder",
          } as TreeNode;
        }
        const node = processedData.allNodes.get(itemId);
        if (!node) {
          console.warn(`Node not found for id: ${itemId}, sortBy: ${sortBy}`);
          return {
            id: itemId,
            name: "Unknown",
            path: "/",
            type: "file",
          } as TreeNode;
        }
        return node;
      },
      getChildren: (itemId: string) => {
        if (itemId === "root") {
          return rootNodes.map((node: TreeNode) => node.id);
        }
        // In chrono mode, all items are leaf nodes (files) with no children
        if (sortBy === "chrono") {
          return [];
        }

        const node = processedData.allNodes.get(itemId);
        return node?.children?.map((child: TreeNode) => child.id) || [];
      },
    },
    indent: 12,
    features: [
      syncDataLoaderFeature,
      selectionFeature,
      expandAllFeature,
      hotkeysCoreFeature,
      propMemoizationFeature, // For better memoization of props
    ],
  });

  // Force tree refresh when switching to/from chrono mode
  useEffect(() => {
    console.log("Sort mode changed to:", sortBy);
    // Only force refresh when switching to/from chrono mode specifically
    // For regular sorting, let the processedData memo handle the re-sorting
    const timeoutId = setTimeout(() => {
      if (sortBy === "chrono") {
        // Switching to chrono mode - collapse everything since we show flat list
        tree.collapseAll();
        updateDirTreeState({ isExpanded: false });
      }
      // For other modes, don't interfere - let normal expansion logic handle it
    }, 10);

    return () => clearTimeout(timeoutId);
  }, [sortBy, tree, updateDirTreeState]);
  // Auto-expand tree when new data is loaded
  useEffect(() => {
    if (rootNodes.length > 0) {
      // Small delay to ensure tree is fully initialized
      const timeoutId = setTimeout(() => {
        // Don't expand in chrono mode since we only have leaf nodes
        if (sortBy !== "chrono") {
          // console.log(
          //   "Auto-expanding tree with",
          //   rootNodes.length,
          //   "root nodes",
          // );
          // Force a collapse/expand cycle to ensure tree shows items
          tree.collapseAll();
          setTimeout(() => {
            tree.expandAll();
            updateDirTreeState({ isExpanded: true });
          }, 50);
        } else {
          // In chrono mode, we don't need expansion since all items are files
          updateDirTreeState({ isExpanded: false });
        }
      }, 100); // Increase delay to 100ms to ensure tree is ready

      return () => clearTimeout(timeoutId);
    }
  }, [rootNodes, tree, sortBy, updateDirTreeState]);

  const handleSort = (newSortBy: typeof sortBy) => {
    if (sortBy === newSortBy) {
      updateDirTreeState({
        sortDirection: sortDirection === "asc" ? "desc" : "asc",
      });
    } else {
      updateDirTreeState({
        sortBy: newSortBy,
        // TODOLATER: Fix changing directions
        // For chronological view, default to descending (newest first)
        sortDirection: newSortBy === "chrono" ? "desc" : "asc",
      });
    }
  };

  const handleDragStart = (e: React.DragEvent, node: TreeNode) => {
    try {
      e.stopPropagation();

      // Check if the dragged item is selected
      const selectedNodes = getSelectedNodes();
      const isNodeSelected = selectedNodes.some(
        (selectedNode) => selectedNode.id === node.id,
      );

      // If the dragged item is selected and there are multiple selected items, drag all selected
      // Otherwise, just drag the single item
      const itemsToDrag =
        isNodeSelected && selectedNodes.length > 1 ? selectedNodes : [node];

      // Process each item to collect all valid items to drag
      const validItemsToDrag: TreeNode[] = [];

      // Process each item to drag
      itemsToDrag.forEach((item) => {
        if (item.type === "file") {
          // For files, add them directly
          validItemsToDrag.push(item);
        } else if (item.type === "folder") {
          // For folders, add all direct children that are dataset files (.zarr)
          const folderChildren = item.children || [];
          const datasetChildren = folderChildren.filter(
            (child) => child.type === "file" && child.path.endsWith(".zarr"),
          );
          validItemsToDrag.push(...datasetChildren);
        }
      });

      if (validItemsToDrag.length === 0) {
        const message =
          node.type === "folder"
            ? "No datasets found in folder"
            : "No valid files to drag";
        console.error(message);
        showToast(message, "warning");
        e.preventDefault();
        return;
      }

      const basketItems = validItemsToDrag.map((item) => ({
        id: item.id,
        name: item.name,
        path: item.path,
        type: item.type,
        size: item.size,
        timestamp: item.timestamp,
        tags: item.tags,
      }));

      // For single item, use the existing format for backwards compatibility
      // For multiple items, use an array
      const dragData = basketItems.length === 1 ? basketItems[0] : basketItems;

      e.dataTransfer.setData("application/json", JSON.stringify(dragData));
      e.dataTransfer.effectAllowed = "copy";
      setDraggedItem(node.id);
    } catch (error) {
      console.error("Error setting up drag data:", error);
      e.preventDefault();
      setTreeError("Error during drag operation");
    }
  };

  const onDoubleClick = (e: React.MouseEvent, node: TreeNode) => {
    e.stopPropagation();
    console.log("Double clicked node:", node.id);

    if (node.type === "folder") {
      // For folders, navigate to that path
      onPathChange?.(node.path);
      return;
    }

    // For files, add/remove from basket
    if (basketItems.some((item) => item.id === node.id)) {
      // If already in basket, remove it
      onRemoveBasketItem?.(node.id);
    } else {
      // Else, add to basket only if file, not folder
      // console.log("Adding to basket:", node);
      onAddToBasket?.(node);
    }
  };

  const handleDragEnd = () => {
    setDraggedItem(null);
  };

  // Get selected items from tree (both files and folders)
  const getSelectedNodes = (): TreeNode[] => {
    const selectedItemIds = tree.getSelectedItems();
    return selectedItemIds
      .map((item) => processedData.allNodes.get(item.getId()))
      .filter((node): node is TreeNode => node !== undefined);
  };

  // Add all selected files to basket (only files, not folders)
  const handleAddAllSelectedToBasket = () => {
    const selectedNodes = getSelectedNodes();
    // Filter to only files for basket functionality
    const selectedFiles = selectedNodes.filter((node) => node.type === "file");
    selectedFiles.forEach((node) => {
      if (!basketItems.some((item) => item.id === node.id)) {
        onAddToBasket?.(node);
      }
    });
  };

  // Download all selected files/folders as ZIP
  const handleDownloadAllSelected = async () => {
    const selectedNodes = getSelectedNodes();
    if (selectedNodes.length === 0) return;

    try {
      // console.log(
      //   "Downloading selected items:",
      //   selectedNodes.map((n) => n.path),
      // );

      // Call the backend download endpoint with multiple paths
      const response = await axios.post(
        `${PROD_BACKEND_URL}/download-multiple/`,
        { paths: selectedNodes.map((node) => node.path) },
        { responseType: "blob" },
      );

      // Create a download link
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement("a");
      link.href = url;
      const filename =
        selectedNodes.length === 1
          ? `${selectedNodes[0].name}.zip`
          : `selected_items_${new Date().toISOString().split("T")[0]}.zip`;
      link.setAttribute("download", filename);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      console.log("Download initiated successfully");
      showToast("Download started successfully", "success");
    } catch (error) {
      console.error("Error downloading selected items:", error);
      showToast("Failed to download selected items", "error");
    }
  };

  // Download a folder as ZIP
  const handleDownloadFolder = async (node: TreeNode) => {
    try {
      console.log("Downloading folder:", node.path);

      // Call the backend download endpoint for folders
      const response = await axios.post(
        `${PROD_BACKEND_URL}/download-folder/`,
        { path: node.path },
        { responseType: "blob" },
      );

      // Create a download link
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement("a");
      link.href = url;
      const filename = `${node.name}.zip`;
      link.setAttribute("download", filename);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      console.log("Folder download initiated successfully");
      showToast("Folder download started successfully", "success");
    } catch (error) {
      console.error("Error downloading folder:", error);
      showToast("Failed to download folder", "error");
    }
  };

  // Check if any selected files are already in basket (only applies to files, not folders)
  const selectedInBasket = (): boolean => {
    const selectedNodes = getSelectedNodes();
    const selectedFiles = selectedNodes.filter((node) => node.type === "file");
    return (
      selectedFiles.length > 0 &&
      selectedFiles.every((node) =>
        basketItems.some((item) => item.id === node.id),
      )
    );
  };

  // Check if cycling through datasets is enabled
  const isCyclingEnabled = (): boolean => {
    // Only enable if there's exactly one dataset in basket and onCycleDataset is provided
    const zarrItems = basketItems.filter(
      (item) => item.type === "file" && item.path.endsWith(".zarr"),
    );
    return zarrItems.length === 1 && !!onCycleDataset;
  };

  // Get the current dataset index in the processed data
  const getCurrentDatasetIndex = (): number => {
    if (!isCyclingEnabled()) return -1;

    const zarrItem = basketItems.find(
      (item) => item.type === "file" && item.path.endsWith(".zarr"),
    );
    if (!zarrItem) return -1;

    const zarrNodes = Array.from(processedData.allNodes.values()).filter(
      (node) => node.type === "file" && node.path.endsWith(".zarr"),
    );

    return zarrNodes.findIndex((node) => node.path === zarrItem.path);
  };

  // Get total number of datasets
  const getTotalDatasets = (): number => {
    const zarrNodes = Array.from(processedData.allNodes.values()).filter(
      (node) => node.type === "file" && node.path.endsWith(".zarr"),
    );
    return zarrNodes.length;
  };

  // Handle cycling through datasets
  const handleCycleDataset = (direction: "prev" | "next") => {
    if (!isCyclingEnabled() || !onCycleDataset) return;

    const zarrNodes = Array.from(processedData.allNodes.values()).filter(
      (node) => node.type === "file" && node.path.endsWith(".zarr"),
    );

    if (zarrNodes.length === 0) return;

    const currentIndex = getCurrentDatasetIndex();
    if (currentIndex === -1) return;

    let nextIndex: number;
    if (direction === "next") {
      nextIndex = (currentIndex + 1) % zarrNodes.length;
    } else {
      nextIndex = currentIndex === 0 ? zarrNodes.length - 1 : currentIndex - 1;
    }

    const nextNode = zarrNodes[nextIndex];
    if (nextNode) {
      // Remove current dataset from basket
      const currentItem = basketItems.find(
        (item) => item.type === "file" && item.path.endsWith(".zarr"),
      );
      if (currentItem) {
        onRemoveBasketItem?.(currentItem.id);
      }

      // Add new dataset to basket
      onAddToBasket?.(nextNode);

      // Call the cycle callback with direction info
      onCycleDataset(direction);
    }
  };

  // Call onSelectNode when selection changes (for single selection)
  useEffect(() => {
    const selectedItems = tree.getSelectedItems();
    if (selectedItems.length === 1) {
      const selectedNode = processedData.allNodes.get(selectedItems[0].getId());
      if (selectedNode) {
        onSelectNode?.(selectedNode);
      }
    }
  }, [tree, processedData.allNodes, onSelectNode]);

  // Global Shift+R keybind to refresh directory
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isExactShiftR =
        e.shiftKey &&
        !e.ctrlKey &&
        !e.altKey &&
        !e.metaKey &&
        (e.key === "r" || e.key === "R");

      if (isExactShiftR) {
        e.preventDefault();
        if (path && path.trim() && !isLoading) {
          loadDirectoryData(path, true);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [path, isLoading, loadDirectoryData]);

  // Show error state if there's a tree error
  if (treeError) {
    return (
      <div className="p-4 bg-red-50 border border-red-200 rounded-md">
        <p className="text-red-800 text-sm">{treeError}</p>
        <button
          type="button"
          onClick={() => {
            setTreeError(null);
            if (path && path.trim()) {
              loadDirectoryData(path);
            }
          }}
          className="mt-2 px-3 py-1 bg-red-600 text-white text-xs rounded hover:bg-red-700"
        >
          Try Again
        </button>
      </div>
    );
  }

  // Show loading state
  if (isLoading) {
    return (
      <div className="p-4 text-center text-gray-500">
        <div className="mb-2">
          <LoaderCircle
            className="inline-block mr-2 animate-spin text-blue-500 justify-center"
            size={22}
          />
          Loading directory structure...
        </div>
      </div>
    );
  }

  const TIPS = (
    <div className="p-0 flex flex-wrap">
      <div className="space-y-1 text-sm">
        <div>• Double-click folders to navigate</div>
        <div>• Ctrl/Shift + Click for multi-selection</div>
        <div>• Drag datasets to basket or use + button</div>
        <div>• Drag datasets to Notes to add paths to note</div>
        <div>• Drag folders to add all its contents to basket</div>
        <div>• Use ↑/↓ buttons to cycle through datasets</div>
        <div>• Toggle button to view live measurements (auto-refreshes)</div>
        <div>• Shift + R to refresh directory</div>
        <div>
          • Global: Shift+H HeatMap, Shift+L LinePlot, Shift+P Plot,
          Alt+Shift+C Clear Composer
        </div>
        <div>
          • Global: Alt+Shift+B Clear Basket, Alt+Shift+V Clear Viewer,
          Shift+E Toggle Side Panel, Shift+M Toggle Metadata, Shift+N Toggle
          Notes
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col h-full w-full">
      {/* Fixed Toolbar Section */}
      <div className="flex-shrink-0 space-y-2 mb-2 w-full">
        {/* Search Bar */}
        <div className="relative">
          <Search
            className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400"
            size={16}
          />
          <input
            type="text"
            placeholder="Search files and folders..."
            value={searchInput}
            onChange={(e) =>
              updateDirTreeState({ searchInput: e.target.value })
            }
            className="w-full pl-10 pr-10 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
          />
          {searchInput && (
            <button
              type="button"
              onClick={() => {
                updateDirTreeState({ searchInput: "", searchTerm: "" });
              }}
              className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
              title="Clear search"
            >
              <X size={16} />
            </button>
          )}
        </div>

        {/* Sort and Filter Controls */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex flex-col items-center w-full gap-1">
            {/* Row 1: Sort buttons */}
            <div className="flex items-center justify-center w-full mb-1">
              <div className="flex space-x-1">
                {(["name", "timestamp", "size", "chrono"] as const).map(
                  (sort) => (
                    <button
                      type="button"
                      key={sort}
                      onClick={() => handleSort(sort)}
                      className={`px-2 py-1 text-xs rounded flex items-center space-x-1 ${
                        sortBy === sort
                          ? "bg-blue-100 text-blue-800"
                          : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                      }`}
                    >
                      <span className="capitalize">
                        {sort === "timestamp"
                          ? "date"
                          : sort === "chrono"
                            ? "Chrono"
                            : sort}
                      </span>
                      {sortBy === sort &&
                        (sortDirection === "asc" ? (
                          <SortAsc size={10} />
                        ) : (
                          <SortDesc size={10} />
                        ))}
                    </button>
                  ),
                )}
              </div>
            </div>

            {/* Row 2: Toolbar buttons */}
            <div className="flex items-center justify-center w-full gap-1">
              {/* LIVE Toggle Button */}
              <Tooltip
                content={
                  showLiveOnly
                    ? "Showing only live measurements (refreshes every second)"
                    : "Show only live measurements (refreshes every second)"
                }
                position="right"
              >
                <button
                  type="button"
                  onClick={() => {
                    updateDirTreeState({ showLiveOnly: !showLiveOnly });
                  }}
                  className={`px-2 py-1 rounded-md transition-all duration-200 ${
                    showLiveOnly
                      ? "bg-gradient-to-r from-green-500 to-emerald-500 text-white shadow-md hover:shadow-lg hover:from-green-600 hover:to-emerald-600"
                      : "bg-blue-50 text-gray-600 hover:bg-blue-100 border border-blue-200"
                  }`}
                  title={
                    showLiveOnly
                      ? "Show all files"
                      : "Show only live measurements (refreshes every second)"
                  }
                >
                  <Radio
                    size={16}
                    className={showLiveOnly ? "animate-pulse" : ""}
                  />
                </button>
              </Tooltip>

              {/* Tips */}
              <Tooltip
                content={TIPS}
                position="right"
                className="px-2 py-1 text-gray-600 hover:text-yellow-600 hover:bg-yellow-200 rounded disabled:opacity-50 transition-colors"
              >
                <Lightbulb size={16} />
              </Tooltip>

              {/* Refresh Button */}
              <Tooltip content="Refresh directory" position="top">
                <button
                  type="button"
                  onClick={() => {
                    if (path && path.trim()) {
                      // Force reload bypassing cache
                      loadDirectoryData(path, true);
                    }
                  }}
                  disabled={isLoading || !path || !path.trim()}
                  className="px-2 py-1 text-[#6ea030] bg-[#f4fae8] hover:bg-[#dff1bd] rounded disabled:opacity-50 transition-colors"
                  title="Refresh directory"
                >
                  <RefreshCw
                    size={16}
                    className={isLoading ? "animate-spin" : ""}
                  />
                </button>
              </Tooltip>

              {/* Expand/Collapse All Toggle */}
              <Tooltip
                content={
                  sortBy === "chrono"
                    ? "Unavailable in chronological view"
                    : isExpanded
                      ? "Collapse all"
                      : "Expand all"
                }
                position="top"
              >
                <button
                  type="button"
                  onClick={() => {
                    if (isExpanded) {
                      tree.collapseAll();
                      updateDirTreeState({ isExpanded: false });
                    } else {
                      tree.expandAll();
                      updateDirTreeState({ isExpanded: true });
                    }
                  }}
                  disabled={sortBy === "chrono"}
                  className="px-2 py-1 text-gray-600 hover:bg-blue-200 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  title={
                    sortBy === "chrono"
                      ? "Unavailable in chronological view"
                      : isExpanded
                        ? "Collapse all"
                        : "Expand all"
                  }
                >
                  {isExpanded ? <Minimize size={16} /> : <Expand size={16} />}
                </button>
              </Tooltip>

              {/* Explorer Filters */}
              <Tooltip content="Toggle filters" position="top">
                <button
                  type="button"
                  onClick={() =>
                    updateDirTreeState({ showFilters: !showFilters })
                  }
                  className={`px-2 py-1 rounded ${
                    showFilters
                      ? "bg-blue-100 text-blue-800"
                      : "text-gray-600 hover:bg-blue-200 rounded transition-colors"
                  }`}
                  title="Toggle filters"
                >
                  <Filter size={16} />
                </button>
              </Tooltip>

              {/* Add all selected to basket button */}
              <Tooltip
                content={
                  getSelectedNodes().filter((n) => n.type === "file").length ===
                  0
                    ? "Select files first"
                    : selectedInBasket()
                      ? "All selected files already in basket"
                      : `Add ${
                          getSelectedNodes().filter((n) => n.type === "file")
                            .length
                        } selected file${
                          getSelectedNodes().filter((n) => n.type === "file")
                            .length > 1
                            ? "s"
                            : ""
                        } to basket`
                }
                position="top"
              >
                <button
                  type="button"
                  onClick={handleAddAllSelectedToBasket}
                  disabled={
                    getSelectedNodes().filter((n) => n.type === "file")
                      .length === 0 || selectedInBasket()
                  }
                  className="px-2 py-1 text-gray-600 hover:bg-green-200 rounded disabled:opacity-50 transition-colors"
                  title="Add all selected files to basket"
                >
                  <Plus size={16} />
                </button>
              </Tooltip>

              {/* Download all selected button */}
              <Tooltip
                content={
                  getSelectedNodes().length === 0
                    ? "Select items first"
                    : `Download ${getSelectedNodes().length} selected item${
                        getSelectedNodes().length > 1 ? "s" : ""
                      } as ZIP`
                }
                position="top"
              >
                <button
                  type="button"
                  onClick={handleDownloadAllSelected}
                  disabled={getSelectedNodes().length === 0}
                  className="px-2 py-1 text-gray-600 hover:bg-blue-200 rounded disabled:opacity-50 transition-colors"
                  title="Download all selected items as ZIP"
                >
                  <Download size={16} />
                </button>
              </Tooltip>

              {/* Dataset cycling buttons */}
              <Tooltip
                content={
                  isCyclingEnabled()
                    ? `Previous dataset (${
                        getCurrentDatasetIndex() + 1
                      }/${getTotalDatasets()})`
                    : "Add exactly one dataset to basket to enable cycling"
                }
                position="top"
              >
                <button
                  type="button"
                  onClick={() => handleCycleDataset("prev")}
                  disabled={!isCyclingEnabled()}
                  className="px-2 py-1 text-gray-600 hover:bg-purple-200 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                  title="Previous dataset"
                >
                  <MoveUp size={16} />
                </button>
              </Tooltip>

              <Tooltip
                content={
                  isCyclingEnabled()
                    ? `Next dataset (${
                        getCurrentDatasetIndex() + 1
                      }/${getTotalDatasets()})`
                    : "Add exactly one dataset to basket to enable cycling"
                }
                position="top"
              >
                <button
                  type="button"
                  onClick={() => handleCycleDataset("next")}
                  disabled={!isCyclingEnabled()}
                  className="px-2 py-1 text-gray-600 hover:bg-purple-200 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                  title="Next dataset"
                >
                  <MoveDown size={16} />
                </button>
              </Tooltip>
            </div>
          </div>
        </div>

        {/* Filter Controls */}
        {showFilters && (
          <div className="p-1 bg-gray-50 rounded-md">
            <div className="flex items-center space-x-2">
              <div className="flex space-x-1 w-full justify-center items-center">
                {(["all", "folder", "zarr"] as const).map((filter) => (
                  <button
                    type="button"
                    key={filter}
                    onClick={() => updateDirTreeState({ filterBy: filter })}
                    className={`px-2 py-1 text-xs rounded ${
                      filterBy === filter
                        ? "bg-blue-100 text-blue-800"
                        : "bg-white text-gray-600 hover:bg-gray-100"
                    }`}
                  >
                    {filter === "all" ? "All" : filter.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Scrollable Tree View - Always Virtualized */}
      <div className="flex-1 min-h-0">
        <VirtualizedTreeView
          tree={tree}
          treeKey={treeKey}
          rootNodes={rootNodes}
          onAddToBasket={onAddToBasket}
          onRemoveBasketItem={onRemoveBasketItem}
          onOpenNotes={onOpenNotes}
          onDownload={onDownload}
          onDownloadFolder={handleDownloadFolder}
          draggedItem={draggedItem}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDoubleClick={onDoubleClick}
          searchTerm={searchTerm}
          basketItems={basketItems}
          path={path}
        />
      </div>
    </div>
  );
};

// Virtualized Tree View Component
interface VirtualizedTreeViewProps {
  tree: TreeInstance<TreeNode>;
  treeKey: string;
  rootNodes: TreeNode[];
  onAddToBasket?: (node: TreeNode) => void;
  onRemoveBasketItem?: (id: string) => void;
  onOpenNotes?: (node: TreeNode) => void;
  onDownload?: (node: TreeNode) => void;
  onDownloadFolder?: (node: TreeNode) => void;
  draggedItem: string | null;
  onDragStart: (e: React.DragEvent, node: TreeNode) => void;
  onDragEnd: () => void;
  onDoubleClick: (e: React.MouseEvent, node: TreeNode) => void;
  searchTerm?: string;
  basketItems?: BasketItem[];
  path?: string;
}

const VirtualizedTreeView = forwardRef<
  Virtualizer<HTMLDivElement, Element>,
  VirtualizedTreeViewProps
>(
  (
    {
      tree,
      treeKey,
      rootNodes,
      onAddToBasket,
      onRemoveBasketItem,
      onOpenNotes,
      onDownload,
      onDownloadFolder,
      draggedItem,
      onDragStart,
      onDragEnd,
      onDoubleClick,
      searchTerm,
      basketItems,
      path,
    },
    ref,
  ) => {
    const parentRef = useRef<HTMLDivElement | null>(null);

    // Get all items from the tree (flattened structure)
    const treeItems = tree.getItems();

    const virtualizer = useVirtualizer({
      count: treeItems.length,
      getScrollElement: () => parentRef.current,
      estimateSize: () => 35, // Estimated height per item - adjust based on your actual item height
      // Add overscan for smoother scrolling - renders extra items above/below viewport
      overscan: 10,
      // Enable smooth scrolling for better UX
      scrollPaddingStart: 0,
      scrollPaddingEnd: 0,
    });

    useImperativeHandle(ref, () => virtualizer);

    return (
      <div
        ref={parentRef}
        className="h-full overflow-auto border border-gray-200 rounded-md bg-white"
      >
        {rootNodes.length > 0 ? (
          <div
            {...tree.getContainerProps()}
            className="text-left"
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              width: "100%",
              position: "relative",
            }}
            key={treeKey} // Force re-render when tree context changes
          >
            {virtualizer.getVirtualItems().map((virtualItem) => {
              const item = treeItems[virtualItem.index];
              if (!item) return null;

              // Get props outside of the ref callback to avoid issues
              const props = item.getProps();

              return (
                <div
                  {...props}
                  key={virtualItem.key}
                  data-index={virtualItem.index}
                  ref={(r) => {
                    virtualizer.measureElement(r);
                    props.ref(r);
                  }}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${virtualItem.start}px)`,
                  }}
                >
                  <TreeItemComponent
                    item={item}
                    onAddToBasket={onAddToBasket}
                    onRemoveBasketItem={onRemoveBasketItem}
                    onOpenNotes={onOpenNotes}
                    onDownload={onDownload}
                    onDownloadFolder={onDownloadFolder}
                    draggedItem={draggedItem}
                    onDragStart={onDragStart}
                    onDragEnd={onDragEnd}
                    onDoubleClick={onDoubleClick}
                    searchTerm={searchTerm}
                    basketItems={basketItems}
                  />
                </div>
              );
            })}
          </div>
        ) : (
          <div className="p-4 text-center text-gray-500 text-sm">
            <div className="flex items-center justify-center gap-2 mb-2">
              <SearchXIcon className="text-red-400" size={16} />
              <span>No items to display</span>
            </div>
            <div className="text-xs mt-1">
              {path
                ? "Try a different path or check your filters"
                : "Enter a path to load directory structure"}
            </div>
          </div>
        )}
      </div>
    );
  },
);

VirtualizedTreeView.displayName = "VirtualizedTreeView";

// Tree Item Component using headless-tree item API
interface TreeItemComponentProps {
  item: ItemInstance<TreeNode>;
  onAddToBasket?: (node: TreeNode) => void;
  onRemoveBasketItem?: (id: string) => void;
  onOpenNotes?: (node: TreeNode) => void;
  onDownload?: (node: TreeNode) => void;
  onDownloadFolder?: (node: TreeNode) => void;
  draggedItem: string | null;
  onDragStart: (e: React.DragEvent, node: TreeNode) => void;
  onDragEnd: () => void;
  // Double click should add to basket
  onDoubleClick: (e: React.MouseEvent, node: TreeNode) => void;
  searchTerm?: string;
  basketItems?: BasketItem[]; // Items already in the basket
  // liveStatusMap removed
}

const TreeItemComponent = ({
  item,
  onAddToBasket,
  onRemoveBasketItem,
  onOpenNotes,
  onDownload,
  onDownloadFolder,
  draggedItem,
  onDragStart,
  onDragEnd,
  onDoubleClick,
  searchTerm = "",
  basketItems = [],
}: TreeItemComponentProps) => {
  const { copyToClipboard: copyFNameToClipboard, isCopied: isFNameCopied } =
    useCopyToClipboard();
  const { copyToClipboard: copyPathToClipboard, isCopied: isPathCopied } =
    useCopyToClipboard();
  const nodeData = item.getItemData() as TreeNode;
  const isExpanded = item.isExpanded();
  const isFocused = item.isFocused();
  const isSelected = item.isSelected();
  const isFolder = item.isFolder();

  // Check if this item is in the basket
  const isInBasket = basketItems.some(
    (basketItem) => basketItem.id === nodeData.id,
  );

  // Skip rendering the root item
  if (nodeData.id === "root") {
    return null;
  }

  // Since filtering is now handled at the processing level,
  // we don't need to filter here - just render the item

  // Highlight search term in name
  const highlightSearchTerm = (text: string, term: string) => {
    if (!term) return text;
    const regex = new RegExp(`(${term})`, "gi");
    const parts = text.split(regex);
    return parts.map((part, index) =>
      regex.test(part) ? (
        <mark key={index} className="bg-yellow-200 px-0.5 rounded">
          {part}
        </mark>
      ) : (
        part
      ),
    );
  };

  return (
    <div
      {...item.getProps()}
      className={`w-full flex items-center group hover:bg-gray-50 transition-colors border-l-2 ${
        isInBasket
          ? "border-l-green-500 bg-green-50"
          : isFocused
            ? "border-l-blue-300 bg-blue-50"
            : isSelected
              ? "border-l-blue-500 bg-blue-100"
              : "border-transparent"
      } ${draggedItem === nodeData.id ? "dragging opacity-50" : ""}`}
      data-level={item.getItemMeta().level}
      draggable={true} // Allow both files and folders to be draggable
      onDragStart={(e) => onDragStart(e, nodeData)}
      onDragEnd={onDragEnd}
      onDoubleClick={(e) => onDoubleClick(e, nodeData)}
    >
      <div
        className={`flex items-center py-1 pr-2 transition-colors flex-1 text-sm min-w-0 ${
          isFolder ? "font-medium text-gray-800" : "text-gray-600 pl-6"
        }`}
      >
        {/* Drag Handle */}
        <GripVertical
          size={16}
          className="text-gray-300 mr-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
        />

        {/* Expand/Collapse Icon */}
        {isFolder && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (isExpanded) {
                item.collapse();
              } else {
                item.expand();
              }
            }}
            className="mr-1 flex-shrink-0 p-1 hover:bg-gray-200 rounded transition-colors"
            aria-label={isExpanded ? "Collapse folder" : "Expand folder"}
          >
            {isExpanded ? (
              <ChevronDown size={14} className="text-gray-500" />
            ) : (
              <ChevronRight size={14} className="text-gray-500" />
            )}
          </button>
        )}

        {/* File/Folder Icon */}
        <span className="mr-2 flex-shrink-0 text-sm">
          {isFolder ? (
            isExpanded ? (
              <FolderOpenIcon size={16} className="text-blue-500" />
            ) : (
              <FolderClosedIcon size={16} className="text-blue-900" />
            )
          ) : (
            <DatabaseIcon size={16} className="text-green-500" />
          )}
          {/* Live indicator for zarr datasets (prefer liveStatusMap updates from WS) */}
          {/* live indicator removed */}
        </span>

        {/* Name with Tooltip - display with search highlighting */}
        <div className="flex-1 min-w-0">
          <span
            className={`text-sm truncate block ${
              nodeData.name.endsWith(".zarr")
                ? "text-purple-700 font-medium"
                : "text-gray-800"
            }`}
          >
            {highlightSearchTerm(nodeData.name, searchTerm)}
          </span>
          {/* </Tooltip> */}
        </div>
      </div>

      {/* For Datasets */}
      {!isFolder && (
        <div className="flex items-center px-1 py-0.5 rounded-md">
          {/* className="flex items-center space-x-1 opacity-0 group-hover:backdrop-blur-md group-hover:bg-white/90 group-hover:opacity-100 transition-opacity px-1 py-0.5 rounded-md"> */}
          {/* Copy filename button */}
          <Tooltip content="Copy filename" position="top">
            <button
              type="button"
              onClick={async (e) => {
                e.stopPropagation();
                await copyFNameToClipboard(nodeData.name);
              }}
              className="p-1 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors flex-shrink-0"
              aria-label={`Copy filename: ${nodeData.name}`}
            >
              {isFNameCopied ? (
                <Check size={14} className="text-green-600" />
              ) : (
                <Copy size={14} />
              )}
            </button>
          </Tooltip>

          {/* Copy full path button */}
          <Tooltip content="Copy full path" position="top">
            <button
              type="button"
              onClick={async (e) => {
                e.stopPropagation();
                await copyPathToClipboard(nodeData.path);
              }}
              className="p-1 text-gray-400 hover:text-orange-600 hover:bg-orange-50 rounded transition-colors flex-shrink-0"
              aria-label={`Copy full path: ${nodeData.path}`}
            >
              {isPathCopied ? (
                <Check size={14} className="text-green-600" />
              ) : (
                <Copy size={14} />
              )}
            </button>
          </Tooltip>

          {/* Download Button - only for zarr files */}
          {nodeData.path.endsWith(".zarr") && (
            <Tooltip content="Download dataset" position="top">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onDownload?.(nodeData);
                }}
                className="p-1 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded transition-colors flex-shrink-0"
                aria-label="Download dataset"
              >
                <Download size={14} />
              </button>
            </Tooltip>
          )}

          {/* Open Notes Button - only for zarr files */}
          {nodeData.path.endsWith(".zarr") && (
            <Tooltip content="Open notes" position="top">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenNotes?.(nodeData);
                }}
                className="p-1 text-gray-400 hover:text-purple-600 hover:bg-purple-50 rounded transition-colors flex-shrink-0"
                aria-label="Open notes"
              >
                <FileText size={14} />
              </button>
            </Tooltip>
          )}

          {/* Add/Remove Basket Button - only for files */}
          <Tooltip
            content={isInBasket ? "Remove from basket" : "Add to basket"}
            position="top"
          >
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (isInBasket) {
                  onRemoveBasketItem?.(nodeData.id);
                } else {
                  onAddToBasket?.(nodeData);
                }
              }}
              className={`p-1 rounded transition-colors flex-shrink-0 ${
                isInBasket
                  ? "text-red-500 hover:text-red-700 hover:bg-red-50"
                  : "text-gray-400 hover:text-blue-600 hover:bg-blue-100"
              }`}
              aria-label={isInBasket ? "Remove from basket" : "Add to basket"}
            >
              {isInBasket ? <Minus size={14} /> : <Plus size={14} />}
            </button>
          </Tooltip>
        </div>
      )}

      {/* For Folders */}
      {isFolder && (
        <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity mr-1">
          {/* Copy folder name button */}
          <Tooltip content="Copy folder name" position="top">
            <button
              type="button"
              onClick={async (e) => {
                e.stopPropagation();
                await copyFNameToClipboard(nodeData.name);
              }}
              className="p-1 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors flex-shrink-0"
              aria-label={`Copy folder name: ${nodeData.name}`}
            >
              {isFNameCopied ? (
                <Check size={14} className="text-green-600" />
              ) : (
                <Copy size={14} />
              )}
            </button>
          </Tooltip>

          {/* Copy full path button */}
          <Tooltip content="Copy folder path" position="top">
            <button
              type="button"
              onClick={async (e) => {
                e.stopPropagation();
                await copyPathToClipboard(nodeData.path);
              }}
              className="p-1 text-gray-400 hover:text-orange-600 hover:bg-orange-50 rounded transition-colors flex-shrink-0"
              aria-label={`Copy folder path: ${nodeData.path}`}
            >
              {isPathCopied ? (
                <Check size={14} className="text-green-600" />
              ) : (
                <Copy size={14} />
              )}
            </button>
          </Tooltip>

          {/* Download folder button */}
          <Tooltip content="Download folder as ZIP" position="top">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDownloadFolder?.(nodeData);
              }}
              className="p-1 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded transition-colors flex-shrink-0"
              aria-label={`Download folder: ${nodeData.name}`}
            >
              <Download size={14} />
            </button>
          </Tooltip>
        </div>
      )}
    </div>
  );
};

export default DirTree;

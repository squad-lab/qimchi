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
  FileArchive,
  FileText,
  HardDrive,
  Table,
  SearchXIcon,
  X,
  NotebookPen,
  LoaderCircle,
  Download,
  MoveUp,
  MoveDown,
  Eye,
  EyeOff,
  Heart,
  HeartCrack,
  Trash2,
  Tag as TagIcon,
} from "lucide-react";

// Local imports
import { TreeNode, convertApiNode } from "./treeUtils";
import { useCopyToClipboard } from "../hooks/useCopyToClipboard";
import { useToast } from "../hooks/useToast";
import { useSidebarStore } from "../stores/sidebarStore";
import { useLibraryStore, normalizePath } from "../stores/libraryStore";
import TagPopover from "./TagPopover";
import TagFilterMenu from "./TagFilterMenu";
import Tooltip from "./Tooltip";
import { BasketItem } from "./Basket";
import type { AttrData } from "./interfaces";
import { useShortcut } from "../hooks/useGlobalShortcuts";
import {
  detectDatasetKind,
  hasDatasetTag,
  isDatasetNode,
  isDatasetPath,
  isSqliteContainerPath,
} from "../utils/datasetPaths";
import { finishArchiveDownload } from "../utils/download";
import { formatQanaryDatasetName } from "../utils/measurementDisplay";

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
  onOpenSampleNotes?: (node: TreeNode) => void; // For opening pooled sample notes
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
// Explorer layout mode. Rows gain a date column once the tree actually has
// room for them -- reached either by dragging the sidebar wider or by the
// full-window Explorer view. The switch is a class on the DirTree root plus a
// CSS rule (see .qimchi-row-meta in index.css) rather than a context, so the
// row component stays untouched by the width state.
const WIDE_LAYOUT_MIN_WIDTH = 640;

// Fixed-width, locale-independent stamp: the column is a scan-and-compare aid,
// so a stable "2026-03-14 08:32" beats a localised string that changes length
// with the month name and gets truncated mid-word.
const pad = (value: number) => String(value).padStart(2, "0");

const formatRowTimestamp = (timestamp?: Date) => {
  if (!timestamp || Number.isNaN(timestamp.getTime())) return "";
  const date = `${timestamp.getFullYear()}-${pad(timestamp.getMonth() + 1)}-${pad(
    timestamp.getDate(),
  )}`;
  return `${date} ${pad(timestamp.getHours())}:${pad(timestamp.getMinutes())}`;
};

const DirTree = ({
  path,
  onSelectNode,
  basketItems = [],
  onAddToBasket,
  onRemoveBasketItem,
  onPathChange,
  onOpenNotes,
  onOpenSampleNotes,
  onDownload,
  onCycleDataset,
  onStartLoadingAttributes,
  onUpdateBasketItemAttributes,
}: DirTreeProps) => {
  const { showToast } = useToast();

  // Width-driven layout mode. A callback ref (rather than useRef) because the
  // component returns early while loading/erroring, so the node identity has to
  // re-trigger the observer when the real tree finally mounts.
  const [rootEl, setRootEl] = useState<HTMLDivElement | null>(null);
  const [isWide, setIsWide] = useState(false);

  useEffect(() => {
    if (!rootEl) return;
    const observer = new ResizeObserver(([entry]) => {
      setIsWide(entry.contentRect.width >= WIDE_LAYOUT_MIN_WIDTH);
    });
    observer.observe(rootEl);
    return () => observer.disconnect();
  }, [rootEl]);

  // Use Zustand store for persistent state
  const { componentStates, updateDirTreeState } = useSidebarStore();
  const {
    searchInput,
    searchTerm,
    sortBy,
    sortDirection,
    filterBy,
    showFilters,
    lastPath,
    showLiveOnly,
    hiddenLiveMeasurementIds = [],
    expandedNodeIds = [],
    // lastPath, // TODO: Use this to track the last loaded path
  } = componentStates.dirTree;

  // Library (heart/trash/tag) state + DirTree filters (see stores/libraryStore).
  const libStatesByPath = useLibraryStore((s) => s.statesByPath);
  const filterHeartedOnly = useLibraryStore((s) => s.filterHeartedOnly);
  const hideTrashed = useLibraryStore((s) => s.hideTrashed);
  const selectedTagIds = useLibraryStore((s) => s.selectedTagIds);
  const libraryTags = useLibraryStore((s) => s.tags);
  const setFilterHeartedOnly = useLibraryStore((s) => s.setFilterHeartedOnly);
  const setHideTrashed = useLibraryStore((s) => s.setHideTrashed);
  const toggleSelectedTag = useLibraryStore((s) => s.toggleSelectedTag);
  const applyHeartMany = useLibraryStore((s) => s.applyHeartMany);
  const applyTrashMany = useLibraryStore((s) => s.applyTrashMany);
  const applyTagMany = useLibraryStore((s) => s.applyTagMany);
  const createLibraryTag = useLibraryStore((s) => s.createTag);
  const renameLibraryTag = useLibraryStore((s) => s.renameTag);
  const deleteLibraryTag = useLibraryStore((s) => s.deleteTag);
  const [bulkTagAnchor, setBulkTagAnchor] = useState<HTMLElement | null>(null);
  const clearSelectedTags = useLibraryStore((s) => s.clearSelectedTags);
  const [tagMenuOpen, setTagMenuOpen] = useState(false);
  const tagFilterBtnRef = useRef<HTMLButtonElement | null>(null);
  const fetchLibraryStates = useLibraryStore((s) => s.fetchStates);
  const checkDbStatus = useLibraryStore((s) => s.checkDbStatus);
  const dbAvailable = useLibraryStore((s) => s.dbAvailable);
  const dbError = useLibraryStore((s) => s.dbError);

  // Confirm the library DB is up before loading persisted hearts/trash: if it
  // isn't, the controls are disabled rather than failing on click.
  useEffect(() => {
    void checkDbStatus().then(() => fetchLibraryStates());
  }, [checkDbStatus, fetchLibraryStates]);

  // Split the search box into "#tag" tokens and plain text, so tags can be
  // filtered by typing as well as from the Tags dropdown.
  // "#cooldown sweep" = tag AND name-contains.
  const { searchTags, searchText, unknownSearchTags } = useMemo(() => {
    const raw = searchTerm ?? "";
    const wanted: string[] = [];
    // Tag names may contain spaces (e.g. "Custom tag")
    const tagPattern = /#"([^"]+)"|#(\S+)/g;
    let match: RegExpExecArray | null;
    while ((match = tagPattern.exec(raw)) !== null) {
      wanted.push((match[1] ?? match[2]).toLowerCase());
    }
    const rest = raw.replace(tagPattern, " ").split(/\s+/).filter(Boolean);
    const byName = new Map(libraryTags.map((t) => [t.name.toLowerCase(), t.id]));
    const ids: number[] = [];
    const unknown: string[] = [];
    for (const name of wanted) {
      const id = byName.get(name);
      if (id === undefined) unknown.push(name);
      else ids.push(id);
    }
    return {
      searchTags: ids,
      searchText: rest.join(" "),
      unknownSearchTags: unknown,
    };
  }, [searchTerm, libraryTags]);

  // Tags from the dropdown and from the search box combine (match ANY, as
  // before).
  const effectiveTagIds = useMemo(
    () => Array.from(new Set([...selectedTagIds, ...searchTags])),
    [selectedTagIds, searchTags],
  );

  // Local state that doesn't need persistence
  const [draggedItem, setDraggedItem] = useState<string | null>(null);
  const [treeError, setTreeError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [apiData, setApiData] = useState<TreeNode[]>([]);
  const hiddenLiveIdsRef = useRef<Set<string>>(new Set(hiddenLiveMeasurementIds));
  const latestLiveMeasurementsRef = useRef<TreeNode[]>([]);
  const autoAddedMeasurements = useRef<Set<string>>(new Set());
  const basketItemsRef = useRef<BasketItem[]>(basketItems);
  const onAddToBasketRef = useRef<typeof onAddToBasket>(onAddToBasket);
  const onStartLoadingAttributesRef =
    useRef<typeof onStartLoadingAttributes>(onStartLoadingAttributes);
  const onUpdateBasketItemAttributesRef = useRef<typeof onUpdateBasketItemAttributes>(
    onUpdateBasketItemAttributes,
  );

  useEffect(() => {
    hiddenLiveIdsRef.current = new Set(hiddenLiveMeasurementIds);
  }, [hiddenLiveMeasurementIds]);

  const setHiddenLiveIds = useCallback(
    (ids: Set<string>) => {
      hiddenLiveIdsRef.current = ids;
      updateDirTreeState({ hiddenLiveMeasurementIds: Array.from(ids) });
    },
    [updateDirTreeState],
  );

  const restoreHiddenLiveMeasurement = useCallback(
    (measurementId?: string) => {
      const nextHidden = new Set(hiddenLiveIdsRef.current);
      if (measurementId) {
        nextHidden.delete(measurementId);
      } else {
        nextHidden.clear();
      }
      setHiddenLiveIds(nextHidden);
      setApiData(latestLiveMeasurementsRef.current.filter((node) => !nextHidden.has(node.id)));
    },
    [setHiddenLiveIds],
  );

  const hideLiveMeasurement = useCallback(
    (node: TreeNode) => {
      const nextHidden = new Set(hiddenLiveIdsRef.current);
      nextHidden.add(node.id);
      setHiddenLiveIds(nextHidden);
      setApiData((current) => current.filter((item) => item.id !== node.id));

      // This also closes the small race between dismissing a row and the next
      // one-second poll deciding it is a newly discovered measurement.
      autoAddedMeasurements.current.add(node.id);
      showToast(`${node.name} hidden from Live Measurements`, "info", 6000, "Explorer", undefined, {
        label: "Undo",
        onClick: () => restoreHiddenLiveMeasurement(node.id),
      });
    },
    [restoreHiddenLiveMeasurement, setHiddenLiveIds, showToast],
  );

  const filterHiddenLiveMeasurements = useCallback(
    (measurements: TreeNode[]): TreeNode[] => {
      latestLiveMeasurementsRef.current = measurements;
      const activeIds = new Set(measurements.map((node) => node.id));
      const retainedHidden = new Set(
        Array.from(hiddenLiveIdsRef.current).filter((id) => activeIds.has(id)),
      );

      // Once a measurement actually ends, forget its dismissal. A future run
      // should never inherit UI state from an old registry entry.
      if (retainedHidden.size !== hiddenLiveIdsRef.current.size) {
        for (const id of hiddenLiveIdsRef.current) {
          if (!activeIds.has(id)) {
            autoAddedMeasurements.current.delete(id);
          }
        }
        setHiddenLiveIds(retainedHidden);
      }

      return measurements.filter((node) => !retainedHidden.has(node.id));
    },
    [setHiddenLiveIds],
  );

  useEffect(() => {
    basketItemsRef.current = basketItems;
  }, [basketItems]);

  useEffect(() => {
    onAddToBasketRef.current = onAddToBasket;
  }, [onAddToBasket]);

  useEffect(() => {
    onStartLoadingAttributesRef.current = onStartLoadingAttributes;
  }, [onStartLoadingAttributes]);

  useEffect(() => {
    onUpdateBasketItemAttributesRef.current = onUpdateBasketItemAttributes;
  }, [onUpdateBasketItemAttributes]);

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
              const children = filterHiddenLiveMeasurements(
                response.data.children.map(convertApiNode),
              );
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

          // If the response is a single node, wrap it in an array
          const treeData = Array.isArray(response.data)
            ? response.data.map(convertApiNode)
            : [convertApiNode(response.data)];
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
    [filterHiddenLiveMeasurements, showLiveOnly, showToast],
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
            const newMeasurements = filterHiddenLiveMeasurements(
              response.data.children.map(convertApiNode),
            );

            // Incrementally update apiData without full rebuild
            setApiData((prevData) => {
              // Create a map of existing measurements by ID for quick lookup
              const existingMap = new Map(prevData.map((node) => [node.id, node]));

              // Create a map of new measurements by ID
              const newMap = new Map(newMeasurements.map((node: TreeNode) => [node.id, node]));

              // Find measurements to add (in new but not in existing)
              const toAdd = newMeasurements.filter((node: TreeNode) => !existingMap.has(node.id));

              // Find measurements to remove (in existing but not in new)
              const toRemove = new Set(
                prevData.filter((node) => !newMap.has(node.id)).map((node) => node.id),
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
                  const inBasket = basketItemsRef.current?.some((item) => item.id === node.id);
                  const alreadyAutoAdded = autoAddedMeasurements.current.has(node.id);

                  if (!inBasket && !alreadyAutoAdded && onAddToBasketRef.current) {
                    console.log(`Auto-adding live measurement to basket: ${node.name}`);
                    onAddToBasketRef.current(node);
                    autoAddedMeasurements.current.add(node.id);

                    // Load attributes for the new live measurement
                    if (
                      node.type === "file" &&
                      onStartLoadingAttributesRef.current &&
                      onUpdateBasketItemAttributesRef.current
                    ) {
                      onStartLoadingAttributesRef.current(node.id);
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
                          onUpdateBasketItemAttributesRef.current?.(node.id, response.data);
                        })
                        .catch((error) => {
                          console.error(
                            "Error loading attributes for auto-added live measurement:",
                            error,
                          );
                          onUpdateBasketItemAttributesRef.current?.(node.id, {});
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
  }, [filterHiddenLiveMeasurements, showLiveOnly]);

  // Held in a ref so the toolbar handlers can read the current set without
  // making every expansion a dependency of the effects below.
  const expandedNodeIdsRef = useRef<Set<string>>(new Set(expandedNodeIds));
  useEffect(() => {
    expandedNodeIdsRef.current = new Set(expandedNodeIds);
  }, [expandedNodeIds]);

  // Seeded once, when the tree is created: initialState is not re-read, and
  // DirTree remounts per path anyway (Explorer keys it on the folder).
  //
  // Only replayed for the folder it was recorded in. Navigating elsewhere --
  // double-clicking into a subfolder, or Back/Forward -- builds a different
  // tree, where those ids mean nothing and would only make the toolbar think
  // something was expanded.
  const initialExpandedItems = useRef<string[]>(
    lastPath === path ? ["root", ...expandedNodeIds] : ["root"],
  );

  useEffect(() => {
    if (lastPath !== path) {
      expandedNodeIdsRef.current = new Set();
      updateDirTreeState({ lastPath: path, expandedNodeIds: [] });
    }
    // Once per mount; DirTree is remounted whenever the path changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Signature that changes only when a library filter is active AND the
  // relevant heart/trash state changes.
  const libFilterSignature = useMemo(() => {
    if (!filterHeartedOnly && !hideTrashed && effectiveTagIds.length === 0) return "";
    return Object.entries(libStatesByPath)
      .filter(([, v]) => v.hearted || v.trashed || v.tags.length > 0)
      .map(([k, v]) => `${k}:${v.hearted ? 1 : 0}${v.trashed ? 1 : 0}:${v.tags.join(",")}`)
      .sort()
      .join("|");
  }, [libStatesByPath, filterHeartedOnly, hideTrashed, effectiveTagIds]);

  // id -> node over the RAW tree, rebuilt only when the API data changes.
  // Filtering and sorting read through this instead of allocating a parallel
  // copy of every node on each pass.
  const nodeIndex = useMemo(() => {
    const index = new Map<string, TreeNode>();
    const walk = (nodes: TreeNode[]) => {
      nodes.forEach((node) => {
        index.set(node.id, node);
        if (node.children) walk(node.children);
      });
    };
    walk(apiData);
    return index;
  }, [apiData]);

  // Which nodes survive the current filters. Kept separate from ordering so
  // changing the sort or its direction does not re-run every predicate over
  // the whole tree, and so a keystroke sorts only the survivors.
  const matchedIds = useMemo(() => {
    const matchesSearch = (node: TreeNode): boolean => {
      if (!searchText) return true;
      const needle = searchText.toLowerCase();
      return node.name.toLowerCase().includes(needle) || node.path.toLowerCase().includes(needle);
    };

    const libraryFilterActive =
      filterHeartedOnly ||
      hideTrashed ||
      effectiveTagIds.length > 0 ||
      unknownSearchTags.length > 0;

    const shouldIncludeNode = (node: TreeNode): boolean => {
      // Library (heart/trash/tag) filters apply to file nodes; folders are kept
      // only when they contain matching descendants.
      if (node.type === "file") {
        // A "#name" that matches no known tag can never match a measurement.
        if (unknownSearchTags.length > 0) return false;
        const st = libStatesByPath[normalizePath(node.path)];
        if (hideTrashed && st?.trashed) return false;
        if (filterHeartedOnly && !st?.hearted) return false;
        if (effectiveTagIds.length > 0 && !effectiveTagIds.some((id) => st?.tags?.includes(id)))
          return false;
      } else if (libraryFilterActive) {
        return false;
      }
      if (filterBy === "all") return true;
      if (filterBy === "dataset" || filterBy === "zarr") {
        return isDatasetPath(node.path) || hasDatasetTag(node.tags);
      }
      if (filterBy === "folder") {
        return node.type === "folder";
      }
      return true;
    };

    // Post-order: a folder is kept when it matches itself or any descendant
    // survived. The previous code answered that with a second recursive walk
    // of each subtree (hasMatchingChildren) on top of this one.
    const matched = new Set<string>();
    const visit = (node: TreeNode): boolean => {
      let anyChildMatched = false;
      if (node.children) {
        node.children.forEach((child) => {
          if (visit(child)) anyChildMatched = true;
        });
      }
      const keep =
        (shouldIncludeNode(node) && matchesSearch(node)) ||
        (node.type === "folder" && anyChildMatched);
      if (keep) matched.add(node.id);
      return keep;
    };
    apiData.forEach(visit);
    return matched;
    // libStatesByPath is read inside but intentionally gated by libFilterSignature
    // so hearts don't re-derive the tree when no filter is active.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    apiData,
    filterBy,
    searchText,
    filterHeartedOnly,
    hideTrashed,
    effectiveTagIds,
    unknownSearchTags,
    libFilterSignature,
  ]);

  // Structure and ordering, as id lists. Nothing here allocates a node.
  const { rootIds, childrenById, visibleNodes } = useMemo(() => {
    const compare = (a: TreeNode, b: TreeNode) => {
      let comparison = 0;

      switch (sortBy) {
        case "name": {
          // Natural sort so numeric sequences order the way they read.
          comparison = a.name.localeCompare(b.name, undefined, {
            numeric: true,
            sensitivity: "base",
          });
          break;
        }
        case "timestamp":
        case "chrono": {
          comparison = (a.timestamp?.getTime() || 0) - (b.timestamp?.getTime() || 0);
          break;
        }
        case "size": {
          comparison = (a.size || 0) - (b.size || 0);
          break;
        }
      }

      // Chrono sort is always descending (newest first)
      const finalDirection = sortBy === "chrono" ? "desc" : sortDirection;
      return finalDirection === "desc" ? -comparison : comparison;
    };

    const children = new Map<string, string[]>();
    const visible = new Map<string, TreeNode>();

    // Chrono flattens to dataset leaves, so there is no hierarchy to build.
    if (sortBy === "chrono") {
      const leaves: TreeNode[] = [];
      const collect = (nodes: TreeNode[]) => {
        nodes.forEach((node) => {
          if (node.type === "file" && matchedIds.has(node.id)) leaves.push(node);
          if (node.children) collect(node.children);
        });
      };
      collect(apiData);
      leaves.sort(compare);
      leaves.forEach((leaf) => visible.set(leaf.id, leaf));
      return {
        rootIds: leaves.map((leaf) => leaf.id),
        childrenById: children,
        visibleNodes: visible,
      };
    }

    const buildLevel = (nodes: TreeNode[]): string[] => {
      // filter() copies, so sorting here never mutates the source children.
      const kept = nodes.filter((node) => matchedIds.has(node.id));
      kept.sort(compare);
      kept.forEach((node) => {
        visible.set(node.id, node);
        if (node.children) children.set(node.id, buildLevel(node.children));
      });
      return kept.map((node) => node.id);
    };

    return {
      rootIds: buildLevel(apiData),
      childrenById: children,
      visibleNodes: visible,
    };
  }, [apiData, matchedIds, sortBy, sortDirection]);

  // Root level nodes for the tree.
  const rootNodes = useMemo(
    () => rootIds.map((id) => nodeIndex.get(id)).filter((node): node is TreeNode => !!node),
    [rootIds, nodeIndex],
  );

  // Initialize headless-tree with search feature
  // Use a key that changes when switching between chrono and non-chrono modes
  // This forces the tree to completely re-initialize
  // Only the chrono/hierarchical switch changes the shape of an item (chrono
  // flattens to leaves, so isItemFolder flips). Filters and search only change
  // which ids getChildren returns, which the virtualiser already re-renders --
  // keying on them remounted the whole container, and its scroll position, on
  // every keystroke.
  const treeKey = sortBy === "chrono" ? "flat" : "tree";

  const tree = useTree<TreeNode>({
    rootItemId: "root",
    initialState: {
      // Root, plus whatever the user had open last time. Everything else loads
      // collapsed, so only expanded subtrees are ever materialised.
      expandedItems: initialExpandedItems.current,
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
        const node = visibleNodes.get(itemId);
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
          return rootIds;
        }
        // In chrono mode, all items are leaf nodes (files) with no children
        if (sortBy === "chrono") {
          return [];
        }

        // childrenById, not node.children: visibleNodes holds the raw nodes,
        // whose children include the ones the current filter dropped.
        return childrenById.get(itemId) ?? [];
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
  // headless-tree caches the flattened item structure and only rebuilds it
  // when asked. useTree calls rebuildTree() once on mount; later renders call
  // setConfig(), which swaps the dataLoader but leaves that cache alone. Since
  // the directory loads asynchronously, the structure built at mount is empty
  // and nothing ever asks the loader again -- which is why the tree used to
  // render nothing until something called collapseAll() (it ends with
  // rebuildTree()). Rebuilding on the structure itself is the supported way,
  // and it leaves expansion state alone, so collapsed folders stay collapsed
  // and only expanded subtrees are materialised.
  useEffect(() => {
    tree.rebuildTree();
  }, [tree, rootIds, childrenById]);

  // Derived from the tree rather than stored: after navigating into a folder
  // the new tree is collapsed, but a remembered flag still read "expanded" and
  // left the button offering Collapse all. getItems() only returns what is
  // materialised, so this is bounded by what is on screen.
  const anyFolderExpanded = tree.getItems().some((item) => item.isFolder() && item.isExpanded());

  // Persist which folders are open so a refresh restores them.
  const updateExpandedNodeState = useCallback(
    (nodeId: string, nextExpanded: boolean) => {
      const next = new Set(expandedNodeIdsRef.current);
      if (nextExpanded) {
        next.add(nodeId);
      } else {
        next.delete(nodeId);
      }
      expandedNodeIdsRef.current = next;
      updateDirTreeState({ expandedNodeIds: [...next] });
    },
    [updateDirTreeState],
  );

  const handleSort = (newSortBy: typeof sortBy) => {
    if (sortBy === newSortBy) {
      // Don't toggle direction for chrono sort - it's always newest first
      if (newSortBy === "chrono") return;

      updateDirTreeState({
        sortDirection: sortDirection === "asc" ? "desc" : "asc",
      });
    } else {
      updateDirTreeState({
        sortBy: newSortBy,
        // For chronological view, default to descending (newest first)
        // For others, default to ascending
        sortDirection: newSortBy === "chrono" ? "desc" : "asc",
      });
    }
  };

  const handleDragStart = (e: React.DragEvent, node: TreeNode) => {
    try {
      e.stopPropagation();

      // Check if the dragged item is selected
      const selectedNodes = getSelectedNodes();
      const isNodeSelected = selectedNodes.some((selectedNode) => selectedNode.id === node.id);

      // If the dragged item is selected and there are multiple selected items, drag all selected
      // Otherwise, just drag the single item
      const itemsToDrag = isNodeSelected && selectedNodes.length > 1 ? selectedNodes : [node];

      // Process each item to collect all valid items to drag
      const validItemsToDrag: TreeNode[] = [];

      // Process each item to drag
      itemsToDrag.forEach((item) => {
        if (item.type === "file") {
          // For files, add them directly
          validItemsToDrag.push(item);
        } else if (item.type === "folder") {
          // For folders, add all direct children that are dataset files.
          const folderChildren = item.children || [];
          const datasetChildren = folderChildren.filter((child) => isDatasetNode(child));
          validItemsToDrag.push(...datasetChildren);
        }
      });

      if (validItemsToDrag.length === 0) {
        const message =
          node.type === "folder" ? "No datasets found in folder" : "No valid files to drag";
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
      const isQcodesDateFolder =
        node.tags?.includes("qcodes-date") === true || node.path.includes("#date=");
      if (isQcodesDateFolder) {
        // Virtual date folders inside sqlite/qcodes trees are only for visual grouping.
        // They should not mutate the explorer path.
        return;
      }
      // For folders, navigate to that path
      onPathChange?.(node.path);
      return;
    }

    const isSqliteRootNode = isSqliteContainerPath(node.path);
    if (isSqliteRootNode) {
      // Open sqlite contents as a virtual folder view.
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
      .map((item) => visibleNodes.get(item.getId()))
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

  // Bulk library actions over the current multi-selection
  // Datasets only: folders have no measurement identity. The target state is
  // computed from the selection so a mixed set resolves one way (heart all if
  // any is unhearted, otherwise unheart all) rather than flipping each item.
  const getSelectedDatasetPaths = (): string[] =>
    getSelectedNodes()
      .filter((node) => node.type === "file")
      .map((node) => node.path);

  const handleBulkHeart = async () => {
    const paths = getSelectedDatasetPaths();
    if (paths.length === 0) return;
    const target = !paths.every((p) => libStatesByPath[normalizePath(p)]?.hearted);
    await applyHeartMany(paths, target);
  };

  const handleBulkTrash = async () => {
    const paths = getSelectedDatasetPaths();
    if (paths.length === 0) return;
    const target = !paths.every((p) => libStatesByPath[normalizePath(p)]?.trashed);
    await applyTrashMany(paths, target);
  };

  // Keyboard shortcuts for the two bulk actions, so a multi-selection can be
  // hearted or trashed without reaching for the toolbar. Alt+Shift, matching
  // the app's other multi-key shortcuts -- every bare letter is already taken
  // (H is HeatMap, and so on). Ignored while typing, and they set rather than
  // toggle, exactly like the toolbar buttons above.
  useEffect(() => {
    if (!dbAvailable) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.altKey || !e.shiftKey || e.ctrlKey || e.metaKey) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
      ) {
        return;
      }
      // Alt can rewrite e.key on some layouts, so match the physical key.
      const code = e.code;
      if (code !== "KeyH" && code !== "KeyT") return;
      if (getSelectedDatasetPaths().length === 0) return;
      e.preventDefault();
      void (code === "KeyH" ? handleBulkHeart() : handleBulkTrash());
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const handleBulkTag = async (tagId: number) => {
    const paths = getSelectedDatasetPaths();
    if (paths.length === 0) return;
    const add = !paths.every((p) => libStatesByPath[normalizePath(p)]?.tags?.includes(tagId));
    await applyTagMany(paths, tagId, add);
  };

  // Tags carried by every selected dataset (drives the popover's checkmarks).
  const commonSelectedTagIds = (): number[] => {
    const paths = getSelectedDatasetPaths();
    if (paths.length === 0) return [];
    return (libraryTags ?? [])
      .map((t) => t.id)
      .filter((id) => paths.every((p) => libStatesByPath[normalizePath(p)]?.tags?.includes(id)));
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

      const filename =
        selectedNodes.length === 1
          ? `${selectedNodes[0].name}.zip`
          : `selected_items_${new Date().toISOString().split("T")[0]}.zip`;
      const result = finishArchiveDownload(response, filename);
      console.log("Download initiated successfully");
      showToast(
        result.savedTo ? `Saved to ${result.savedTo}` : "Download started successfully",
        "success",
      );
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

      const filename = `${node.name}.zip`;
      const result = finishArchiveDownload(response, filename);
      console.log("Folder download initiated successfully");
      showToast(
        result.savedTo ? `Saved to ${result.savedTo}` : "Folder download started successfully",
        "success",
      );
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
      selectedFiles.every((node) => basketItems.some((item) => item.id === node.id))
    );
  };

  // Check if cycling through datasets is enabled
  const isCyclingEnabled = (): boolean => {
    // Only enable if there's exactly one dataset in basket and onCycleDataset is provided
    const datasetItems = basketItems.filter(
      (item) => item.type === "file" && isDatasetPath(item.path),
    );
    return datasetItems.length === 1 && !!onCycleDataset;
  };

  // Get the current dataset index in the processed data
  const getCurrentDatasetIndex = (): number => {
    if (!isCyclingEnabled()) return -1;

    const datasetItem = basketItems.find(
      (item) => item.type === "file" && isDatasetPath(item.path),
    );
    if (!datasetItem) return -1;

    const datasetNodes = Array.from(visibleNodes.values()).filter(
      (node) => node.type === "file" && isDatasetPath(node.path),
    );

    return datasetNodes.findIndex((node) => node.path === datasetItem.path);
  };

  // Get total number of datasets
  const getTotalDatasets = (): number => {
    const datasetNodes = Array.from(visibleNodes.values()).filter(
      (node) => node.type === "file" && isDatasetPath(node.path),
    );
    return datasetNodes.length;
  };

  // Handle cycling through datasets
  const handleCycleDataset = (direction: "prev" | "next") => {
    if (!isCyclingEnabled() || !onCycleDataset) return;

    const datasetNodes = Array.from(visibleNodes.values()).filter(
      (node) => node.type === "file" && isDatasetPath(node.path),
    );

    if (datasetNodes.length === 0) return;

    const currentIndex = getCurrentDatasetIndex();
    if (currentIndex === -1) return;

    let nextIndex: number;
    if (direction === "next") {
      nextIndex = (currentIndex + 1) % datasetNodes.length;
    } else {
      nextIndex = currentIndex === 0 ? datasetNodes.length - 1 : currentIndex - 1;
    }

    const nextNode = datasetNodes[nextIndex];
    if (nextNode) {
      // Remove current dataset from basket
      const currentItem = basketItems.find(
        (item) => item.type === "file" && isDatasetPath(item.path),
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
      const selectedNode = visibleNodes.get(selectedItems[0].getId());
      if (selectedNode) {
        onSelectNode?.(selectedNode);
      }
    }
  }, [tree, visibleNodes, onSelectNode]);

  // Global R keybind mapped to refresh-dir in useGlobalShortcuts
  useShortcut("refresh-dir", () => {
    if (path && path.trim() && !isLoading) {
      loadDirectoryData(path, true);
    }
  });

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

  // Show loading state, but only on a first load: once there is a tree on
  // screen a refresh keeps it, and the spinning Refresh icon in the toolbar
  // is the busy signal. Blanking the pane on every refresh cost the scroll
  // position and a lot more space than a scan costs time.
  if (isLoading && apiData.length === 0) {
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

  return (
    <div
      ref={setRootEl}
      className={`flex flex-col h-full w-full ${isWide ? "qimchi-dirtree-wide" : ""}`}
    >
      {/* Fixed Toolbar Section */}
      <div className="shrink-0 space-y-2 mb-2 w-full">
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
            onChange={(e) => updateDirTreeState({ searchInput: e.target.value })}
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
                {(["name", "timestamp", "size", "chrono"] as const).map((sort) => (
                  <button
                    type="button"
                    key={sort}
                    onClick={() => handleSort(sort)}
                    title={sort === "chrono" ? "Chronological (Newest)" : `Sort by ${sort}`}
                    className={`px-2 py-1 text-xs rounded flex items-center space-x-1 ${
                      sortBy === sort
                        ? "bg-blue-100 text-blue-800"
                        : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                    }`}
                  >
                    <span className="capitalize">
                      {sort === "timestamp" ? "date" : sort === "chrono" ? "Chrono" : sort}
                    </span>
                    {sortBy === sort &&
                      (sort === "chrono" || sortDirection === "desc" ? (
                        <SortDesc size={10} />
                      ) : (
                        <SortAsc size={10} />
                      ))}
                  </button>
                ))}
              </div>
            </div>

            {/* Row 2: Toolbar buttons */}
            <div className="flex items-center justify-center w-full gap-1">
              {showLiveOnly && hiddenLiveMeasurementIds.length > 0 && (
                <Tooltip
                  content={`Restore ${hiddenLiveMeasurementIds.length} hidden live measurement${
                    hiddenLiveMeasurementIds.length === 1 ? "" : "s"
                  }`}
                  position="top"
                >
                  <button
                    type="button"
                    onClick={() => {
                      const count = hiddenLiveIdsRef.current.size;
                      restoreHiddenLiveMeasurement();
                      showToast(
                        `Restored ${count} live measurement${count === 1 ? "" : "s"}`,
                        "success",
                      );
                    }}
                    className="qimchi-dark-hover-plain inline-flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-xs text-blue-700 hover:bg-blue-100"
                    aria-label="Restore hidden live measurements"
                  >
                    <Eye size={16} />
                    <span>{hiddenLiveMeasurementIds.length}</span>
                  </button>
                </Tooltip>
              )}

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
                  className="qimchi-dark-hover-plain qimchi-dark-hover-accent px-2 py-1 text-[#6ea030] bg-[var(--qimchi-accent-light-bg)] hover:bg-[var(--qimchi-accent-header-bg)] rounded disabled:opacity-50 transition-colors"
                  title="Refresh directory"
                >
                  <RefreshCw size={16} className={isLoading ? "animate-spin" : ""} />
                </button>
              </Tooltip>

              {/* Expand/Collapse All Toggle */}
              <Tooltip
                content={
                  sortBy === "chrono"
                    ? "Unavailable in chronological view"
                    : anyFolderExpanded
                      ? "Collapse all"
                      : "Expand all"
                }
                position="top"
              >
                <button
                  type="button"
                  onClick={() => {
                    if (anyFolderExpanded) {
                      tree.collapseAll();
                      expandedNodeIdsRef.current = new Set();
                      updateDirTreeState({ expandedNodeIds: [] });
                    } else {
                      tree.expandAll();
                      // expandAll resolves children as it goes, so read the
                      // opened set back once it settles rather than guessing.
                      setTimeout(() => {
                        const opened = tree
                          .getItems()
                          .filter((item) => item.isFolder() && item.isExpanded())
                          .map((item) => item.getId());
                        expandedNodeIdsRef.current = new Set(opened);
                        updateDirTreeState({ expandedNodeIds: opened });
                      }, 50);
                    }
                  }}
                  disabled={sortBy === "chrono"}
                  className="qimchi-dark-hover-plain px-2 py-1 text-gray-600 hover:bg-blue-200 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  title={
                    sortBy === "chrono"
                      ? "Unavailable in chronological view"
                      : anyFolderExpanded
                        ? "Collapse all"
                        : "Expand all"
                  }
                >
                  {anyFolderExpanded ? <Minimize size={16} /> : <Expand size={16} />}
                </button>
              </Tooltip>

              {/* Explorer Filters */}
              <Tooltip content="Toggle filters" position="top">
                <button
                  type="button"
                  onClick={() => updateDirTreeState({ showFilters: !showFilters })}
                  className={`px-2 py-1 rounded ${
                    showFilters
                      ? "bg-blue-100 text-blue-800"
                      : "qimchi-dark-hover-plain text-gray-600 hover:bg-blue-200 rounded transition-colors"
                  }`}
                  title="Toggle filters"
                >
                  <Filter size={16} />
                </button>
              </Tooltip>

              {/* Add all selected to basket button */}
              <Tooltip
                content={
                  getSelectedNodes().filter((n) => n.type === "file").length === 0
                    ? "Select files first"
                    : selectedInBasket()
                      ? "All selected files already in basket"
                      : `Add ${
                          getSelectedNodes().filter((n) => n.type === "file").length
                        } selected file${
                          getSelectedNodes().filter((n) => n.type === "file").length > 1 ? "s" : ""
                        } to basket`
                }
                position="top"
              >
                <button
                  type="button"
                  onClick={handleAddAllSelectedToBasket}
                  disabled={
                    getSelectedNodes().filter((n) => n.type === "file").length === 0 ||
                    selectedInBasket()
                  }
                  className="qimchi-dark-hover-plain px-2 py-1 text-gray-600 hover:bg-green-200 rounded disabled:opacity-50 transition-colors"
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
                  className="qimchi-dark-hover-plain px-2 py-1 text-gray-600 hover:bg-blue-200 rounded disabled:opacity-50 transition-colors"
                  title="Download all selected items as ZIP"
                >
                  <Download size={16} />
                </button>
              </Tooltip>

              {/* Bulk library actions over the selected datasets */}
              {(() => {
                const n = getSelectedDatasetPaths().length;
                const disabled = n === 0 || !dbAvailable;
                const suffix = `${n} dataset${n === 1 ? "" : "s"}`;
                const reason = !dbAvailable
                  ? "Library unavailable"
                  : n === 0
                    ? "Select datasets first"
                    : null;
                return (
                  <>
                    <Tooltip content={reason ?? `Heart / unheart ${suffix}`} position="top">
                      <button
                        type="button"
                        onClick={handleBulkHeart}
                        disabled={disabled}
                        className="qimchi-dark-hover-plain px-2 py-1 text-gray-600 hover:bg-red-200 rounded disabled:opacity-50 transition-colors"
                        title={reason ?? `Heart / unheart ${suffix}`}
                      >
                        <Heart size={16} />
                      </button>
                    </Tooltip>
                    <Tooltip content={reason ?? `Trash / restore ${suffix}`} position="top">
                      <button
                        type="button"
                        onClick={handleBulkTrash}
                        disabled={disabled}
                        className="qimchi-dark-hover-plain px-2 py-1 text-gray-600 hover:bg-amber-200 rounded disabled:opacity-50 transition-colors"
                        title={reason ?? `Trash / restore ${suffix}`}
                      >
                        <Trash2 size={16} />
                      </button>
                    </Tooltip>
                    <Tooltip content={reason ?? `Tag ${suffix}`} position="top">
                      <button
                        type="button"
                        onClick={(e) => setBulkTagAnchor(bulkTagAnchor ? null : e.currentTarget)}
                        disabled={disabled}
                        className="qimchi-dark-hover-plain px-2 py-1 text-gray-600 hover:bg-indigo-200 rounded disabled:opacity-50 transition-colors"
                        title={reason ?? `Tag ${suffix}`}
                      >
                        <TagIcon size={16} />
                      </button>
                    </Tooltip>
                  </>
                );
              })()}

              {/* Dataset cycling buttons */}
              <Tooltip
                content={
                  isCyclingEnabled()
                    ? `Previous dataset (${getCurrentDatasetIndex() + 1}/${getTotalDatasets()})`
                    : "Add exactly one dataset to basket to enable cycling"
                }
                position="top"
              >
                <button
                  type="button"
                  onClick={() => handleCycleDataset("prev")}
                  disabled={!isCyclingEnabled()}
                  className="qimchi-dark-hover-plain px-2 py-1 text-gray-600 hover:bg-purple-200 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                  title="Previous dataset"
                >
                  <MoveUp size={16} />
                </button>
              </Tooltip>

              <Tooltip
                content={
                  isCyclingEnabled()
                    ? `Next dataset (${getCurrentDatasetIndex() + 1}/${getTotalDatasets()})`
                    : "Add exactly one dataset to basket to enable cycling"
                }
                position="top"
              >
                <button
                  type="button"
                  onClick={() => handleCycleDataset("next")}
                  disabled={!isCyclingEnabled()}
                  className="qimchi-dark-hover-plain px-2 py-1 text-gray-600 hover:bg-purple-200 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                  title="Next dataset"
                >
                  <MoveDown size={16} />
                </button>
              </Tooltip>
            </div>
          </div>
        </div>

        {/* Searchable tag-filter dropdown (see TagFilterMenu). */}
        {tagMenuOpen && tagFilterBtnRef.current && (
          <TagFilterMenu
            anchorEl={tagFilterBtnRef.current}
            tags={libraryTags}
            selectedTagIds={selectedTagIds}
            onToggle={toggleSelectedTag}
            onClear={clearSelectedTags}
            onClose={() => setTagMenuOpen(false)}
          />
        )}

        {/* Bulk tag picker for the current multi-selection. Checkmarks show the
            tags common to ALL selected datasets; toggling applies to all. */}
        {bulkTagAnchor && (
          <TagPopover
            anchorEl={bulkTagAnchor}
            tags={libraryTags}
            currentTagIds={commonSelectedTagIds()}
            onToggle={(tagId) => void handleBulkTag(tagId)}
            onCreate={createLibraryTag}
            onRename={renameLibraryTag}
            onDelete={deleteLibraryTag}
            onClose={() => setBulkTagAnchor(null)}
          />
        )}

        {/* If Library DB is unavailable */}
        {!dbAvailable && (
          <div
            className="mt-1 px-2 py-1.5 rounded-md border border-amber-300 bg-amber-50 text-amber-900 text-[11px] leading-snug"
            role="status"
            title={dbError ?? undefined}
          >
            <span className="font-semibold">Library unavailable.</span> Hearts, tags and notes
            can&apos;t be saved this session. Plotting still works.
            {dbError && (
              <span className="block mt-0.5 font-mono opacity-80 wrap-break-word">{dbError}</span>
            )}
          </div>
        )}

        {/* Filter Controls */}
        {showFilters && (
          <div className="p-1 bg-gray-50 rounded-md">
            <div className="flex items-center space-x-2">
              <div className="flex space-x-1 w-full justify-center items-center">
                {(["all", "folder", "dataset"] as const).map((filter) => (
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
                    {filter === "all"
                      ? "All"
                      : filter === "dataset"
                        ? "DATASET"
                        : filter.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>

            {/* Row 2 -- library filters: hearted / trashed / tags. Kept separate
                from the node-type row above: those pick WHAT KIND of node to
                show, these filter by the user's own annotations. */}
            <div className="mt-1 flex flex-wrap gap-1 justify-center items-center">
              <button
                type="button"
                onClick={() => setFilterHeartedOnly(!filterHeartedOnly)}
                disabled={!dbAvailable}
                title="Show only hearted measurements"
                className={`flex items-center gap-1 px-2 py-1 text-xs rounded disabled:opacity-40 disabled:cursor-not-allowed ${
                  filterHeartedOnly
                    ? "bg-red-100 text-red-700"
                    : "bg-white text-gray-600 hover:bg-gray-100"
                }`}
              >
                <Heart size={12} className={filterHeartedOnly ? "fill-red-500 text-red-500" : ""} />
                Hearted
              </button>
              <button
                type="button"
                onClick={() => setHideTrashed(!hideTrashed)}
                disabled={!dbAvailable}
                title="Hide trashed measurements"
                className={`flex items-center gap-1 px-2 py-1 text-xs rounded disabled:opacity-40 disabled:cursor-not-allowed ${
                  hideTrashed
                    ? "bg-blue-100 text-blue-800"
                    : "bg-white text-gray-600 hover:bg-gray-100"
                }`}
              >
                <Trash2 size={12} />
                Hide Trash
              </button>
              {/* Tag filter: a dropdown rather than a chip row, because tags are
                  Gmail-style labels that accumulate without bound. */}
              {libraryTags.length > 0 && (
                <button
                  ref={tagFilterBtnRef}
                  type="button"
                  onClick={() => setTagMenuOpen((open) => !open)}
                  disabled={!dbAvailable}
                  title="Filter by tags"
                  className={`flex items-center gap-1 px-2 py-1 text-xs rounded border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                    selectedTagIds.length > 0
                      ? "bg-indigo-100 text-indigo-800 border-indigo-300"
                      : "bg-white text-gray-600 border-gray-200 hover:bg-gray-100"
                  }`}
                >
                  <TagIcon size={12} />
                  Tags
                  {selectedTagIds.length > 0 && ` (${selectedTagIds.length})`}
                  <ChevronDown size={12} />
                </button>
              )}
            </div>

            {/* Selected tags stay visible as removable chips so an active
                filter is never hidden inside a closed menu. */}
            {libraryTags.length > 0 && (
              <div className="mt-1 flex flex-col items-center gap-1">
                {selectedTagIds.length > 0 && (
                  <div className="flex flex-wrap gap-1 justify-center">
                    {libraryTags
                      .filter((tag) => selectedTagIds.includes(tag.id))
                      .map((tag) => (
                        <button
                          key={tag.id}
                          type="button"
                          onClick={() => toggleSelectedTag(tag.id)}
                          title={`Remove filter: ${tag.name}`}
                          className="px-2 py-0.5 text-[11px] rounded-full border bg-indigo-100 text-indigo-800 border-indigo-300 hover:bg-indigo-200"
                        >
                          #{tag.name} &times;
                        </button>
                      ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Scrollable Tree View - Always Virtualized */}
      <div className="flex-1 min-h-0" aria-busy={isLoading}>
        <VirtualizedTreeView
          tree={tree}
          treeKey={treeKey}
          rootNodes={rootNodes}
          onAddToBasket={onAddToBasket}
          onRemoveBasketItem={onRemoveBasketItem}
          onOpenNotes={onOpenNotes}
          onOpenSampleNotes={onOpenSampleNotes}
          onDownload={onDownload}
          onDownloadFolder={handleDownloadFolder}
          draggedItem={draggedItem}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDoubleClick={onDoubleClick}
          onOpenSqliteNode={(node) => onPathChange?.(node.path)}
          onToggleFolderExpand={updateExpandedNodeState}
          // Only the plain-text part highlights; "#tag" tokens are a filter
          searchTerm={searchText}
          basketItems={basketItems}
          path={path}
          showLiveOnly={showLiveOnly}
          hiddenLiveMeasurementCount={hiddenLiveMeasurementIds.length}
          onHideLiveMeasurement={hideLiveMeasurement}
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
  onOpenSampleNotes?: (node: TreeNode) => void;
  onDownload?: (node: TreeNode) => void;
  onDownloadFolder?: (node: TreeNode) => void;
  draggedItem: string | null;
  onDragStart: (e: React.DragEvent, node: TreeNode) => void;
  onDragEnd: () => void;
  onDoubleClick: (e: React.MouseEvent, node: TreeNode) => void;
  onOpenSqliteNode: (node: TreeNode) => void;
  onToggleFolderExpand: (nodeId: string, expanded: boolean) => void;
  searchTerm?: string;
  basketItems?: BasketItem[];
  path?: string;
  showLiveOnly: boolean;
  hiddenLiveMeasurementCount: number;
  onHideLiveMeasurement: (node: TreeNode) => void;
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
      onOpenSampleNotes,
      onDownload,
      onDownloadFolder,
      draggedItem,
      onDragStart,
      onDragEnd,
      onDoubleClick,
      onOpenSqliteNode,
      onToggleFolderExpand,
      searchTerm,
      basketItems,
      path,
      showLiveOnly,
      hiddenLiveMeasurementCount,
      onHideLiveMeasurement,
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
                    onOpenSampleNotes={onOpenSampleNotes}
                    onDownload={onDownload}
                    onDownloadFolder={onDownloadFolder}
                    draggedItem={draggedItem}
                    onDragStart={onDragStart}
                    onDragEnd={onDragEnd}
                    onDoubleClick={onDoubleClick}
                    onOpenSqliteNode={onOpenSqliteNode}
                    onToggleFolderExpand={onToggleFolderExpand}
                    searchTerm={searchTerm}
                    basketItems={basketItems}
                    showLiveOnly={showLiveOnly}
                    onHideLiveMeasurement={onHideLiveMeasurement}
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
              {showLiveOnly
                ? hiddenLiveMeasurementCount > 0
                  ? "All live measurements are hidden"
                  : "No live measurements"
                : path
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
  onOpenSampleNotes?: (node: TreeNode) => void;
  onDownload?: (node: TreeNode) => void;
  onDownloadFolder?: (node: TreeNode) => void;
  draggedItem: string | null;
  onDragStart: (e: React.DragEvent, node: TreeNode) => void;
  onDragEnd: () => void;
  // Double click should add to basket
  onDoubleClick: (e: React.MouseEvent, node: TreeNode) => void;
  onOpenSqliteNode: (node: TreeNode) => void;
  onToggleFolderExpand: (nodeId: string, expanded: boolean) => void;
  searchTerm?: string;
  basketItems?: BasketItem[]; // Items already in the basket
  showLiveOnly: boolean;
  onHideLiveMeasurement: (node: TreeNode) => void;
}

const TreeItemComponent = ({
  item,
  onAddToBasket,
  onRemoveBasketItem,
  onOpenNotes,
  onOpenSampleNotes,
  onDownload,
  onDownloadFolder,
  draggedItem,
  onDragStart,
  onDragEnd,
  onDoubleClick,
  onOpenSqliteNode,
  onToggleFolderExpand,
  searchTerm = "",
  basketItems = [],
  showLiveOnly,
  onHideLiveMeasurement,
}: TreeItemComponentProps) => {
  const { copyToClipboard: copyFNameToClipboard, isCopied: isFNameCopied } = useCopyToClipboard();
  const { copyToClipboard: copyPathToClipboard, isCopied: isPathCopied } = useCopyToClipboard();
  const nodeData = item.getItemData() as TreeNode;
  const isExpanded = item.isExpanded();
  const isFocused = item.isFocused();
  const isSelected = item.isSelected();
  const isFolder = item.isFolder();
  const isSqliteContainerNode =
    isSqliteContainerPath(nodeData.path) && !nodeData.path.includes("#");
  const isDatasetLeafNode = isDatasetNode(nodeData) && !isSqliteContainerNode;
  const datasetKind = detectDatasetKind(nodeData.path, nodeData.tags);
  const displayName = isDatasetLeafNode ? formatQanaryDatasetName(nodeData.name) : nodeData.name;
  // Library (heart/trash) state for this node, keyed by normalized path.
  const libState = useLibraryStore((s) => s.statesByPath[normalizePath(nodeData.path)]);
  const toggleHeart = useLibraryStore((s) => s.toggleHeart);
  const toggleTrash = useLibraryStore((s) => s.toggleTrash);
  const allTags = useLibraryStore((s) => s.tags);
  const toggleTag = useLibraryStore((s) => s.toggleTag);
  const createTag = useLibraryStore((s) => s.createTag);
  const renameTag = useLibraryStore((s) => s.renameTag);
  const deleteTag = useLibraryStore((s) => s.deleteTag);
  const [tagAnchor, setTagAnchor] = useState<HTMLElement | null>(null);
  const isSampleFolder =
    isFolder &&
    (nodeData.children || []).some((child) => child.type === "file" && isDatasetPath(child.path));

  // Check if this item is in the basket
  const isInBasket = basketItems.some((basketItem) => basketItem.id === nodeData.id);

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

  const renderExplorerDisplayName = () => {
    if (displayName === nodeData.name) return highlightSearchTerm(displayName, searchTerm);

    const shortenedMarkerIndex = displayName.indexOf("*");
    if (shortenedMarkerIndex < 0) return highlightSearchTerm(displayName, searchTerm);

    return (
      <>
        {highlightSearchTerm(displayName.slice(0, shortenedMarkerIndex), searchTerm)}
        <span className="qimchi-tree-shortened-marker">*</span>
        {highlightSearchTerm(displayName.slice(shortenedMarkerIndex + 1), searchTerm)}
      </>
    );
  };

  // One colour per dataset kind, the same in both themes (see the
  // --qimchi-icon-* tokens): the icon is how a kind is recognised, so it
  // should not change identity when the theme flips.
  const renderDatasetIcon = () => {
    switch (datasetKind) {
      case "zarr":
        return <FileArchive size={16} className="text-[var(--qimchi-icon-zarr)]" />;
      case "netcdf":
        return <FileText size={16} className="text-[var(--qimchi-icon-netcdf)]" />;
      case "hdf5":
        return <HardDrive size={16} className="text-[var(--qimchi-icon-hdf5)]" />;
      case "qcodes":
        return <DatabaseIcon size={16} className="text-[var(--qimchi-icon-qcodes)]" />;
      case "sqlite":
        return <DatabaseIcon size={16} className="text-[var(--qimchi-icon-sqlite)]" />;
      case "csv":
        return <Table size={16} className="text-[var(--qimchi-icon-csv)]" />;
      default:
        return <DatabaseIcon size={16} className="text-[var(--qimchi-icon-generic)]" />;
    }
  };

  return (
    <div
      className={`w-full flex items-center group hover:bg-gray-50 transition-colors border-l-2 ${
        isInBasket
          ? "border-l-green-500 bg-green-50"
          : isFocused
            ? "border-l-blue-300 bg-blue-50"
            : isSelected
              ? "border-l-blue-500 bg-blue-100"
              : "border-transparent"
      } ${draggedItem === nodeData.id ? "dragging opacity-50" : ""} ${
        libState?.trashed ? "qimchi-trashed pointer-events-none" : ""
      }`}
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
          className="text-gray-300 mr-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
        />

        {/* Expand/Collapse Icon */}
        {(isFolder || isSqliteContainerNode) && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (isFolder) {
                if (isExpanded) {
                  item.collapse();
                  onToggleFolderExpand(nodeData.id, false);
                } else {
                  item.expand();
                  onToggleFolderExpand(nodeData.id, true);
                }
                return;
              }
              onOpenSqliteNode(nodeData);
            }}
            className="mr-1 shrink-0 p-1 hover:bg-gray-200 rounded transition-colors"
            aria-label={
              isFolder ? (isExpanded ? "Collapse folder" : "Expand folder") : "Open sqlite runs"
            }
          >
            {isFolder && isExpanded ? (
              <ChevronDown size={14} className="text-gray-500" />
            ) : (
              <ChevronRight size={14} className="text-gray-500" />
            )}
          </button>
        )}

        {/* File/Folder Icon */}
        <span className="mr-2 shrink-0 text-sm">
          {isFolder ? (
            isExpanded ? (
              <FolderOpenIcon size={16} className="text-blue-500" />
            ) : (
              <FolderClosedIcon size={16} className="text-blue-900" />
            )
          ) : (
            renderDatasetIcon()
          )}
          {/* Live indicator for zarr datasets (prefer liveStatusMap updates from WS) */}
          {/* live indicator removed */}
        </span>

        {/* Name with Tooltip - display with search highlighting */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <span
              className={`text-sm truncate block ${
                isDatasetPath(nodeData.path)
                  ? "qimchi-tree-dataset font-medium"
                  : "qimchi-tree-folder"
              } ${libState?.trashed ? "qimchi-trashed" : ""}`}
            >
              {renderExplorerDisplayName()}
            </span>
            {isSqliteContainerNode && (
              <span className="text-[10px] uppercase tracking-wide text-teal-700 bg-teal-100 border border-teal-200 rounded px-1 py-0.5 shrink-0">
                RUNS
              </span>
            )}
          </div>
          {/* </Tooltip> */}
        </div>
      </div>

      {/* Wide layout only: the modified date gets its own column instead of
          being hidden behind the Metadata panel. Shown by CSS when the DirTree
          root carries .qimchi-dirtree-wide. */}
      <div className="qimchi-row-meta shrink-0 items-center pr-3 text-xs text-gray-500 tabular-nums">
        <span className="w-40 whitespace-nowrap text-right">
          {formatRowTimestamp(nodeData.timestamp)}
        </span>
      </div>

      {/* For Datasets */}
      {!isFolder && (
        <div className="qimchi-row-actions flex items-center px-1 py-0.5 rounded-md">
          {/* className="flex items-center space-x-1 opacity-0 group-hover:backdrop-blur-md group-hover:bg-white/90 group-hover:opacity-100 transition-opacity px-1 py-0.5 rounded-md"> */}
          {showLiveOnly && nodeData.path.startsWith("memory://") && (
            <Tooltip content="Hide from Live Measurements" position="top">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onHideLiveMeasurement(nodeData);
                }}
                className={`qimchi-dark-hover-plain p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 rounded transition-colors shrink-0 ${
                  libState?.trashed ? "qimchi-trashed-interactive" : ""
                }`}
                aria-label={`Hide ${nodeData.name} from Live Measurements`}
              >
                <EyeOff size={14} />
              </button>
            </Tooltip>
          )}

          {/* Copy filename button */}
          <Tooltip content="Copy filename" position="top">
            <button
              type="button"
              onClick={async (e) => {
                e.stopPropagation();
                await copyFNameToClipboard(nodeData.name);
              }}
              className="qimchi-dark-hover-plain p-1 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors shrink-0"
              aria-label={`Copy filename: ${nodeData.name}`}
            >
              {isFNameCopied ? <Check size={14} className="text-green-600" /> : <Copy size={14} />}
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
              className="qimchi-dark-hover-plain p-1 text-gray-400 hover:text-orange-600 hover:bg-orange-50 rounded transition-colors shrink-0"
              aria-label={`Copy full path: ${nodeData.path}`}
            >
              {isPathCopied ? <Check size={14} className="text-green-600" /> : <Copy size={14} />}
            </button>
          </Tooltip>

          {/* Download Button - for dataset files */}
          {isDatasetPath(nodeData.path) && (
            <Tooltip content="Download dataset" position="top">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onDownload?.(nodeData);
                }}
                className="qimchi-dark-hover-plain p-1 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded transition-colors shrink-0"
                aria-label="Download dataset"
              >
                <Download size={14} />
              </button>
            </Tooltip>
          )}

          {/* Heart / Trash Buttons - dataset leaves (qanary measurements) */}
          {isDatasetLeafNode && (
            <Tooltip content={libState?.hearted ? "Unheart" : "Heart"} position="top">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleHeart(nodeData.path);
                }}
                className={`qimchi-dark-hover-plain group/heart p-1 rounded transition-colors shrink-0 ${
                  libState?.hearted
                    ? "text-red-500 hover:bg-red-50"
                    : "text-gray-400 hover:text-red-500 hover:bg-red-50"
                }`}
                aria-label={libState?.hearted ? "Remove heart" : "Heart"}
              >
                {libState?.hearted ? (
                  <>
                    <Heart
                      size={14}
                      className="fill-red-500 text-red-500 group-hover/heart:hidden"
                    />
                    <HeartCrack size={14} className="hidden text-red-500 group-hover/heart:block" />
                  </>
                ) : (
                  <Heart size={14} />
                )}
              </button>
            </Tooltip>
          )}

          {isDatasetLeafNode && (
            <Tooltip content={libState?.trashed ? "Restore" : "Trash"} position="top">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleTrash(nodeData.path);
                }}
                className={`qimchi-dark-hover-plain p-1 rounded transition-colors shrink-0 ${
                  libState?.trashed
                    ? // Restore is the one thing left to do on a trashed row:
                      // re-enabled against the row's pointer-events:none, and
                      // muted rather than red, since nothing is being deleted.
                      "qimchi-trashed-interactive text-gray-400 hover:text-gray-600 hover:bg-gray-100"
                    : "text-gray-400 hover:text-red-600 hover:bg-red-50"
                }`}
                aria-label={libState?.trashed ? "Restore from trash" : "Trash"}
              >
                <Trash2 size={14} />
              </button>
            </Tooltip>
          )}

          {/* Tags Button + popover - dataset leaves */}
          {isDatasetLeafNode && (
            <Tooltip content="Tags" position="top">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  const el = e.currentTarget as HTMLElement;
                  setTagAnchor((a) => (a ? null : el));
                }}
                className={`qimchi-dark-hover-plain p-1 rounded transition-colors shrink-0 ${
                  (libState?.tags?.length ?? 0) > 0
                    ? "text-indigo-600 hover:bg-indigo-50"
                    : "text-gray-400 hover:text-indigo-600 hover:bg-indigo-50"
                }`}
                aria-label="Edit tags"
              >
                <TagIcon size={14} />
              </button>
            </Tooltip>
          )}
          {tagAnchor && (
            <TagPopover
              anchorEl={tagAnchor}
              tags={allTags}
              currentTagIds={libState?.tags ?? []}
              onToggle={(tagId) => toggleTag(nodeData.path, tagId)}
              onCreate={createTag}
              onRename={renameTag}
              onDelete={deleteTag}
              onClose={() => setTagAnchor(null)}
            />
          )}

          {/* Open Notes Button - any dataset leaf except sqlite container nodes */}
          {isDatasetLeafNode && (
            <Tooltip content="Open notes" position="top">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenNotes?.(nodeData);
                }}
                className="qimchi-dark-hover-plain p-1 text-gray-400 hover:text-purple-600 hover:bg-purple-50 rounded transition-colors shrink-0"
                aria-label="Open notes"
              >
                <NotebookPen size={14} />
              </button>
            </Tooltip>
          )}

          {isSqliteContainerNode ? (
            <Tooltip content="Open runs" position="top">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenSqliteNode(nodeData);
                }}
                className="qimchi-dark-hover-plain p-1 rounded transition-colors shrink-0 text-gray-400 hover:text-blue-600 hover:bg-blue-100"
                aria-label="Open runs"
              >
                <FolderOpenIcon size={14} />
              </button>
            </Tooltip>
          ) : (
            /* Add/Remove Basket Button - only for non-container files */
            <Tooltip content={isInBasket ? "Remove from basket" : "Add to basket"} position="top">
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
                className={`qimchi-dark-hover-plain p-1 rounded transition-colors shrink-0 ${
                  isInBasket
                    ? "text-red-500 hover:text-red-700 hover:bg-red-50"
                    : "text-gray-400 hover:text-blue-600 hover:bg-blue-100"
                }`}
                aria-label={isInBasket ? "Remove from basket" : "Add to basket"}
              >
                {isInBasket ? <Minus size={14} /> : <Plus size={14} />}
              </button>
            </Tooltip>
          )}
        </div>
      )}

      {/* For Folders */}
      {isFolder && (
        <div className="qimchi-row-actions flex items-center opacity-0 group-hover:opacity-100 transition-opacity mr-1">
          {/* Copy folder name button */}
          <Tooltip content="Copy folder name" position="top">
            <button
              type="button"
              onClick={async (e) => {
                e.stopPropagation();
                await copyFNameToClipboard(nodeData.name);
              }}
              className="qimchi-dark-hover-plain p-1 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors shrink-0"
              aria-label={`Copy folder name: ${nodeData.name}`}
            >
              {isFNameCopied ? <Check size={14} className="text-green-600" /> : <Copy size={14} />}
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
              className="qimchi-dark-hover-plain p-1 text-gray-400 hover:text-orange-600 hover:bg-orange-50 rounded transition-colors shrink-0"
              aria-label={`Copy folder path: ${nodeData.path}`}
            >
              {isPathCopied ? <Check size={14} className="text-green-600" /> : <Copy size={14} />}
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
              className="qimchi-dark-hover-plain p-1 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded transition-colors shrink-0"
              aria-label={`Download folder: ${nodeData.name}`}
            >
              <Download size={14} />
            </button>
          </Tooltip>

          {/* Open pooled sample notes button - only for sample folders */}
          {isSampleFolder && (
            <Tooltip content="Open pooled sample notes" position="top">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenSampleNotes?.(nodeData);
                }}
                className="qimchi-dark-hover-plain p-1 text-gray-400 hover:text-purple-600 hover:bg-purple-50 rounded transition-colors shrink-0"
                aria-label="Open pooled sample notes"
              >
                <NotebookPen size={14} />
              </button>
            </Tooltip>
          )}
        </div>
      )}
    </div>
  );
};

export default DirTree;

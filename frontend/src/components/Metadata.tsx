import { useState, useEffect, useMemo, memo } from "react";
import { PROD_BACKEND_URL } from "../config";
import {
  Eye,
  EyeOff,
  Expand,
  Minimize,
  Search,
  X,
  BadgeInfo,
} from "lucide-react";
import axios from "axios";
import JsonView from "@uiw/react-json-view";
import { BasketItem } from "./Basket";
import { useSidebarStore } from "../stores/sidebarStore";
import Tooltip from "./Tooltip";

// Type definitions for metadata
interface Metadata {
  Sweeps: Record<string, unknown>;
  "Parameters Snapshot": Record<string, unknown>;
  "Extra Metadata": Record<string, unknown>;
  "Instruments Snapshot": Record<string, unknown>;
}

// The custom theme for the metadata JSON view
const metadataCustomTheme = {
  "--w-rjv-font-family": "Martian Mono",
  "--w-rjv-color": "#333333",
  "--w-rjv-key-number": "#0066cc",
  "--w-rjv-key-string": "#333333",
  "--w-rjv-background-color": "inherit",
  "--w-rjv-line-color": "#e5e5e5",
  "--w-rjv-arrow-color": "#666666",
  "--w-rjv-edit-color": "var(--w-rjv-color)",
  "--w-rjv-info-color": "#666666",
  "--w-rjv-update-color": "#333333",
  "--w-rjv-copied-color": "#333333",
  "--w-rjv-copied-success-color": "#28a745",

  "--w-rjv-curlybraces-color": "#333333",
  "--w-rjv-colon-color": "#333333",
  "--w-rjv-brackets-color": "#333333",
  "--w-rjv-ellipsis-color": "#dc3545",
  "--w-rjv-quotes-color": "var(--w-rjv-key-string)",
  "--w-rjv-quotes-string-color": "var(--w-rjv-type-string-color)",

  "--w-rjv-type-string-color": "#0d7377",
  "--w-rjv-type-int-color": "#0066cc",
  "--w-rjv-type-float-color": "#0066cc",
  "--w-rjv-type-bigint-color": "#0066cc",
  "--w-rjv-type-boolean-color": "#0066cc",
  "--w-rjv-type-date-color": "#0d7377",
  "--w-rjv-type-url-color": "#007bff",
  "--w-rjv-type-null-color": "#dc3545",
  "--w-rjv-type-nan-color": "#fd7e14",
  "--w-rjv-type-undefined-color": "#dc3545",
};

// Progress bar component to avoid inline styles
const ProgressBar = ({ progress }: { progress: number }) => {
  const progressPercentage = Math.max(10, progress * 100);

  return (
    <div className="mt-2 bg-blue-200 rounded-full h-2">
      <div
        className="bg-blue-600 h-2 rounded-full transition-all duration-300"
        style={{
          width: `${progressPercentage}%`,
        }}
      ></div>
    </div>
  );
};

// Helper function to retry failed requests with exponential backoff
const retryRequest = async function <T>(
  fn: () => Promise<T>,
  maxRetries = 2,
  delay = 1000
): Promise<T> {
  let lastError: Error;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      if (attempt < maxRetries) {
        // Wait before retrying with exponential backoff
        await new Promise((resolve) =>
          setTimeout(resolve, delay * Math.pow(2, attempt))
        );
      }
    }
  }

  throw lastError!;
};

// Helper function to recursively search through metadata objects
const searchInObject = (
  obj: unknown,
  query: string,
  path: string[] = []
): Array<{ key: string; value: string; path: string[] }> => {
  const results: Array<{ key: string; value: string; path: string[] }> = [];
  const lowerQuery = query.toLowerCase();

  if (typeof obj === "object" && obj !== null) {
    for (const [key, value] of Object.entries(obj)) {
      const currentPath = [...path, key];

      // Check if key matches
      if (key.toLowerCase().includes(lowerQuery)) {
        results.push({
          key,
          value: String(value),
          path: currentPath,
        });
      }

      // Check if value matches (for primitive values)
      if (typeof value === "string" || typeof value === "number") {
        if (String(value).toLowerCase().includes(lowerQuery)) {
          results.push({
            key,
            value: String(value),
            path: currentPath,
          });
        }
      }

      // Recursively search in nested objects
      if (typeof value === "object" && value !== null) {
        results.push(...searchInObject(value, query, currentPath));
      }
    }
  }

  return results;
};

interface MetadataProps {
  basketItems: BasketItem[];
}

const Metadata = ({ basketItems }: MetadataProps) => {
  // Use Zustand store for search state
  const { componentStates, updateMetadataState } = useSidebarStore();
  const { searchInput, searchQuery } = componentStates.metadata;

  // State for metadata - now stores metadata for each basket item
  const [metadataMap, setMetadataMap] = useState<Map<string, Metadata>>(
    new Map()
  );
  const [loadingMetadata, setLoadingMetadata] = useState<Set<string>>(
    new Set()
  );
  const [metadataErrors, setMetadataErrors] = useState<Map<string, string>>(
    new Map()
  );
  const [collapsedCards, setCollapsedCards] = useState<Set<string>>(new Set());

  // Track ongoing requests to prevent duplicates
  const [ongoingRequests, setOngoingRequests] = useState<
    Map<string, Promise<unknown>>
  >(new Map());

  // Debounce search input
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      updateMetadataState({ searchQuery: searchInput });
    }, 300); // 300ms debounce delay

    return () => clearTimeout(timeoutId);
  }, [searchInput, updateMetadataState]);

  // Collapse all cards when search input starts for performance
  useEffect(() => {
    if (searchInput.trim() && searchInput.length === 1) {
      // Only collapse on first character to avoid repeated collapsing
      const fileItems = basketItems.filter((item) => item.type === "file");
      const fileItemIds = fileItems.map((item) => item.id);
      setCollapsedCards(new Set(fileItemIds));
    }
  }, [searchInput, basketItems]);

  // Clear search query when basket becomes empty
  useEffect(() => {
    const fileItems = basketItems.filter((item) => item.type === "file");
    if (fileItems.length === 0) {
      updateMetadataState({ searchInput: "", searchQuery: "" });
    }
  }, [basketItems, updateMetadataState]);

  // Memoized parsed metadata to avoid re-parsing JSON on every search
  const parsedMetadataMap = useMemo(() => {
    const parsed = new Map<string, Record<string, unknown>>();

    for (const [itemId, metadata] of metadataMap.entries()) {
      const parsedMetadata: Record<string, unknown> = {};

      for (const [sectionKey, sectionValue] of Object.entries(metadata)) {
        try {
          parsedMetadata[sectionKey] = JSON.parse(sectionValue as string);
        } catch {
          parsedMetadata[sectionKey] = sectionValue;
        }
      }

      parsed.set(itemId, parsedMetadata);
    }

    return parsed;
  }, [metadataMap]);

  // Optimized search function using useMemo for performance
  const filteredResults = useMemo(() => {
    if (!searchQuery.trim()) {
      return new Map();
    }

    const results = new Map<
      string,
      {
        matches: Array<{ key: string; value: string; path: string[] }>;
        itemName: string;
      }
    >();

    // Search through parsed metadata for each file
    for (const [itemId, parsedMetadata] of parsedMetadataMap.entries()) {
      const item = basketItems.find((item) => item.id === itemId);
      if (!item) continue;

      const allMatches: Array<{ key: string; value: string; path: string[] }> =
        [];

      // Search through each metadata section
      for (const [sectionKey, sectionValue] of Object.entries(parsedMetadata)) {
        const matches = searchInObject(sectionValue, searchQuery, [sectionKey]);
        allMatches.push(...matches);
      }

      if (allMatches.length > 0) {
        results.set(itemId, {
          matches: allMatches,
          itemName: item.name,
        });
      }
    }

    return results;
  }, [searchQuery, parsedMetadataMap, basketItems]);

  const toggleCardCollapse = (itemId: string) => {
    setCollapsedCards((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(itemId)) {
        newSet.delete(itemId);
      } else {
        newSet.add(itemId);
      }
      return newSet;
    });
  };

  const toggleAllCards = () => {
    const fileItems = basketItems.filter((item) => item.type === "file");
    const fileItemIds = fileItems.map((item) => item.id);

    // Check if all cards are collapsed
    const allCollapsed = fileItemIds.every((id) => collapsedCards.has(id));

    if (allCollapsed) {
      // Expand all cards
      setCollapsedCards(new Set());
    } else {
      // Collapse all cards
      setCollapsedCards(new Set(fileItemIds));
    }
  };

  // Effect to fetch metadata when basket items change
  useEffect(() => {
    const fetchMetadata = async () => {
      // Find new items that don't have metadata yet and aren't currently loading
      const newItems = basketItems.filter(
        (item) =>
          item.type === "file" &&
          !metadataMap.has(item.id) &&
          !loadingMetadata.has(item.id) &&
          !ongoingRequests.has(item.id)
      );

      if (newItems.length === 0) {
        return;
      }

      // Set loading state for all new items at once
      setLoadingMetadata(
        (prev) => new Set([...prev, ...newItems.map((item) => item.id)])
      );

      // Clear any previous errors for these items
      setMetadataErrors((prev) => {
        const newMap = new Map(prev);
        newItems.forEach((item) => newMap.delete(item.id));
        return newMap;
      });

      // Create an axios instance with optimized configuration
      const axiosInstance = axios.create({
        baseURL: PROD_BACKEND_URL,
        timeout: 30000, // 30 second timeout
        headers: {
          "Content-Type": "application/json",
        },
      });

      // Fetch metadata for all items in parallel with controlled concurrency
      const BATCH_SIZE = 5; // Process up to 5 requests simultaneously
      const batches: BasketItem[][] = [];

      for (let i = 0; i < newItems.length; i += BATCH_SIZE) {
        batches.push(newItems.slice(i, i + BATCH_SIZE));
      }

      // Process batches sequentially, but items within each batch in parallel
      for (const batch of batches) {
        const promises = batch.map(async (item) => {
          // Create and track the request promise
          const requestPromise = (async () => {
            try {
              const requestFn = () =>
                axiosInstance.post("/load-meta/", { path: item.path });
              const response = await retryRequest(requestFn, 2, 500);

              // Update metadata map for successful response
              setMetadataMap(
                (prev) =>
                  new Map([...prev, [item.id, response.data as Metadata]])
              );
              console.log("Metadata loaded for item:", item.id);

              return { success: true, itemId: item.id };
            } catch (error) {
              console.error(
                "Error fetching metadata for item:",
                item.id,
                error
              );

              // Update error state for failed response
              setMetadataErrors(
                (prev) =>
                  new Map([...prev, [item.id, "Failed to load metadata"]])
              );

              return { success: false, itemId: item.id, error };
            } finally {
              // Remove from loading state and ongoing requests
              setLoadingMetadata((prev) => {
                const newSet = new Set(prev);
                newSet.delete(item.id);
                return newSet;
              });
              setOngoingRequests((prev) => {
                const newMap = new Map(prev);
                newMap.delete(item.id);
                return newMap;
              });
            }
          })();

          // Track the ongoing request
          setOngoingRequests(
            (prev) => new Map([...prev, [item.id, requestPromise]])
          );

          return requestPromise;
        });

        // Wait for the current batch to complete before processing the next one
        await Promise.allSettled(promises);
      }
    };

    fetchMetadata();
  }, [basketItems, metadataMap, loadingMetadata, ongoingRequests]);

  // Effect to clean up metadata when basket items are removed
  useEffect(() => {
    const currentItemIds = new Set(basketItems.map((item) => item.id));

    // Clean up metadata for items that are no longer in the basket
    setMetadataMap((prev) => {
      const newMap = new Map();
      for (const [itemId, metadata] of prev.entries()) {
        if (currentItemIds.has(itemId)) {
          newMap.set(itemId, metadata);
        }
      }
      return newMap;
    });

    // Clean up loading states
    setLoadingMetadata((prev) => {
      const newSet = new Set<string>();
      for (const itemId of prev) {
        if (currentItemIds.has(itemId)) {
          newSet.add(itemId);
        }
      }
      return newSet;
    });

    // Clean up error states
    setMetadataErrors((prev) => {
      const newMap = new Map<string, string>();
      for (const [itemId, error] of prev.entries()) {
        if (currentItemIds.has(itemId)) {
          newMap.set(itemId, error);
        }
      }
      return newMap;
    });

    // Clean up collapsed states
    setCollapsedCards((prev) => {
      const newSet = new Set<string>();
      for (const itemId of prev) {
        if (currentItemIds.has(itemId)) {
          newSet.add(itemId);
        }
      }
      return newSet;
    });

    // Clean up ongoing requests
    setOngoingRequests((prev) => {
      const newMap = new Map<string, Promise<unknown>>();
      for (const [itemId, promise] of prev.entries()) {
        if (currentItemIds.has(itemId)) {
          newMap.set(itemId, promise);
        }
      }
      return newMap;
    });
  }, [basketItems]);

  return (
    <>
      {/* Metadata section */}
      <div className="font-medium p-2 m-2 h-full flex flex-col">
        {/* Header with search and expand/collapse all button - Fixed at top */}
        {basketItems.filter((item) => item.type === "file").length > 0 && (
          <div className="mb-4 p-3 bg-white border border-gray-300 rounded-lg flex-shrink-0">
            {/* Loading progress indicator */}
            {loadingMetadata.size > 0 && (
              <div className="mb-3 p-2 bg-blue-50 border border-blue-200 rounded-md">
                <div className="flex items-center gap-2">
                  <div className="animate-spin rounded-full h-4 w-4 border-2 border-blue-600 border-t-transparent"></div>
                  <span className="text-sm text-blue-700">
                    Loading metadata for {loadingMetadata.size} file
                    {loadingMetadata.size !== 1 ? "s" : ""}...
                  </span>
                </div>
                <ProgressBar
                  progress={
                    basketItems.filter(
                      (item) => item.type === "file" && metadataMap.has(item.id)
                    ).length /
                    Math.max(
                      1,
                      basketItems.filter((item) => item.type === "file").length
                    )
                  }
                />
              </div>
            )}

            {/* Search bar */}
            <div className="flex items-center gap-2 mb-3">
              <div className="relative flex-1">
                <Search
                  size={16}
                  className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400"
                />
                <input
                  type="text"
                  placeholder="Search metadata..."
                  value={searchInput}
                  onChange={(e) =>
                    updateMetadataState({ searchInput: e.target.value })
                  }
                  className="w-full pl-10 pr-10 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                {searchInput && (
                  <button
                    onClick={() => {
                      updateMetadataState({ searchInput: "", searchQuery: "" });
                    }}
                    className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    title="Clear search"
                  >
                    <X size={16} />
                  </button>
                )}
              </div>
            </div>

            {/* Controls row */}
            <div className="flex items-center justify-between">
              <div className="text-sm text-gray-600">
                {searchQuery && (
                  <span>
                    Found {filteredResults.size} file
                    {filteredResults.size !== 1 ? "s" : ""} with matches
                    {searchInput !== searchQuery && (
                      <span className="ml-2 text-gray-400">(searching...)</span>
                    )}
                  </span>
                )}
                {!searchQuery && searchInput && (
                  <span className="text-gray-400">Searching...</span>
                )}
                {!searchQuery && !searchInput && (
                  <span>
                    {basketItems.filter((item) => item.type === "file").length}{" "}
                    file
                    {basketItems.filter((item) => item.type === "file")
                      .length !== 1
                      ? "s"
                      : ""}{" "}
                    in basket
                    {metadataMap.size > 0 && (
                      <span className="ml-1 text-green-600">
                        ({metadataMap.size} loaded)
                      </span>
                    )}
                  </span>
                )}
              </div>
              <button
                onClick={toggleAllCards}
                className="flex items-center gap-2 px-3 py-1 text-sm bg-gray-200 hover:bg-gray-300 transition-colors rounded-md"
                title="Toggle all metadata cards"
              >
                {(() => {
                  const fileItems = basketItems.filter(
                    (item) => item.type === "file"
                  );
                  const fileItemIds = fileItems.map((item) => item.id);
                  const allCollapsed = fileItemIds.every((id) =>
                    collapsedCards.has(id)
                  );

                  return allCollapsed ? (
                    <Tooltip content="Expand all">
                      <span
                        className="flex items-center p-1"
                        title="Expand all"
                      >
                        <Expand size={16} />
                      </span>
                    </Tooltip>
                  ) : (
                    <Tooltip content="Collapse all">
                      <span
                        className="flex items-center p-1"
                        title="Collapse all"
                      >
                        <Minimize size={16} />
                      </span>
                    </Tooltip>
                  );
                })()}
              </button>
            </div>
          </div>
        )}

        {/* No datasets message - Fixed at top when header is hidden */}
        {basketItems.filter((item) => item.type === "file").length === 0 && (
          <div className="h-32 flex flex-col items-center justify-center text-gray-500">
            <BadgeInfo size={48} className="mb-2 text-gray-400" />
            <p>No datasets in basket</p>
            <p className="text-sm mt-1">Add datasets to view their metadata</p>
          </div>
        )}

        {/* Scrollable container for search results or regular metadata cards */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {/* Search results or regular metadata cards */}
          {searchQuery ? (
            // Search results view
            filteredResults.size === 0 ? (
              // Only show "No matches found" if there are files in the basket
              basketItems.filter((item) => item.type === "file").length > 0 ? (
                <div className="text-center text-gray-500 p-4">
                  No matches found for "{searchQuery}"
                </div>
              ) : null
            ) : (
              Array.from(filteredResults.entries()).map(([itemId, result]) => {
                const item = basketItems.find((i) => i.id === itemId);
                if (!item) return null;

                const isCardCollapsed = collapsedCards.has(itemId);

                return (
                  <div
                    key={itemId}
                    className="mb-4 border border-gray-300 rounded-lg overflow-hidden bg-blue-50"
                  >
                    {/* Search Result Card Header */}
                    <div
                      className="bg-blue-100 p-3 cursor-pointer hover:bg-blue-200 transition-colors flex items-center justify-between"
                      onClick={() => toggleCardCollapse(itemId)}
                    >
                      <div className="flex-1 min-w-0">
                        <h3
                          className="text-sm font-semibold truncate"
                          title={item.path}
                        >
                          {result.itemName}
                        </h3>
                        <p className="text-xs text-gray-600 mt-1">
                          {result.matches.length} match
                          {result.matches.length !== 1 ? "es" : ""} found
                        </p>
                      </div>
                      <div className="ml-2 text-gray-500">
                        {isCardCollapsed ? (
                          <EyeOff size={16} className="text-red-600" />
                        ) : (
                          <Eye size={16} className="text-green-600" />
                        )}
                      </div>
                    </div>

                    {/* Search Result Content */}
                    {!isCardCollapsed && (
                      <div className="p-3 bg-white">
                        <h4 className="text-sm font-semibold mb-3 text-blue-700">
                          Search Matches:
                        </h4>
                        <div className="space-y-2 max-h-96 overflow-y-auto">
                          {result.matches.map(
                            (
                              match: {
                                key: string;
                                value: string;
                                path: string[];
                              },
                              index: number
                            ) => (
                              <div
                                key={index}
                                className="p-2 bg-yellow-50 border border-yellow-200 rounded text-xs"
                              >
                                <div className="font-mono text-blue-600 mb-1">
                                  {match.path.join(" → ")}
                                </div>
                                <div className="text-gray-700">
                                  <span className="font-semibold">
                                    {match.key}:
                                  </span>{" "}
                                  <span className="bg-yellow-200 px-1 rounded">
                                    {match.value.length > 100
                                      ? match.value.substring(0, 100) + "..."
                                      : match.value}
                                  </span>
                                </div>
                              </div>
                            )
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )
          ) : (
            // Regular metadata cards view
            basketItems
              .filter((item) => item.type === "file")
              .reverse() // Show newest items at the top
              .map((item) => {
                const isLoading = loadingMetadata.has(item.id);
                const error = metadataErrors.get(item.id);
                const metadata = metadataMap.get(item.id);
                const isCardCollapsed = collapsedCards.has(item.id);

                return (
                  <MetadataCard
                    key={item.id}
                    item={item}
                    isLoading={isLoading}
                    error={error}
                    metadata={metadata}
                    isCardCollapsed={isCardCollapsed}
                    onToggle={() => toggleCardCollapse(item.id)}
                  />
                );
              })
          )}
        </div>
      </div>
    </>
  );
};

// Inside MetadataCard file, above the component:
const parseMetadataValue = (value: unknown) => {
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      // Not valid JSON string, just return as-is
      return value;
    }
  }

  // Already an object/array/number/etc
  return value;
};
// Memoized metadata card component for better performance
const MetadataCard = memo(
  ({
    item,
    isLoading,
    error,
    metadata,
    isCardCollapsed,
    onToggle,
  }: {
    item: BasketItem;
    isLoading: boolean;
    error?: string;
    metadata?: Metadata;
    isCardCollapsed: boolean;
    onToggle: () => void;
  }) => (
    <div className="mb-4 border border-gray-300 rounded-lg overflow-hidden">
      {/* Card Header */}
      <div
        className="bg-gray-200 p-3 cursor-pointer hover:bg-gray-300 transition-colors flex items-center justify-between"
        onClick={onToggle}
      >
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold truncate" title={item.path}>
            {item.name}
          </h3>
        </div>
        <div className="ml-2 text-gray-500">
          {isCardCollapsed ? (
            <EyeOff size={16} className="text-red-600" />
          ) : (
            <Eye size={16} className="text-green-600" />
          )}
        </div>
      </div>

      {/* Card Content */}
      {!isCardCollapsed && (
        <div className="p-3 bg-white">
          {isLoading && (
            <div className="text-center text-gray-500 p-4">
              Loading metadata...
            </div>
          )}
          {error && <div className="text-center text-red-500 p-4">{error}</div>}
          {!isLoading && !error && !metadata && (
            <div className="text-center text-gray-500 p-4">
              No metadata available for this file.
            </div>
          )}
          {metadata &&
            Object.entries(metadata).map(([key, value]) => {
              const parsedValue = parseMetadataValue(value);

              return (
                <div key={key} className="mb-3">
                  <strong className="text-sm">{key}:</strong>
                  <JsonView
                    value={parsedValue as object}
                    style={metadataCustomTheme as React.CSSProperties}
                    indentWidth={10}
                    displayDataTypes={false}
                    enableClipboard={true}
                    displayObjectSize={true}
                    collapsed={key === "Instruments Snapshot" ? 0 : 2}
                  />
                </div>
              );
            })}
        </div>
      )}
    </div>
  )
);

MetadataCard.displayName = "MetadataCard";

export default Metadata;

import { useState } from "react";
import { PROD_BACKEND_URL } from "../config";
import axios from "axios";
import {
  X,
  Download,
  Trash2,
  Database,
  Copy,
  Check,
  Info,
  LoaderCircle,
  Eye,
  EyeOff,
  Variable,
  SquareFunction,
  ShoppingBasket,
  Lightbulb,
} from "lucide-react";

// Local imports
import Tooltip from "./Tooltip";
import { useToast } from "../hooks/useToast";

interface AttrData {
  measurement_id?: string;
  timestamp?: string;
  cryostat?: string;
  wafer_id?: string;
  device_type?: string;
  sample_name?: string;
  experiment_name?: string;
  independents?: string[];
  dependents?: string[];
}

export interface BasketItem {
  id: string;
  name: string;
  path: string;
  type: "file" | "folder";
  size?: number;
  timestamp?: Date | string; // Allow both Date objects and string dates
  tags?: string[];
  attributes?: AttrData; // Optional attributes for files
  lastModified?: number;
}
interface BasketProps {
  items: BasketItem[];
  onRemoveItem: (id: string) => void;
  onClearAll: () => void;
  onDownload?: (items: BasketItem[]) => void;
  onDropItem?: (item: BasketItem) => void;
  externalLoadingAttributes?: Set<string>; // External loading state for items added via Plus/double-click
  highlightedFields?: Set<string>; // Fields to highlight (from PlotComposer)
}

// Component to display the independents and dependents as draggable items with unified styling
const FieldItem = ({
  item,
  basketItemId,
  basketItemPath,
  type,
  selectedItems,
  onToggleSelect,
  isHighlighted = false,
}: {
  item: string;
  basketItemId: string;
  basketItemPath: string;
  type: "independent" | "dependent";
  selectedItems?: Set<string>;
  onToggleSelect?: (itemId: string, ctrlPressed: boolean) => void;
  isHighlighted?: boolean;
}) => {
  const itemId = `${basketItemId}-${item}`;
  const isSelected = selectedItems?.has(itemId) || false;

  const handleDragStart = (e: React.DragEvent) => {
    const ctrlPressed = e.ctrlKey || e.metaKey;

    // If ctrl is pressed and item is not selected, add it to selection
    if (ctrlPressed && !isSelected) {
      onToggleSelect?.(itemId, true);
    }

    // Determine which items to drag
    const itemsToDrag =
      ctrlPressed && selectedItems && selectedItems.size > 0
        ? Array.from(selectedItems)
            .filter((id) => id.includes(`${basketItemId}-`)) // Only items from same basket item
            .map((id) => {
              const fieldName = id.split("-").pop() || "";
              return {
                id,
                name: fieldName,
                type: type,
                source: basketItemPath,
              };
            })
        : [
            {
              id: itemId,
              name: item,
              type: type,
              source: basketItemPath,
            },
          ];

    e.dataTransfer.setData(
      "application/plot-fields",
      JSON.stringify(itemsToDrag)
    );
    e.dataTransfer.effectAllowed = "copy";
  };

  const handleClick = (e: React.MouseEvent) => {
    const ctrlPressed = e.ctrlKey || e.metaKey;
    onToggleSelect?.(itemId, ctrlPressed);
  };

  // Compact styling with better width handling and consistent sizing
  const maxDisplayLength = 8; // Reduced for more compact display
  const displayName =
    item.length > maxDisplayLength
      ? `${item.substring(0, maxDisplayLength)}...`
      : item;
  const shouldShowTooltip = item.length > maxDisplayLength;

  // Style configuration based on type
  const styleConfig = {
    independent: {
      bgColor: isSelected ? "bg-blue-200" : "bg-blue-100",
      hoverColor: "hover:bg-blue-300",
      ringColor: "ring-blue-400",
      textColor: "text-blue-900",
      icon: Variable,
    },
    dependent: {
      bgColor: isSelected ? "bg-red-200" : "bg-red-100",
      hoverColor: "hover:bg-red-300",
      ringColor: "ring-red-400",
      textColor: "text-red-900",
      icon: SquareFunction,
    },
  };

  const config = styleConfig[type];
  const IconComponent = config.icon;

  const content = (
    <div
      className={`
        flex items-center space-x-1 rounded p-1.5 cursor-grab active:cursor-grabbing 
        transition-all duration-200 min-w-[70px] max-w-[90px]
        ${config.bgColor} ${config.hoverColor}
        ${isSelected ? `ring-2 ${config.ringColor}` : ""}
        ${isHighlighted ? "ring-2 ring-yellow-400 shadow-lg" : ""}
      `}
      draggable
      onDragStart={handleDragStart}
      onClick={handleClick}
    >
      <IconComponent
        size={15}
        className={`${config.textColor} flex-shrink-0`}
      />
      <span className={`text-xs ${config.textColor} truncate font-medium`}>
        {displayName}
      </span>
    </div>
  );

  return shouldShowTooltip ? (
    <Tooltip content={item} position="top">
      {content}
    </Tooltip>
  ) : (
    content
  );
};

const Basket = ({
  items,
  onRemoveItem,
  onClearAll,
  onDownload,
  onDropItem,
  externalLoadingAttributes = new Set(),
  highlightedFields = new Set(),
}: BasketProps) => {
  const { showToast } = useToast();
  const [isExpanded, setIsExpanded] = useState(true);
  const [isDragOver, setIsDragOver] = useState(false);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [copiedItems, setCopiedItems] = useState<{
    [key: string]: "filename" | "path" | null;
  }>({});

  // Copy functions that track per-item state
  const copyToClipboard = async (
    text: string,
    itemId: string,
    type: "filename" | "path"
  ): Promise<boolean> => {
    try {
      // Modern API
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        setCopiedItems((prev) => ({ ...prev, [itemId]: type }));
        setTimeout(
          () => setCopiedItems((prev) => ({ ...prev, [itemId]: null })),
          2000
        );
        return true;
      }
      // Fallback for older browsers
      else {
        const textArea = document.createElement("textarea");
        textArea.value = text;
        textArea.style.position = "fixed";
        textArea.style.left = "-999999px";
        textArea.style.top = "-999999px";
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();

        const success = document.execCommand("copy");
        document.body.removeChild(textArea);

        if (success) {
          setCopiedItems((prev) => ({ ...prev, [itemId]: type }));
          setTimeout(
            () => setCopiedItems((prev) => ({ ...prev, [itemId]: null })),
            2000
          );
        }
        return success;
      }
    } catch (error) {
      console.error("Failed to copy to clipboard:", error);
      showToast("Failed to copy to clipboard", "error");
      return false;
    }
  };

  const handleToggleSelect = (itemId: string, ctrlPressed: boolean) => {
    setSelectedItems((prev) => {
      const newSet = new Set(prev);

      if (ctrlPressed) {
        // Multi-select mode
        if (newSet.has(itemId)) {
          newSet.delete(itemId);
        } else {
          newSet.add(itemId);
        }
      } else {
        // Single select mode
        newSet.clear();
        newSet.add(itemId);
      }

      return newSet;
    });
  };

  // Get attribute tooltip content for display
  const getAttr = (item: BasketItem) => {
    return item.attributes ? (
      <div className="flex flex-col">
        {/* File size info */}
        {item.size && (
          <div className="text-sm mb-2 pb-2 border-b border-gray-600">
            <span className="font-medium text-blue-200">Size:</span>{" "}
            <span className="text-white">{formatSize(item.size)}</span>
          </div>
        )}
        {Object.entries(item.attributes)
          .filter(([key]) => key !== "independents" && key !== "dependents")
          .map(
            ([key, value]) =>
              value &&
              value !== "N/A" && (
                <div key={key} className="text-sm" title={`${key}: ${value}`}>
                  <span className="font-medium text-blue-200">{key}:</span>{" "}
                  <span className="text-white">{value}</span>
                </div>
              )
          )}
      </div>
    ) : (
      <div className="flex flex-col">
        {/* File size info even when attributes aren't loaded */}
        {item.size && (
          <div className="text-sm mb-2">
            <span className="font-medium text-blue-200">Size:</span>{" "}
            <span className="text-white">{formatSize(item.size)}</span>
          </div>
        )}
        <span className="text-sm">No attributes available</span>
      </div>
    );
  };

  // Format file size
  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024)
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Only set drag over if we have the right data type
    if (e.dataTransfer.types.includes("application/json")) {
      setIsDragOver(true);
    }
  };
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    // Check if we're leaving the actual drop zone
    const target = e.currentTarget as HTMLElement;
    const relatedTarget = e.relatedTarget as HTMLElement;

    // If the related target is not a child of the drop zone, we're leaving
    if (!target.contains(relatedTarget)) {
      setIsDragOver(false);
    }
  };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    try {
      const droppedData = e.dataTransfer.getData("application/json");
      if (!droppedData) {
        console.warn("No data found in drop event");
        showToast("No data found in drop event", "warning");
        return;
      }

      const parsedData = JSON.parse(droppedData);

      // Handle both single items and arrays of items
      const itemsToAdd: BasketItem[] = Array.isArray(parsedData)
        ? parsedData
        : [parsedData];

      // Process each item
      itemsToAdd.forEach((item: BasketItem) => {
        // Validate the dropped item has required fields
        if (!item.id || !item.name || !item.path || !item.type) {
          console.error("Invalid item dropped:", item);
          showToast("Invalid item dropped", "error");
          return;
        }

        // Convert timestamp string back to Date if needed (JSON serialization converts dates to strings)
        if (item.timestamp && typeof item.timestamp === "string") {
          const date = new Date(item.timestamp);
          if (!isNaN(date.getTime())) {
            item.timestamp = date;
          }
        }

        // Call onDropItem to add the item - attribute loading is now handled by parent (Viewer)
        onDropItem?.(item);
      });

      // Show appropriate success message
      if (itemsToAdd.length > 1) {
        showToast(`Added ${itemsToAdd.length} datasets to basket`, "success");
      }
    } catch (error) {
      console.error("Error handling dropped item:", error);
      showToast("Error handling dropped item", "error");
    }
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div>
      {/* Basket */}
      <div
        className={`bg-white border border-gray-300 rounded-lg shadow-sm transition-all ${
          isDragOver ? "border-blue-500 bg-blue-50 shadow-lg" : ""
        }`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDragEnter={handleDragEnter}
        onDrop={handleDrop}
      >
        <div
          className="flex items-center justify-between p-2 bg-gray-50 border-b border-gray-200 rounded-lg cursor-pointer"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          <h3 className="font-semibold text-gray-900 flex items-center">
            <ShoppingBasket size={16} className="mr-1.5 align-middle mb-0.5" />{" "}
            <span>
              Basket<span className="ml-[1.5px]">({items.length})</span>
              {isDragOver && (
                <span className="ml-2 text-blue-600 text-sm">
                  Drop items here!
                </span>
              )}
            </span>
          </h3>
          <div className="flex items-center">
            {/* Help tooltip */}
            <div className="mr-2">
              <Tooltip
                content={
                  <div className="text-left space-y-2">
                    <div className="font-semibold text-blue-200">
                      Field Types
                    </div>
                    <div className="flex items-center gap-2">
                      <Variable size={15} className="text-blue-300" />
                      <span className="text-white">Independents</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <SquareFunction size={15} className="text-red-300" />
                      <span className="text-white">Dependents</span>
                    </div>
                  </div>
                }
                position="bottom"
              >
                <button
                  className="p-1 text-gray-600 hover:text-yellow-600 hover:bg-yellow-200 rounded"
                  title="Field types help"
                >
                  <Lightbulb size={16} />
                </button>
              </Tooltip>
            </div>

            {items.length > 0 && (
              <>
                {onDownload && (
                  <div className="mr-2">
                    <Tooltip content="Download basket" position="bottom">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onDownload(items);
                        }}
                        className="p-1 text-blue-600 hover:text-blue-800 hover:bg-blue-100 rounded"
                        aria-label="Download basket"
                      >
                        <Download size={16} />
                      </button>
                    </Tooltip>
                  </div>
                )}
                <div className="mr-2">
                  <Tooltip content="Clear basket" position="bottom">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onClearAll();
                      }}
                      className="p-1 text-red-600 hover:text-red-800 hover:bg-red-100 rounded"
                      aria-label="Clear basket"
                    >
                      <Trash2 size={16} />
                    </button>
                  </Tooltip>
                </div>
              </>
            )}
            <Tooltip
              content={isExpanded ? "Collapse basket" : "Expand basket"}
              position="left"
            >
              <button
                className="p-1 rounded"
                aria-label={isExpanded ? "Collapse basket" : "Expand basket"}
              >
                {isExpanded ? (
                  <EyeOff size={16} className="text-red-600" />
                ) : (
                  <Eye size={16} className="text-green-600" />
                )}
              </button>
            </Tooltip>
          </div>
        </div>

        {/* Basket Items - Horizontal scrolling container */}
        {isExpanded && (
          // TODOLATER: This fine? 166px is a bit arbitrary.
          <div className="h-[166px] overflow-x-auto overflow-y-hidden scrollbar-thin scrollbar-track-gray-100 scrollbar-thumb-gray-300 hover:scrollbar-thumb-gray-400 relative">
            {items.length === 0 ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-500">
                <ShoppingBasket size={48} className="mb-2 text-gray-400" />
                <p>No items selected</p>
                <p className="text-sm mt-1">Add datasets from the explorer</p>
              </div>
            ) : (
              <div className="p-2 flex gap-2 min-w-fit">
                {items.map((item) => (
                  <div
                    key={item.id}
                    className="flex flex-col bg-gray-50 hover:bg-gray-100 rounded p-2 transition-all duration-200 border border-gray-200 flex-shrink-0 w-[250px]"
                  >
                    {/* Compact header with item info */}
                    <div className="flex flex-col space-y-1 mb-2">
                      <div className="flex items-center justify-between">
                        {/* Left side: Info and Database icon with title */}
                        <div className="flex items-center min-w-0 flex-1">
                          {/* Attributes status */}
                          <div className="mr-1">
                            <Tooltip content={getAttr(item)} position="bottom">
                              <span className="text-sm text-gray-500 flex-shrink-0">
                                {item.attributes ? (
                                  <Info size={15} className="text-blue-500" />
                                ) : externalLoadingAttributes.has(item.id) ? (
                                  <LoaderCircle
                                    size={15}
                                    className="text-blue-500 animate-spin"
                                  />
                                ) : (
                                  <Info size={15} className="text-gray-400" />
                                )}
                              </span>
                            </Tooltip>
                          </div>

                          {/* Database icon and name */}
                          <div className="mr-1">
                            <Database
                              size={15}
                              className="text-green-500 flex-shrink-0"
                            />
                          </div>

                          {/* live indicator removed */}

                          <div className="min-w-0 flex-1">
                            <Tooltip content={item.name} position="top">
                              <span
                                className="text-xs font-semibold text-gray-900 truncate block"
                                title={item.name}
                              >
                                {item.name}
                              </span>
                            </Tooltip>
                          </div>
                        </div>

                        {/* Action buttons */}
                        <div className="flex items-center">
                          {/* Copy buttons */}
                          <Tooltip content="Copy filename" position="top">
                            <button
                              onClick={async () =>
                                await copyToClipboard(
                                  item.name,
                                  item.id,
                                  "filename"
                                )
                              }
                              className="p-1 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                              title="Copy filename"
                            >
                              {copiedItems[item.id] === "filename" ? (
                                <Check size={14} className="text-green-600" />
                              ) : (
                                <Copy size={14} />
                              )}
                            </button>
                          </Tooltip>

                          {/* Download button */}
                          <Tooltip content="Download" position="top">
                            <button
                              onClick={async () => {
                                try {
                                  const response = await axios.post(
                                    `${PROD_BACKEND_URL}/download-multiple/`,
                                    { paths: [item.path] },
                                    { responseType: "blob" }
                                  );
                                  const url = window.URL.createObjectURL(
                                    new Blob([response.data])
                                  );
                                  const link = document.createElement("a");
                                  link.href = url;
                                  link.setAttribute(
                                    "download",
                                    `${item.name}.zip`
                                  );
                                  document.body.appendChild(link);
                                  link.click();
                                  link.remove();
                                  window.URL.revokeObjectURL(url);
                                } catch (error) {
                                  console.error(
                                    "Error downloading item:",
                                    error
                                  );
                                  showToast("Failed to download item", "error");
                                }
                              }}
                              className="p-1 text-gray-400 hover:text-blue-600 hover:bg-blue-100 rounded transition-colors"
                              title="Download"
                            >
                              <Download size={14} />
                            </button>
                          </Tooltip>

                          {/* live toggle removed */}

                          {/* Remove button */}
                          <Tooltip content="Remove" position="top">
                            <button
                              onClick={() => onRemoveItem(item.id)}
                              className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-100 rounded transition-colors"
                              title="Remove"
                            >
                              <X size={14} />
                            </button>
                          </Tooltip>
                        </div>
                      </div>

                      {/* Wafer ID if available */}
                      {item.attributes && item.attributes.wafer_id && (
                        <span className="text-xs text-gray-500 bg-blue-100 px-1 py-0.5 rounded truncate">
                          {item.attributes.wafer_id}
                        </span>
                      )}
                    </div>

                    {/* Fields section with fixed height and loading placeholders */}
                    <div className="space-y-1.5">
                      {/* Independents Section */}
                      <div className="max-h-[64px] overflow-x-auto overflow-y-hidden scrollbar-thin scrollbar-track-gray-100 scrollbar-thumb-gray-300 hover:scrollbar-thumb-gray-400 p-1 bg-blue-50 rounded border border-blue-200">
                        <div className="flex flex-nowrap gap-1 w-max h-[32px] items-center">
                          {!item.attributes ? (
                            // Loading placeholder
                            <>
                              <div className="h-5 w-12 bg-blue-200 rounded animate-pulse flex-shrink-0"></div>
                              <div className="h-5 w-16 bg-blue-200 rounded animate-pulse flex-shrink-0"></div>
                              <div className="h-5 w-10 bg-blue-200 rounded animate-pulse flex-shrink-0"></div>
                            </>
                          ) : item.attributes.independents &&
                            item.attributes.independents.length > 0 ? (
                            item.attributes.independents.map((indep) => {
                              const fieldId = `${item.name}-${indep}`;
                              return (
                                <FieldItem
                                  key={indep}
                                  item={indep}
                                  basketItemId={item.name}
                                  basketItemPath={item.path}
                                  type="independent"
                                  selectedItems={selectedItems}
                                  onToggleSelect={handleToggleSelect}
                                  isHighlighted={highlightedFields.has(fieldId)}
                                />
                              );
                            })
                          ) : (
                            <div className="text-xs text-blue-400 flex items-center w-full h-5">
                              No independent variables
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Dependents Section */}
                      <div className="max-h-[64px] overflow-x-auto overflow-y-hidden scrollbar-thin scrollbar-track-gray-100 scrollbar-thumb-gray-300 hover:scrollbar-thumb-gray-400 p-1 bg-red-50 rounded border border-red-200">
                        <div className="flex flex-nowrap gap-1 w-max h-[32px] items-center">
                          {!item.attributes ? (
                            // Loading placeholder
                            <>
                              <div className="h-5 w-14 bg-red-200 rounded animate-pulse flex-shrink-0"></div>
                              <div className="h-5 w-10 bg-red-200 rounded animate-pulse flex-shrink-0"></div>
                              <div className="h-5 w-12 bg-red-200 rounded animate-pulse flex-shrink-0"></div>
                            </>
                          ) : item.attributes.dependents &&
                            item.attributes.dependents.length > 0 ? (
                            item.attributes.dependents.map((dep) => {
                              const fieldId = `${item.name}-${dep}`;
                              return (
                                <FieldItem
                                  key={dep}
                                  item={dep}
                                  basketItemId={item.name}
                                  basketItemPath={item.path}
                                  type="dependent"
                                  selectedItems={selectedItems}
                                  onToggleSelect={handleToggleSelect}
                                  isHighlighted={highlightedFields.has(fieldId)}
                                />
                              );
                            })
                          ) : (
                            <div className="text-xs text-red-400 flex items-center w-full h-5">
                              No dependent variables
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default Basket;

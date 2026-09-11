import { memo, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { PROD_BACKEND_URL } from "../config";
import axios from "axios";
import {
  X,
  Download,
  Trash2,
  Database,
  FileArchive,
  FileText,
  HardDrive,
  Table,
  Copy,
  Check,
  Info,
  LoaderCircle,
  Eye,
  EyeOff,
  Variable,
  SquareFunction,
  ShoppingBasket,
  NotebookPen,
} from "lucide-react";

// Local imports
import Tooltip from "./Tooltip";
import SectionRibbon, { ribbonButtonClass } from "./SectionRibbon";
import { useShortcut } from "../hooks/useGlobalShortcuts";
import { useSidebarStore } from "../stores/sidebarStore";
import { useToast } from "../hooks/useToast";
import { SharedFieldResult, isFieldShared } from "../utils/datasetFieldSelectors";
import { detectDatasetKind, isDatasetPath, isSqliteContainerPath } from "../utils/datasetPaths";
import { finishArchiveDownload } from "../utils/download";
import type { AttrData } from "./interfaces";

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

export interface BasketFieldSelection {
  id: string;
  source: string;
  name: string;
  type: "independent" | "dependent";
}

interface BasketProps {
  items: BasketItem[];
  selectedDatasetIds: Set<string>;
  onToggleDatasetSelection: (datasetId: string, multiSelect: boolean) => void;
  onRemoveItem: (id: string) => void;
  onClearAll: () => void;
  onDownload?: (items: BasketItem[]) => void;
  onDropItem?: (item: BasketItem) => void;
  externalLoadingAttributes?: Set<string>; // External loading state for items added via Plus/double-click
  highlightedFields?: Set<string>; // Fields to highlight (from PlotComposer)
  sharedFields: SharedFieldResult;
  enforceSharedGating: boolean;
  onAutofillComposerField?: (field: BasketFieldSelection) => void;
  onOpenNotesItem?: (item: BasketItem) => void;
}

// One ResizeObserver for every field row. Each row used to construct its own,
// so a basket of ~90 datasets meant ~180 observers all waking on the same
// layout pass -- a large part of why a full basket slowed the whole app
// (gitlab#12). One observer with a per-element callback does the same work.
const rowResizeCallbacks = new WeakMap<Element, () => void>();
let sharedRowObserver: ResizeObserver | null = null;

const observeRowResize = (element: Element, onResize: () => void): (() => void) => {
  rowResizeCallbacks.set(element, onResize);

  if (!sharedRowObserver) {
    sharedRowObserver = new ResizeObserver((entries) => {
      entries.forEach((entry) => rowResizeCallbacks.get(entry.target)?.());
    });
  }

  sharedRowObserver.observe(element);

  return () => {
    rowResizeCallbacks.delete(element);
    sharedRowObserver?.unobserve(element);
  };
};

// Component to display the independents and dependents as draggable items with unified styling
const FieldItem = memo(
  ({
    item,
    basketItemId,
    basketItemPath,
    type,
    isSelected = false,
    getSelectedItems,
    onToggleSelect,
    isDisabled = false,
    isHighlighted = false,
    onAutofillComposerField,
  }: {
    item: string;
    basketItemId: string;
    basketItemPath: string;
    type: "independent" | "dependent";
    // A boolean rather than the selection Set: the Set changes identity on every
    // selection, which would re-render every chip in the basket through memo.
    isSelected?: boolean;
    // Ctrl-drag needs the whole selection, but only at drag time -- a stable
    // getter keeps it out of the props that decide whether to re-render.
    getSelectedItems?: () => Set<string>;
    onToggleSelect?: (itemId: string, ctrlPressed: boolean) => void;
    isDisabled?: boolean;
    isHighlighted?: boolean;
    onAutofillComposerField?: (field: BasketFieldSelection) => void;
  }) => {
    const itemId = `${basketItemId}-${item}`;

    const handleDragStart = (e: React.DragEvent) => {
      if (isDisabled) {
        e.preventDefault();
        return;
      }

      const ctrlPressed = e.ctrlKey || e.metaKey;

      // If ctrl is pressed and item is not selected, add it to selection
      if (ctrlPressed && !isSelected) {
        onToggleSelect?.(itemId, true);
      }

      // Determine which items to drag
      const selection = getSelectedItems?.();
      const itemsToDrag =
        ctrlPressed && selection && selection.size > 0
          ? Array.from(selection)
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

      e.dataTransfer.setData("application/plot-fields", JSON.stringify(itemsToDrag));
      e.dataTransfer.effectAllowed = "copy";
    };

    const handleClick = (e: React.MouseEvent) => {
      e.stopPropagation();
      if (isDisabled) {
        return;
      }
      const ctrlPressed = e.ctrlKey || e.metaKey;
      onToggleSelect?.(itemId, ctrlPressed);
    };

    const handleDoubleClick = (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (isDisabled) {
        return;
      }
      onAutofillComposerField?.({
        id: itemId,
        source: basketItemPath,
        name: item,
        type,
      });
    };

    // Compact styling with better width handling and consistent sizing
    const maxDisplayLength = 8; // Reduced for more compact display
    const displayName =
      item.length > maxDisplayLength ? `${item.substring(0, maxDisplayLength)}...` : item;
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
        ${isDisabled ? "opacity-45 cursor-not-allowed hover:bg-gray-200" : ""}
        ${isHighlighted ? "ring-2 ring-yellow-400 shadow-lg" : ""}
      `}
        draggable={!isDisabled}
        onDragStart={handleDragStart}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
      >
        <IconComponent size={15} className={`${config.textColor} shrink-0`} />
        <span className={`text-xs ${config.textColor} truncate font-medium`}>{displayName}</span>
      </div>
    );

    return shouldShowTooltip ? (
      <Tooltip content={item} position="top">
        {content}
      </Tooltip>
    ) : (
      content
    );
  },
);
FieldItem.displayName = "FieldItem";

// A horizontal, scrollable row of independent/dependent field chips. When the
// chips overflow the panel width, a dropdown button appears; hovering it shows
// the FULL list in a wrapped popup (portaled to <body> so it escapes the
// basket's overflow-clipping ancestors). Horizontal scroll is kept as-is.
const FieldsRow = memo(
  ({
    type,
    loading,
    fields,
    itemName,
    itemPath,
    selectedItems,
    getSelectedItems,
    onToggleSelect,
    onAutofillComposerField,
    isChipEnabled,
    highlightedFields,
  }: {
    type: "independent" | "dependent";
    loading: boolean;
    fields: string[];
    itemName: string;
    itemPath: string;
    selectedItems?: Set<string>;
    getSelectedItems?: () => Set<string>;
    onToggleSelect?: (itemId: string, ctrlPressed: boolean) => void;
    onAutofillComposerField?: (field: BasketFieldSelection) => void;
    isChipEnabled: (field: string) => boolean;
    highlightedFields: Set<string>;
  }) => {
    const sectionRef = useRef<HTMLDivElement>(null);
    const scrollRef = useRef<HTMLDivElement>(null);
    const closeTimer = useRef<number | undefined>(undefined);
    const [overflowing, setOverflowing] = useState(false);
    const [expanded, setExpanded] = useState(false);
    const [rect, setRect] = useState<{ top: number; left: number; width: number } | null>(null);

    // Detect horizontal overflow (re-checks on resize and when fields change).
    useEffect(() => {
      const el = scrollRef.current;
      if (!el) return;
      const check = () => setOverflowing(el.scrollWidth > el.clientWidth + 1);
      check();
      return observeRowResize(el, check);
    }, [fields, loading]);

    const isIndep = type === "independent";
    const palette = isIndep ? "bg-blue-50 border-blue-200" : "bg-red-50 border-red-200";
    const placeholderBg = isIndep ? "bg-blue-200" : "bg-red-200";
    const emptyText = isIndep ? "text-blue-400" : "text-red-400";
    // Right-edge fade so the cut-off chips look intentional, plus a soft pill
    // button. The stops come from tokens: `from-blue-50` is not remapped for
    // dark mode the way `bg-blue-50` is, so a literal left a pale band sitting
    // over the dark panel.
    const fadeVar = isIndep ? "--qimchi-basket-fade-indep" : "--qimchi-basket-fade-dep";

    const renderChip = (f: string) => (
      <FieldItem
        key={f}
        item={f}
        basketItemId={itemName}
        basketItemPath={itemPath}
        type={type}
        getSelectedItems={getSelectedItems}
        onToggleSelect={onToggleSelect}
        isDisabled={!isChipEnabled(f)}
        isSelected={selectedItems?.has(`${itemName}-${f}`) ?? false}
        isHighlighted={highlightedFields.has(`${itemName}-${f}`)}
        onAutofillComposerField={onAutofillComposerField}
      />
    );

    const expand = () => {
      window.clearTimeout(closeTimer.current);
      const el = sectionRef.current;
      if (el) {
        const r = el.getBoundingClientRect();
        setRect({ top: r.top, left: r.left, width: r.width });
      }
      setExpanded(true);
    };
    const scheduleCollapse = () => {
      closeTimer.current = window.setTimeout(() => setExpanded(false), 100);
    };

    const canExpand = !loading && fields.length > 0 && overflowing;

    return (
      <div
        ref={sectionRef}
        className={`relative max-h-[64px] p-1 rounded border ${palette}`}
        onMouseEnter={canExpand ? expand : undefined}
        onMouseLeave={canExpand ? scheduleCollapse : undefined}
      >
        <div
          ref={scrollRef}
          className="overflow-x-auto overflow-y-hidden scrollbar-thin scrollbar-track-gray-100 scrollbar-thumb-gray-300 hover:scrollbar-thumb-gray-400"
        >
          <div className="flex flex-nowrap gap-1 w-max h-[32px] items-center">
            {loading ? (
              <>
                <div className={`h-5 w-12 ${placeholderBg} rounded animate-pulse shrink-0`}></div>
                <div className={`h-5 w-16 ${placeholderBg} rounded animate-pulse shrink-0`}></div>
                <div className={`h-5 w-10 ${placeholderBg} rounded animate-pulse shrink-0`}></div>
              </>
            ) : fields.length > 0 ? (
              fields.map(renderChip)
            ) : (
              <div className={`text-xs ${emptyText} flex items-center w-full h-5`}>
                No {type} variables
              </div>
            )}
          </div>
        </div>

        {/* Overflow hint: right-edge opacity fade (hidden once expanded). */}
        {canExpand && !expanded && (
          <div
            className="pointer-events-none absolute inset-y-0 right-0 w-10 rounded-r"
            style={{
              backgroundImage: `linear-gradient(to left, var(${fadeVar}), color-mix(in srgb, var(${fadeVar}) 90%, transparent), transparent)`,
            }}
          />
        )}

        {/* On hover, the row "extends" into a wrapped overlay showing every chip.
          Portaled to <body> so it escapes the basket's overflow-clipping
          ancestors; same width/background/border/position as the row, so it
          reads as the same container simply growing taller. */}
        {expanded &&
          rect &&
          createPortal(
            <div
              onMouseEnter={expand}
              onMouseLeave={scheduleCollapse}
              style={{
                position: "fixed",
                top: rect.top,
                left: rect.left,
                width: rect.width,
              }}
              className={`qimchi-fade-in z-[9999] p-1 rounded border shadow-lg ${palette}`}
            >
              <div className="flex flex-wrap gap-1">{fields.map(renderChip)}</div>
            </div>,
            document.body,
          )}
      </div>
    );
  },
);
FieldsRow.displayName = "FieldsRow";

const Basket = ({
  items,
  selectedDatasetIds,
  onToggleDatasetSelection,
  onRemoveItem,
  onClearAll,
  onDownload,
  onDropItem,
  externalLoadingAttributes = new Set(),
  highlightedFields = new Set(),
  sharedFields,
  enforceSharedGating,
  onAutofillComposerField,
  onOpenNotesItem,
}: BasketProps) => {
  const { showToast } = useToast();
  // Persisted, so a refresh keeps the Basket the way it was left.
  const basketCollapsed = useSidebarStore((state) => state.basketCollapsed);
  const setBasketCollapsed = useSidebarStore((state) => state.setBasketCollapsed);
  const isExpanded = !basketCollapsed;
  const toggleExpanded = useCallback(
    () => setBasketCollapsed(!basketCollapsed),
    [basketCollapsed, setBasketCollapsed],
  );

  useShortcut("toggle-basket", toggleExpanded);
  const [isDragOver, setIsDragOver] = useState(false);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [copiedItems, setCopiedItems] = useState<{
    [key: string]: "filename" | "path" | null;
  }>({});

  // Copy functions that track per-item state
  const copyToClipboard = async (
    text: string,
    itemId: string,
    type: "filename" | "path",
  ): Promise<boolean> => {
    try {
      // Modern API
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        setCopiedItems((prev) => ({ ...prev, [itemId]: type }));
        setTimeout(() => setCopiedItems((prev) => ({ ...prev, [itemId]: null })), 2000);
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
          setTimeout(() => setCopiedItems((prev) => ({ ...prev, [itemId]: null })), 2000);
        }
        return success;
      }
    } catch (error) {
      console.error("Failed to copy to clipboard:", error);
      showToast("Failed to copy to clipboard", "error");
      return false;
    }
  };

  // Mirrored in a ref so FieldItem can read the selection at drag time
  // without taking it as a prop.
  const selectedItemsRef = useRef(selectedItems);
  useEffect(() => {
    selectedItemsRef.current = selectedItems;
  }, [selectedItems]);
  const getSelectedItems = useCallback(() => selectedItemsRef.current, []);

  const handleToggleSelect = useCallback((itemId: string, ctrlPressed: boolean) => {
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
  }, []);

  // Stable per-type predicates: an inline arrow here was a new function on
  // every render, which defeated FieldsRow's memo for every card.
  const isSharedChipEnabled = useCallback(
    (fieldName: string, type: "independent" | "dependent") => {
      if (!enforceSharedGating || selectedDatasetIds.size <= 1) {
        return true;
      }

      return isFieldShared(fieldName, type, sharedFields);
    },
    [enforceSharedGating, selectedDatasetIds, sharedFields],
  );

  const isIndepChipEnabled = useCallback(
    (field: string) => isSharedChipEnabled(field, "independent"),
    [isSharedChipEnabled],
  );

  const isDepChipEnabled = useCallback(
    (field: string) => isSharedChipEnabled(field, "dependent"),
    [isSharedChipEnabled],
  );

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
              ),
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
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  };

  const renderBasketDatasetIcon = (item: BasketItem) => {
    const datasetKind = detectDatasetKind(item.path, item.tags);
    switch (datasetKind) {
      case "zarr":
        return <FileArchive size={15} className="text-violet-600 shrink-0" />;
      case "netcdf":
        return <FileText size={15} className="text-sky-600 shrink-0" />;
      case "hdf5":
        return <HardDrive size={15} className="text-indigo-600 shrink-0" />;
      case "qcodes":
        return <Database size={15} className="text-teal-600 shrink-0" />;
      case "sqlite":
        return <Database size={15} className="text-emerald-600 shrink-0" />;
      case "csv":
        return <Table size={15} className="text-orange-600 shrink-0" />;
      default:
        return <Database size={15} className="text-green-500 shrink-0" />;
    }
  };

  const getDatasetTypeLabel = (item: BasketItem): string => {
    const datasetKind = detectDatasetKind(item.path, item.tags);
    switch (datasetKind) {
      case "zarr":
        return "Type: Zarr";
      case "netcdf":
        return "Type: NetCDF";
      case "hdf5":
        return "Type: HDF5";
      case "qcodes":
        return "Type: QCoDeS";
      case "sqlite":
        return "Type: SQLite";
      case "csv":
        return "Type: CSV/TXT/DAT";
      default:
        return "Type: Unknown";
    }
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
      const itemsToAdd: BasketItem[] = Array.isArray(parsedData) ? parsedData : [parsedData];

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
          isExpanded ? "flex items-stretch" : ""
        } ${isDragOver ? "border-blue-500 bg-blue-50 shadow-lg" : ""}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDragEnter={handleDragEnter}
        onDrop={handleDrop}
      >
        {/* Basket Items - Horizontal scrolling container */}
        {isExpanded && (
          // TODOLATER: This fine? 166px is a bit arbitrary.
          <div className="h-[166px] min-w-0 flex-1 overflow-x-auto overflow-y-hidden scrollbar-thin scrollbar-track-gray-100 scrollbar-thumb-gray-300 hover:scrollbar-thumb-gray-400 relative">
            {items.length === 0 ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-500">
                <ShoppingBasket size={48} className="mb-2 text-gray-400" />
                <p>{isDragOver ? "Drop items here!" : "No items selected"}</p>
                <p className="text-sm mt-1">Add datasets from the explorer</p>
              </div>
            ) : (
              <div className="p-2 flex gap-2 min-w-fit">
                {items.map((item) => (
                  // Dataset-card selection is the source of truth for plotting scope.
                  <div
                    key={item.id}
                    data-basket-item-card="true"
                    onClick={(e) =>
                      onToggleDatasetSelection(item.id, Boolean(e.ctrlKey || e.metaKey))
                    }
                    className={`flex flex-col rounded p-2 transition-all duration-200 border shrink-0 w-[250px] cursor-pointer ${
                      selectedDatasetIds.has(item.id)
                        ? "bg-slate-100 border-slate-400 ring-1 ring-slate-400"
                        : "bg-gray-50 hover:bg-gray-100 border-gray-200"
                    }`}
                  >
                    {/* Compact header with item info */}
                    <div className="flex flex-col space-y-1 mb-2">
                      <div className="flex items-center justify-between">
                        {/* Left side: Info and Database icon with title */}
                        <div className="flex items-center min-w-0 flex-1">
                          {/* Attributes status */}
                          <div className="mr-1">
                            <Tooltip content={getAttr(item)} position="bottom">
                              <span className="text-sm text-gray-500 shrink-0">
                                {item.attributes ? (
                                  <Info size={15} className="text-blue-500" />
                                ) : externalLoadingAttributes.has(item.id) ? (
                                  <LoaderCircle size={15} className="text-blue-500 animate-spin" />
                                ) : (
                                  <Info size={15} className="text-gray-400" />
                                )}
                              </span>
                            </Tooltip>
                          </div>

                          {/* Database icon and name */}
                          <div className="mr-1">
                            <Tooltip
                              content={getDatasetTypeLabel(item)}
                              position="top"
                              className="flex items-center"
                            >
                              <span className="inline-flex items-center justify-center leading-none">
                                {renderBasketDatasetIcon(item)}
                              </span>
                            </Tooltip>
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
                              onClick={async (e) => {
                                e.stopPropagation();
                                await copyToClipboard(item.name, item.id, "filename");
                              }}
                              className="qimchi-dark-hover-plain p-1 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
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
                              onClick={async (e) => {
                                e.stopPropagation();
                                try {
                                  const response = await axios.post(
                                    `${PROD_BACKEND_URL}/download-multiple/`,
                                    { paths: [item.path] },
                                    { responseType: "blob" },
                                  );
                                  const result = finishArchiveDownload(
                                    response,
                                    `${item.name}.zip`,
                                  );
                                  if (result.savedTo) {
                                    showToast(`Saved to ${result.savedTo}`, "success");
                                  }
                                } catch (error) {
                                  console.error("Error downloading item:", error);
                                  showToast("Failed to download item", "error");
                                }
                              }}
                              className="qimchi-dark-hover-plain p-1 text-gray-400 hover:text-blue-600 hover:bg-blue-100 rounded transition-colors"
                              title="Download"
                              aria-label={`Download ${item.name}`}
                            >
                              <Download size={14} />
                            </button>
                          </Tooltip>

                          {/* Open notes button - any dataset except sqlite container nodes */}
                          {isDatasetPath(item.path) &&
                            !isSqliteContainerPath(item.path) &&
                            onOpenNotesItem && (
                              <Tooltip content="Open notes" position="top">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onOpenNotesItem(item);
                                  }}
                                  className="qimchi-dark-hover-plain p-1 text-gray-400 hover:text-purple-600 hover:bg-purple-50 rounded transition-colors"
                                  title="Open notes"
                                >
                                  <NotebookPen size={14} />
                                </button>
                              </Tooltip>
                            )}

                          {/* live toggle removed */}

                          {/* Remove button */}
                          <Tooltip content="Remove" position="top">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onRemoveItem(item.id);
                              }}
                              className="qimchi-dark-hover-plain p-1 text-gray-400 hover:text-red-600 hover:bg-red-100 rounded transition-colors"
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
                      <FieldsRow
                        type="independent"
                        loading={!item.attributes}
                        fields={item.attributes?.independents ?? []}
                        itemName={item.name}
                        itemPath={item.path}
                        selectedItems={selectedItems}
                        getSelectedItems={getSelectedItems}
                        onToggleSelect={handleToggleSelect}
                        onAutofillComposerField={onAutofillComposerField}
                        isChipEnabled={isIndepChipEnabled}
                        highlightedFields={highlightedFields}
                      />

                      {/* Dependents Section */}
                      <FieldsRow
                        type="dependent"
                        loading={!item.attributes}
                        fields={item.attributes?.dependents ?? []}
                        itemName={item.name}
                        itemPath={item.path}
                        selectedItems={selectedItems}
                        getSelectedItems={getSelectedItems}
                        onToggleSelect={handleToggleSelect}
                        onAutofillComposerField={onAutofillComposerField}
                        isChipEnabled={isDepChipEnabled}
                        highlightedFields={highlightedFields}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <SectionRibbon
          label="Basket"
          Icon={ShoppingBasket}
          count={items.length}
          orientation={isExpanded ? "vertical" : "horizontal"}
          onToggle={toggleExpanded}
        >
          {onDownload && (
            <Tooltip content="Download basket" position="left">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDownload(items);
                }}
                disabled={items.length === 0}
                className={`${ribbonButtonClass} text-blue-600 hover:text-blue-800`}
                aria-label="Download basket"
              >
                <Download size={16} />
              </button>
            </Tooltip>
          )}
          <Tooltip content="Clear basket (Alt+Shift+B)" position="left">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onClearAll();
              }}
              disabled={items.length === 0}
              className={`${ribbonButtonClass} text-red-600 hover:text-red-800`}
              aria-label="Clear basket"
            >
              <Trash2 size={16} />
            </button>
          </Tooltip>
          <Tooltip
            content={`${isExpanded ? "Collapse basket" : "Expand basket"} (Alt+B)`}
            position="left"
          >
            <button
              onClick={toggleExpanded}
              className={ribbonButtonClass}
              aria-label={isExpanded ? "Collapse basket" : "Expand basket"}
            >
              {isExpanded ? (
                <EyeOff size={16} className="text-red-600" />
              ) : (
                <Eye size={16} className="text-green-600" />
              )}
            </button>
          </Tooltip>
        </SectionRibbon>
      </div>
    </div>
  );
};

export default Basket;

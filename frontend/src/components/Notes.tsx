import React, { useState, useEffect, useCallback, useRef } from "react";
import axios from "axios";
import {
  Save,
  FileText,
  AlertCircle,
  Check,
  Clock,
  Loader2,
  ChevronDown,
  NotebookPen,
} from "lucide-react";

// Local imports
import MarkdownEditor from "./MarkdownEditor";
import { BasketItem } from "./Basket";
import { PROD_BACKEND_URL } from "../config";
import { themeClasses } from "../theme";

interface DroppedItem {
  id: string;
  name: string;
  path: string;
  type: "file" | "folder";
  size?: number;
  timestamp?: Date;
  tags?: string[];
}

interface NotesProps {
  basketItems: BasketItem[];
  isCollapsed: boolean;
  selectedItemId?: string | null; // External control over which item is selected
  onSelectedItemChange?: (itemId: string | null) => void; // Callback when selection changes
}

type SaveStatus = "idle" | "saving" | "saved" | "error";

export default function Notes({
  basketItems,
  isCollapsed,
  selectedItemId: externalSelectedItemId,
  onSelectedItemChange,
}: NotesProps) {
  // Helper to parse backend timestamp strings of the form "YYYY-MM-DD HH:MM:SS"
  // Returns a Date object in local time when possible, or null.
  const parseBackendTimestamp = (ts?: string | null): Date | null => {
    if (!ts) return null;
    // Prefer ISO 8601 parse
    const parsed = new Date(ts);
    if (!isNaN(parsed.getTime())) return parsed;

    // Fallback: handle legacy 'YYYY-MM-DD HH:MM:SS' format
    const m = ts.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/);
    if (m) {
      const [, y, mo, d, hh, mm, ss] = m;
      return new Date(
        Number(y),
        Number(mo) - 1,
        Number(d),
        Number(hh),
        Number(mm),
        Number(ss),
      );
    }

    return null;
  };

  // Format Last Saved as YY-MM-DD | HH:MM:SS (24-hour)
  const formatLastSaved = (date: Date) => {
    const y = String(date.getFullYear());
    const mo = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    const hh = String(date.getHours()).padStart(2, "0");
    const mm = String(date.getMinutes()).padStart(2, "0");
    const ss = String(date.getSeconds()).padStart(2, "0");
    return `${y}-${mo}-${d} | ${hh}:${mm}:${ss}`;
  };

  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [internalSelectedItemId, setInternalSelectedItemId] = useState<
    string | null
  >(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);

  const autoSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const notesContainerRef = useRef<HTMLDivElement | null>(null);

  // Auto-save delay in milliseconds
  const AUTO_SAVE_DELAY = 2000;

  // Use external selectedItemId if provided, otherwise use internal state
  const selectedItemId =
    externalSelectedItemId !== undefined
      ? externalSelectedItemId
      : internalSelectedItemId;

  // Get the currently selected item
  const selectedItem = basketItems.find((item) => item.id === selectedItemId);

  // Filter basket items to only show .zarr files
  const zarrItems = basketItems.filter(
    (item) => item.type === "file" && item.path.endsWith(".zarr"),
  );

  // Handle selection change
  const handleSelectionChange = useCallback(
    (itemId: string | null) => {
      if (externalSelectedItemId !== undefined) {
        // External control mode - notify parent
        onSelectedItemChange?.(itemId);
      } else {
        // Internal control mode
        setInternalSelectedItemId(itemId);
      }
    },
    [externalSelectedItemId, onSelectedItemChange],
  );

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setShowDropdown(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  const saveNotes = useCallback(async () => {
    if (!selectedItem || !selectedItem.path.endsWith(".zarr")) {
      setError("No dataset selected");
      return;
    }

    // Don't save if already saving
    if (saveStatus === "saving") {
      return;
    }

    setSaveStatus("saving");
    setError(null);

    // Cancel any ongoing requests
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const response = await axios.post(
        `${PROD_BACKEND_URL}/save-notes/`,
        {
          path: selectedItem.path,
          notes: notes,
        },
        {
          signal: controller.signal,
          timeout: 10000, // 10 second timeout
        },
      );

      // Use server-provided last_saved when possible
      const serverLastSaved = response.data?.last_saved || null;
      setHasUnsavedChanges(false);
      setSaveStatus("saved");
      setLastSavedAt(parseBackendTimestamp(serverLastSaved) || new Date());

      // Clear the timeout since we've saved
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current);
        autoSaveTimeoutRef.current = null;
      }

      // Reset status after a delay
      setTimeout(() => {
        setSaveStatus("idle");
      }, 2000);
    } catch (err) {
      if (axios.isCancel(err)) {
        console.log("Save notes request cancelled");
        return;
      }

      // console.error("Error saving notes:", err);
      setSaveStatus("error");
      setError(
        axios.isAxiosError(err)
          ? err.response?.data?.detail || err.message
          : "Failed to save notes",
      );

      // Reset status after a delay
      setTimeout(() => {
        setSaveStatus("idle");
      }, 3000);
    }
  }, [selectedItem, notes, saveStatus]);

  // Listen for external append events (from PlotWrapper) and append to notes if dataset matches
  useEffect(() => {
    const handleNotesAppend = (e: Event) => {
      try {
        const ev = e as CustomEvent;
        const detail = ev.detail as { datasetPath?: string; md_line?: string };
        if (!detail || !detail.md_line) return;
        // Only append if current selected item's path matches datasetPath
        if (selectedItem && detail.datasetPath === selectedItem.path) {
          setNotes((prev) => prev + "\n" + detail.md_line);
          setHasUnsavedChanges(true);
          // Auto-save shortly after appending
          if (autoSaveTimeoutRef.current)
            clearTimeout(autoSaveTimeoutRef.current);
          autoSaveTimeoutRef.current = setTimeout(() => {
            saveNotes();
          }, AUTO_SAVE_DELAY);
        }
      } catch {
        // ignore
      }
    };

    window.addEventListener("notes:append", handleNotesAppend as EventListener);
    return () => {
      window.removeEventListener(
        "notes:append",
        handleNotesAppend as EventListener,
      );
    };
  }, [saveNotes, selectedItem]);

  // Helper to load notes from the backend for a given path
  const loadNotes = useCallback(async (path: string) => {
    setLoading(true);
    setError(null);
    setSaveStatus("idle");

    // Cancel any ongoing requests
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const response = await axios.post(
        `${PROD_BACKEND_URL}/load-notes/`,
        { path },
        {
          signal: controller.signal,
          timeout: 10000, // 10 second timeout
        },
      );

      // Response contains notes and optional last_saved/filename
      setNotes(response.data.notes || "");
      setHasUnsavedChanges(false);
      setLastSavedAt(parseBackendTimestamp(response.data?.last_saved) || null);

      if (response.data.error) {
        setError(response.data.error);
      }
    } catch (err) {
      if (axios.isCancel(err)) {
        console.log("Load notes request cancelled");
        return;
      }

      // console.error("Error loading notes:", err);
      setError(
        axios.isAxiosError(err)
          ? err.response?.data?.detail || err.message
          : "Failed to load notes",
      );
      setNotes("");
    } finally {
      setLoading(false);
    }
  }, []);

  // Load notes when a new dataset is selected
  useEffect(() => {
    if (
      selectedItem &&
      selectedItem.type === "file" &&
      selectedItem.path.endsWith(".zarr")
    ) {
      loadNotes(selectedItem.path);
    } else {
      setNotes("");
      setHasUnsavedChanges(false);
      setSaveStatus("idle");
      setLastSavedAt(null);
      setError(null);
    }
  }, [selectedItem, loadNotes]);

  // Auto-save effect
  useEffect(() => {
    if (hasUnsavedChanges && selectedItem?.path.endsWith(".zarr")) {
      // Clear existing timeout
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current);
      }

      // Set new timeout for auto-save
      autoSaveTimeoutRef.current = setTimeout(() => {
        saveNotes(); // Auto-save
      }, AUTO_SAVE_DELAY);
    }

    // Cleanup timeout on unmount
    return () => {
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current);
      }
    };
  }, [hasUnsavedChanges, selectedItem, notes, saveNotes]);

  // Auto-select first zarr item when basket items change
  useEffect(() => {
    if (zarrItems.length > 0 && !selectedItemId) {
      handleSelectionChange(zarrItems[0].id);
    } else if (zarrItems.length === 0) {
      handleSelectionChange(null);
    } else if (
      selectedItemId &&
      !zarrItems.find((item) => item.id === selectedItemId)
    ) {
      // Selected item was removed from basket, select first available
      handleSelectionChange(zarrItems[0]?.id || null);
    }
  }, [zarrItems, selectedItemId, handleSelectionChange]);

  const handleNotesChange = (value: string) => {
    setNotes(value);
    setHasUnsavedChanges(true);
    setSaveStatus("idle");
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    // Save on Ctrl+S or Cmd+S
    if ((event.ctrlKey || event.metaKey) && event.key === "s") {
      event.preventDefault();
      saveNotes(); // Manual save
    }
  };

  // Format dropped items as markdown
  const formatDroppedItems = (items: DroppedItem[]): string => {
    if (items.length === 0) return "";

    const timestamp = new Date().toLocaleString();
    let formatted = `\n## Dropped Items - ${timestamp}\n\n`;

    if (items.length === 1) {
      const item = items[0];
      formatted += `**${item.name}** (${item.type})\n`;
      formatted += `\`${item.path}\`\n\n`;
    } else {
      formatted += `**${items.length} items:**\n\n`;
      items.forEach((item, index) => {
        formatted += `${index + 1}. **${item.name}** (${item.type})\n`;
        formatted += `   \`${item.path}\`\n\n`;
      });
    }

    return formatted;
  };

  // Handle drag over event
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    if (!isDragOver) {
      setIsDragOver(true);
    }
  };

  // Handle drag enter event
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  // Handle drag leave event
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    // Only set to false if we're leaving the container entirely
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragOver(false);
    }
  };

  // Handle drop event
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);

    if (!canEdit) return;

    try {
      const dragData = e.dataTransfer.getData("application/json");
      if (!dragData) return;

      const parsedData = JSON.parse(dragData);

      // Handle both single item and array of items
      const items = Array.isArray(parsedData) ? parsedData : [parsedData];

      // Format the items as markdown
      const formattedContent = formatDroppedItems(items);

      // Insert at the end of current notes
      const newNotes = notes + formattedContent;
      setNotes(newNotes);
      setHasUnsavedChanges(true);
      setSaveStatus("idle");
    } catch {
      // console.error("Error processing dropped items:", error);
      setError("Failed to process dropped items");
    }
  };
  if (isCollapsed) {
    return null;
  }

  const canEdit =
    selectedItem &&
    selectedItem.type === "file" &&
    selectedItem.path.endsWith(".zarr");

  const getSaveIconAndText = () => {
    const formatTimeAgo = (date: Date) => {
      const diffInSeconds = Math.floor((Date.now() - date.getTime()) / 1000);
      if (diffInSeconds < 60) return "just now";
      if (diffInSeconds < 3600) {
        const minutes = Math.floor(diffInSeconds / 60);
        return `${minutes}m ago`;
      }
      return date.toLocaleTimeString();
    };

    switch (saveStatus) {
      case "saving":
        return {
          icon: <Loader2 className="w-4 h-4 animate-spin" />,
          text: "Saving...",
        };
      case "saved":
        return {
          icon: <Check className="w-4 h-4 text-green-500" />,
          text: lastSavedAt ? `Saved ${formatTimeAgo(lastSavedAt)}` : "Saved",
        };
      case "error":
        return {
          icon: <AlertCircle className="w-4 h-4 text-red-500" />,
          text: "Error",
        };
      default:
        return hasUnsavedChanges
          ? {
              icon: <Clock className="w-4 h-4 text-orange-500" />,
              text: "Unsaved changes",
            }
          : { icon: <Save className="w-4 h-4" />, text: "Autosave On" };
    }
  };

  return (
    <div
      className="bg-gray-100 h-full flex flex-col"
      onKeyDown={handleKeyDown}
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      ref={notesContainerRef}
    >
      {/* Header */}
      <div
        className={`p-3 border-b ${themeClasses.accentHeaderBg} ${themeClasses.accentBorderLight}`}
      >
        <div className="flex flex-col space-y-2">
          {/* Row 1: Dropdown (full width) */}
          <div>
            <div className="flex items-center space-x-2">
              <div className="flex-1 min-w-0">
                {zarrItems.length > 0 ? (
                  <div>
                    {/* Dropdown for selecting zarr items */}
                    <div className="relative" ref={dropdownRef}>
                      <button
                        onClick={() => setShowDropdown(!showDropdown)}
                        className={`flex items-center justify-between w-full overflow-hidden px-2 py-1.5 text-sm bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 ${themeClasses.accentFocusRing}`}
                      >
                        <span className="truncate">
                          {selectedItem
                            ? selectedItem.name
                            : "Select a dataset"}
                        </span>
                        <ChevronDown className="w-4 h-4 ml-2 flex-shrink-0" />
                      </button>

                      {showDropdown && (
                        <div className="absolute z-10 left-0 right-0 mt-1 bg-white border border-gray-300 rounded-md shadow-lg box-border max-w-full">
                          <div className="max-h-60 overflow-y-auto">
                            {zarrItems.map((item) => (
                              <button
                                key={item.id}
                                onClick={() => {
                                  handleSelectionChange(item.id);
                                  setShowDropdown(false);
                                }}
                                className={`w-full px-3 py-2 text-sm text-left hover:bg-gray-100 ${
                                  selectedItemId === item.id
                                    ? `${themeClasses.accentLightBg} ${themeClasses.accentText}`
                                    : ""
                                }`}
                              >
                                <div className="truncate">{item.name}</div>
                                <div className="text-xs text-gray-500 truncate">
                                  {item.path}
                                </div>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <span className="text-sm text-gray-600">
                    No datasets in basket
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Row 2: Left Last Saved, Right Autosave indicator */}
          <div className="flex items-center justify-between">
            {basketItems.length > 0 && (
              <div className="text-xs text-gray-600">
                {lastSavedAt ? (
                  <span>
                    <span className="font-medium text-gray-700 mr-2">
                      Last Saved:
                    </span>
                    <span className="text-gray-500">
                      {formatLastSaved(lastSavedAt)}
                    </span>
                  </span>
                ) : (
                  <span className="text-gray-500">Last Saved: —</span>
                )}
              </div>
            )}

            <div>
              {canEdit && (
                <div className="flex items-center space-x-3">
                  <div className="flex items-center space-x-1 text-xs text-gray-600 bg-white/50 px-2 py-1 rounded-md">
                    {(() => {
                      const { icon, text } = getSaveIconAndText();
                      return (
                        <>
                          {icon}
                          <span>{text}</span>
                        </>
                      );
                    })()}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="bg-red-50 border-l-4 border-red-400 p-3 mx-2 mt-2 rounded-r-md">
          <div className="flex items-center">
            <AlertCircle className="w-4 h-4 text-red-400 mr-2" />
            <p className="text-sm text-red-700">{error}</p>
          </div>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-hidden bg-gray-100">
        {loading && !hasUnsavedChanges ? (
          <div className="flex items-center justify-center p-8">
            <div className="text-center">
              <Loader2
                className={`w-6 h-6 animate-spin ${themeClasses.accentIcon} mx-auto mb-2`}
              />
              <p className="text-gray-600">Loading notes...</p>
            </div>
          </div>
        ) : canEdit ? (
          <div
            className={`h-full bg-white m-2 rounded-lg border shadow-sm transition-all duration-200 relative ${
              isDragOver
                ? `border-2 border-dashed ${themeClasses.accentBorder} ${themeClasses.accentLightBg}`
                : "border-gray-200"
            }`}
          >
            {isDragOver && (
              <div
                className={`absolute inset-0 flex items-center justify-center ${themeClasses.accentOverlay} rounded-lg pointer-events-none z-10`}
              >
                <div className={`text-center ${themeClasses.accentText}`}>
                  <FileText
                    className={`w-8 h-8 mx-auto mb-2 ${themeClasses.accentIcon}`}
                  />
                  <p className="text-sm font-medium">Drop datasets here</p>
                  <p className="text-xs">
                    Their paths will be added to your notes
                  </p>
                </div>
              </div>
            )}
            <MarkdownEditor
              value={notes}
              onChange={handleNotesChange}
              placeholder="Start typing your notes here... Auto-save is enabled. You can also drag and drop dataset paths from the explorer."
              disabled={loading}
            />
          </div>
        ) : (
          <div className="h-32 flex flex-col items-center justify-center text-gray-500">
            <NotebookPen size={48} className="mb-2 text-gray-400" />
            <p>No datasets in basket</p>
            <p className="text-sm mt-1">
              {zarrItems.length === 0
                ? "Add datasets to view or edit notes"
                : "Select a dataset from the dropdown above to view or edit notes"}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

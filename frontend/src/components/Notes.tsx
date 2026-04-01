import React, {
  useMemo,
  useState,
  useEffect,
  useCallback,
  useRef,
} from "react";
import axios from "axios";
import {
  Save,
  AlertCircle,
  Check,
  Clock,
  Loader2,
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

interface SampleGroup {
  key: string;
  sampleName: string;
  samplePath: string;
  cryostatName: string;
  pooledFilename: string;
  items: BasketItem[];
}

interface NotesProps {
  basketItems: BasketItem[];
  isCollapsed: boolean;
  selectedItemId?: string | null; // External control over which measurement item is selected
  onSelectedItemChange?: (itemId: string | null) => void; // Callback when measurement selection changes
}

type SaveStatus = "idle" | "saving" | "saved" | "error";
type NoteScope = "measurement" | "sample";

export default function Notes({
  basketItems,
  isCollapsed,
  selectedItemId: externalSelectedItemId,
  onSelectedItemChange,
}: NotesProps) {
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [internalSelectedItemId, setInternalSelectedItemId] = useState<
    string | null
  >(null);
  const [selectedSampleKey, setSelectedSampleKey] = useState<string | null>(
    null,
  );
  const [selectedScope, setSelectedScope] = useState<NoteScope>("measurement");
  const [isDragOver, setIsDragOver] = useState(false);
  const [isSwitchingSelection, setIsSwitchingSelection] = useState(false);

  const autoSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const notesContainerRef = useRef<HTMLDivElement | null>(null);

  // Auto-save delay in milliseconds
  const AUTO_SAVE_DELAY = 2000;

  const normalizePath = useCallback(
    (path: string) => path.replace(/\\/g, "/"),
    [],
  );

  const getAttrValue = useCallback(
    (
      item: BasketItem,
      snakeKey: string,
      titleKey: string,
    ): string | undefined => {
      const attrs = (item.attributes || {}) as Record<string, unknown>;
      const snake = attrs[snakeKey];
      if (typeof snake === "string" && snake.trim()) return snake.trim();
      const title = attrs[titleKey];
      if (typeof title === "string" && title.trim()) return title.trim();
      return undefined;
    },
    [],
  );

  const inferSamplePath = useCallback(
    (measurementPath: string): string => {
      const normalized = normalizePath(measurementPath);
      const parts = normalized.split("/").filter(Boolean);
      if (parts.length >= 3) {
        return parts.slice(0, -2).join("/");
      }
      if (parts.length >= 2) {
        return parts.slice(0, -1).join("/");
      }
      return normalized;
    },
    [normalizePath],
  );

  const parseBackendTimestamp = (ts?: string | null): Date | null => {
    if (!ts) return null;
    const parsed = new Date(ts);
    if (!isNaN(parsed.getTime())) return parsed;

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

  const formatLastSaved = (date: Date) => {
    const y = String(date.getFullYear());
    const mo = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    const hh = String(date.getHours()).padStart(2, "0");
    const mm = String(date.getMinutes()).padStart(2, "0");
    const ss = String(date.getSeconds()).padStart(2, "0");
    return `${y}-${mo}-${d} | ${hh}:${mm}:${ss}`;
  };

  // Use external selectedItemId if provided, otherwise use internal state
  const selectedItemId =
    externalSelectedItemId !== undefined
      ? externalSelectedItemId
      : internalSelectedItemId;

  const zarrItems = useMemo(
    () =>
      basketItems.filter(
        (item) => item.type === "file" && item.path.endsWith(".zarr"),
      ),
    [basketItems],
  );

  const sampleGroups = useMemo(() => {
    const groups = new Map<string, SampleGroup>();

    zarrItems.forEach((item) => {
      const samplePath = inferSamplePath(item.path);
      const samplePathParts = samplePath.split("/").filter(Boolean);

      const sampleName =
        getAttrValue(item, "sample_name", "Sample Name") ||
        samplePathParts[samplePathParts.length - 1] ||
        "sample";

      const cryostatName =
        getAttrValue(item, "cryostat", "Cryostat") || "cryostat";

      const pooledFilename = `${cryostatName}_${sampleName}.md`;
      const key = samplePath.toLowerCase();

      const existing = groups.get(key);
      if (existing) {
        existing.items.push(item);
        return;
      }

      groups.set(key, {
        key,
        sampleName,
        samplePath,
        cryostatName,
        pooledFilename,
        items: [item],
      });
    });

    return Array.from(groups.values()).sort((a, b) =>
      a.sampleName.localeCompare(b.sampleName),
    );
  }, [zarrItems, getAttrValue, inferSamplePath]);

  const selectedSample = sampleGroups.find(
    (group) => group.key === selectedSampleKey,
  );

  const selectedMeasurement =
    selectedScope === "measurement"
      ? zarrItems.find((item) => item.id === selectedItemId) || null
      : null;

  const selectedTarget = useMemo(() => {
    if (selectedScope === "measurement" && selectedMeasurement) {
      const group = sampleGroups.find((sample) =>
        sample.items.some((item) => item.id === selectedMeasurement.id),
      );
      return {
        scope: "measurement" as NoteScope,
        path: selectedMeasurement.path,
        samplePath: group?.samplePath,
        sampleName: group?.sampleName,
        cryostatName: group?.cryostatName,
        displayName: selectedMeasurement.name,
      };
    }

    if (selectedScope === "sample" && selectedSample) {
      const fallbackMeasurement = selectedSample.items[0];
      return {
        scope: "sample" as NoteScope,
        path: fallbackMeasurement?.path || selectedSample.samplePath,
        samplePath: selectedSample.samplePath,
        sampleName: selectedSample.sampleName,
        cryostatName: selectedSample.cryostatName,
        displayName: selectedSample.pooledFilename,
      };
    }

    return null;
  }, [selectedScope, selectedMeasurement, selectedSample, sampleGroups]);

  const handleSelectionChange = useCallback(
    (itemId: string | null) => {
      if (externalSelectedItemId !== undefined) {
        onSelectedItemChange?.(itemId);
      } else {
        setInternalSelectedItemId(itemId);
      }
    },
    [externalSelectedItemId, onSelectedItemChange],
  );

  // Keep sample dropdown aligned when a measurement is selected externally.
  useEffect(() => {
    if (!selectedItemId) return;

    const selected = zarrItems.find((item) => item.id === selectedItemId);
    if (!selected) return;

    const samplePath = inferSamplePath(selected.path).toLowerCase();
    setSelectedSampleKey(samplePath);
    setSelectedScope("measurement");
  }, [selectedItemId, zarrItems, inferSamplePath]);

  // Initialize sample + measurement selection when basket changes.
  useEffect(() => {
    if (sampleGroups.length === 0) {
      setSelectedSampleKey(null);
      handleSelectionChange(null);
      return;
    }

    const hasCurrentSample =
      selectedSampleKey &&
      sampleGroups.some((group) => group.key === selectedSampleKey);

    if (!hasCurrentSample) {
      setSelectedSampleKey(sampleGroups[0].key);
    }

    if (selectedScope === "measurement") {
      if (!selectedItemId) {
        const firstMeasurement = (
          hasCurrentSample
            ? sampleGroups.find((group) => group.key === selectedSampleKey)
            : sampleGroups[0]
        )?.items[0];
        if (firstMeasurement) {
          handleSelectionChange(firstMeasurement.id);
        }
      } else if (!zarrItems.some((item) => item.id === selectedItemId)) {
        const fallback = sampleGroups[0].items[0];
        handleSelectionChange(fallback?.id || null);
      }
    }
  }, [
    sampleGroups,
    selectedItemId,
    selectedSampleKey,
    selectedScope,
    zarrItems,
    handleSelectionChange,
  ]);

  // Support opening pooled sample notes from DirTree actions.
  useEffect(() => {
    const handleSelectSample = (event: Event) => {
      const customEvent = event as CustomEvent<{ samplePath?: string }>;
      const incomingPath = customEvent.detail?.samplePath;
      if (!incomingPath) return;

      const normalized = normalizePath(incomingPath).toLowerCase();
      const matched = sampleGroups.find((group) => group.key === normalized);
      if (!matched) return;

      setSelectedSampleKey(matched.key);
      setSelectedScope("sample");
      handleSelectionChange(null);
    };

    window.addEventListener(
      "notes:select-sample",
      handleSelectSample as EventListener,
    );
    return () => {
      window.removeEventListener(
        "notes:select-sample",
        handleSelectSample as EventListener,
      );
    };
  }, [sampleGroups, handleSelectionChange, normalizePath]);

  const loadNotes = useCallback(
    async (
      scope: NoteScope,
      path: string,
      samplePath?: string,
      sampleName?: string,
      cryostatName?: string,
    ) => {
      setLoading(true);
      setError(null);
      setSaveStatus("idle");

      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        const response = await axios.post(
          `${PROD_BACKEND_URL}/load-notes/`,
          {
            path,
            note_scope: scope,
            sample_path: samplePath,
            sample_name: sampleName,
            cryostat_name: cryostatName,
          },
          {
            signal: controller.signal,
            timeout: 10000,
          },
        );

        setNotes(response.data.notes || "");
        setHasUnsavedChanges(false);
        setLastSavedAt(
          parseBackendTimestamp(response.data?.last_saved) || null,
        );

        if (response.data.error) {
          setError(response.data.error);
        }
      } catch (err) {
        if (axios.isCancel(err)) {
          console.log("Load notes request cancelled");
          return;
        }

        setError(
          axios.isAxiosError(err)
            ? err.response?.data?.detail || err.message
            : "Failed to load notes",
        );
        setNotes("");
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  // Refresh currently shown notes when external actions update backend note files.
  useEffect(() => {
    const handleRefresh = (event: Event) => {
      const customEvent = event as CustomEvent<{ datasetPath?: string }>;
      const datasetPath = customEvent.detail?.datasetPath;
      if (!datasetPath || !selectedTarget) return;

      // Avoid clobbering unsaved local edits.
      if (hasUnsavedChanges) return;

      const incomingSamplePath = inferSamplePath(datasetPath).toLowerCase();
      const selectedSamplePath = (
        selectedTarget.samplePath || ""
      ).toLowerCase();

      const shouldRefreshMeasurement =
        selectedTarget.scope === "measurement" &&
        normalizePath(selectedTarget.path)
          .replace(/^memory:\/\//, "")
          .split("/")
          .pop()
          ?.replace(/\.zarr$/i, "")
          .toLowerCase() ===
          normalizePath(datasetPath)
            .replace(/^memory:\/\//, "")
            .split("/")
            .pop()
            ?.replace(/\.zarr$/i, "")
            .toLowerCase();

      const shouldRefreshSample =
        selectedTarget.scope === "sample" &&
        Boolean(selectedSamplePath) &&
        selectedSamplePath === incomingSamplePath;

      if (!shouldRefreshMeasurement && !shouldRefreshSample) {
        return;
      }

      loadNotes(
        selectedTarget.scope,
        selectedTarget.path,
        selectedTarget.samplePath,
        selectedTarget.sampleName,
        selectedTarget.cryostatName,
      );
    };

    window.addEventListener("notes:refresh", handleRefresh as EventListener);
    return () => {
      window.removeEventListener(
        "notes:refresh",
        handleRefresh as EventListener,
      );
    };
  }, [
    selectedTarget,
    hasUnsavedChanges,
    inferSamplePath,
    normalizePath,
    loadNotes,
  ]);

  const saveNotes = useCallback(async (): Promise<boolean> => {
    if (!selectedTarget) {
      setError("No notes target selected");
      return false;
    }

    if (saveStatus === "saving" || isSwitchingSelection) {
      return false;
    }

    setSaveStatus("saving");
    setError(null);

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const response = await axios.post(
        `${PROD_BACKEND_URL}/save-notes/`,
        {
          path: selectedTarget.path,
          notes,
          note_scope: selectedTarget.scope,
          sample_path: selectedTarget.samplePath,
          sample_name: selectedTarget.sampleName,
          cryostat_name: selectedTarget.cryostatName,
        },
        {
          signal: controller.signal,
          timeout: 10000,
        },
      );

      const serverLastSaved = response.data?.last_saved || null;
      setHasUnsavedChanges(false);
      setSaveStatus("saved");
      setLastSavedAt(parseBackendTimestamp(serverLastSaved) || new Date());

      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current);
        autoSaveTimeoutRef.current = null;
      }

      setTimeout(() => {
        setSaveStatus("idle");
      }, 2000);
      return true;
    } catch (err) {
      if (axios.isCancel(err)) {
        console.log("Save notes request cancelled");
        return false;
      }

      setSaveStatus("error");
      setError(
        axios.isAxiosError(err)
          ? err.response?.data?.detail || err.message
          : "Failed to save notes",
      );

      setTimeout(() => {
        setSaveStatus("idle");
      }, 3000);
      return false;
    }
  }, [selectedTarget, notes, saveStatus, isSwitchingSelection]);

  const switchTargetAfterSave = useCallback(
    async (applySelection: () => void) => {
      if (isSwitchingSelection) {
        return;
      }

      if (!hasUnsavedChanges) {
        applySelection();
        return;
      }

      setIsSwitchingSelection(true);
      try {
        const ok = await saveNotes();
        if (!ok) {
          return;
        }
        applySelection();
      } finally {
        setIsSwitchingSelection(false);
      }
    },
    [hasUnsavedChanges, isSwitchingSelection, saveNotes],
  );

  // Load notes when selected target changes.
  useEffect(() => {
    if (selectedTarget) {
      loadNotes(
        selectedTarget.scope,
        selectedTarget.path,
        selectedTarget.samplePath,
        selectedTarget.sampleName,
        selectedTarget.cryostatName,
      );
    } else {
      setNotes("");
      setHasUnsavedChanges(false);
      setSaveStatus("idle");
      setLastSavedAt(null);
      setError(null);
    }
  }, [selectedTarget, loadNotes]);

  // Auto-save effect
  useEffect(() => {
    if (hasUnsavedChanges && selectedTarget) {
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current);
      }

      autoSaveTimeoutRef.current = setTimeout(() => {
        saveNotes();
      }, AUTO_SAVE_DELAY);
    }

    return () => {
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current);
      }
    };
  }, [hasUnsavedChanges, selectedTarget, notes, saveNotes]);

  const handleNotesChange = (value: string) => {
    setNotes(value);
    setHasUnsavedChanges(true);
    setSaveStatus("idle");
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "s") {
      event.preventDefault();
      saveNotes();
    }
  };

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

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    if (!isDragOver) {
      setIsDragOver(true);
    }
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragOver(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);

    if (!selectedTarget) return;

    try {
      const dragData = e.dataTransfer.getData("application/json");
      if (!dragData) return;

      const parsedData = JSON.parse(dragData);
      const items = Array.isArray(parsedData) ? parsedData : [parsedData];
      const formattedContent = formatDroppedItems(items);

      setNotes((prev) => prev + formattedContent);
      setHasUnsavedChanges(true);
      setSaveStatus("idle");
    } catch {
      setError("Failed to process dropped items");
    }
  };

  if (isCollapsed) {
    return null;
  }

  const canEdit = Boolean(selectedTarget);

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

  const measurementItemsForSample = selectedSample?.items || [];

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
          {/* Row 1: Sample + Measurement selectors */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] text-gray-600 mb-1">
                Sample
              </label>
              <select
                value={selectedSampleKey || ""}
                aria-label="Select sample notes"
                onChange={(e) => {
                  const nextKey = e.target.value || null;
                  void switchTargetAfterSave(() => {
                    setSelectedSampleKey(nextKey);
                    setSelectedScope("sample");
                    handleSelectionChange(null);
                  });
                }}
                className={`w-full px-2 py-1.5 text-sm bg-white border border-gray-300 rounded-md focus:outline-none focus:ring-2 ${themeClasses.accentFocusRing}`}
                disabled={sampleGroups.length === 0 || isSwitchingSelection}
              >
                {sampleGroups.length === 0 ? (
                  <option value="">No samples in basket</option>
                ) : (
                  sampleGroups.map((sample) => (
                    <option key={sample.key} value={sample.key}>
                      {sample.sampleName}
                    </option>
                  ))
                )}
              </select>
            </div>

            <div>
              <label className="block text-[11px] text-gray-600 mb-1">
                Measurement
              </label>
              <select
                value={
                  selectedScope === "sample"
                    ? "__sample__"
                    : selectedItemId || ""
                }
                aria-label="Select measurement notes"
                onChange={(e) => {
                  const value = e.target.value;
                  void switchTargetAfterSave(() => {
                    if (value === "__sample__") {
                      setSelectedScope("sample");
                      handleSelectionChange(null);
                      return;
                    }
                    setSelectedScope("measurement");
                    handleSelectionChange(value || null);
                  });
                }}
                className={`w-full px-2 py-1.5 text-sm bg-white border border-gray-300 rounded-md focus:outline-none focus:ring-2 ${themeClasses.accentFocusRing}`}
                disabled={!selectedSample || isSwitchingSelection}
              >
                {!selectedSample ? (
                  <option value="">Select sample first</option>
                ) : (
                  <>
                    <option value="__sample__">Pooled sample notes</option>
                    {measurementItemsForSample.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </>
                )}
              </select>
            </div>
          </div>

          {selectedTarget && (
            <div className="text-[11px] text-gray-500 truncate">
              {selectedScope === "sample"
                ? `${selectedSample?.cryostatName}/${selectedSample?.sampleName} -> ${selectedSample?.pooledFilename}`
                : selectedTarget.path}
            </div>
          )}

          {/* Row 2: Left Last Saved, Right Autosave indicator */}
          <div className="flex items-center justify-between">
            {zarrItems.length > 0 && (
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
                  <span className="text-gray-500">Last Saved: -</span>
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
                  {isSwitchingSelection && (
                    <span className="text-[10px] text-gray-500">
                      saving before switch...
                    </span>
                  )}
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
            className={`h-full bg-white m-2 rounded-lg border shadow-sm relative ${
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
                  <NotebookPen
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
            <p className="text-sm mt-1">Add datasets to view or edit notes</p>
          </div>
        )}
      </div>
    </div>
  );
}

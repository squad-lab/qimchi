import React, { useMemo, useState, useEffect, useCallback, useRef } from "react";
import axios from "axios";
import { Save, AlertCircle, Check, Clock, Loader2, NotebookPen } from "lucide-react";

// Local imports
import MarkdownEditor from "./MarkdownEditor";
import { BasketItem } from "./Basket";
import { PROD_BACKEND_URL } from "../config";
import { themeClasses } from "../theme";
import { isDatasetPath, isSqliteContainerPath } from "../utils/datasetPaths";

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
  kind: "sample" | "qcodes";
  sampleName: string;
  samplePath: string;
  cryostatName: string;
  pooledFilename: string;
  databaseUuid?: string;
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

interface NoteTarget {
  scope: NoteScope;
  path: string;
  uuid?: string;
  runId?: number;
  samplePath?: string;
  sampleName?: string;
  cryostatName?: string;
  displayName: string;
  readOnly?: boolean;
}

function requestErrorMessage(error: unknown, fallback: string): string {
  if (!axios.isAxiosError(error)) return fallback;

  const detail: unknown = error.response?.data?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    const messages = detail
      .map((entry) => {
        if (!entry || typeof entry !== "object") return null;
        const message = (entry as { msg?: unknown }).msg;
        return typeof message === "string" ? message : null;
      })
      .filter((message): message is string => Boolean(message));
    if (messages.length) return messages.join("; ");
  }
  return error.message || fallback;
}

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
  const [internalSelectedItemId, setInternalSelectedItemId] = useState<string | null>(null);
  const [selectedSampleKey, setSelectedSampleKey] = useState<string | null>(null);
  const [selectedScope, setSelectedScope] = useState<NoteScope>("measurement");
  const [isDragOver, setIsDragOver] = useState(false);
  const [isSwitchingSelection, setIsSwitchingSelection] = useState(false);

  const autoSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const notesContainerRef = useRef<HTMLDivElement | null>(null);

  // Auto-save delay in milliseconds
  const AUTO_SAVE_DELAY = 2000;

  const normalizePath = useCallback((path: string) => path.replace(/\\/g, "/"), []);

  const getAttrValue = useCallback(
    (item: BasketItem, snakeKey: string, titleKey: string): string | undefined => {
      const attrs = (item.attributes || {}) as Record<string, unknown>;
      const snake = attrs[snakeKey];
      if (typeof snake === "string" && snake.trim()) return snake.trim();
      const title = attrs[titleKey];
      if (typeof title === "string" && title.trim()) return title.trim();
      return undefined;
    },
    [],
  );

  const getRunId = useCallback((item: BasketItem): number | undefined => {
    const value = (item.attributes as Record<string, unknown> | undefined)?.run_id;
    if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
    if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
    const match = item.path.match(/#run_id=(\d+)$/i);
    return match ? Number(match[1]) : undefined;
  }, []);

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
      return new Date(Number(y), Number(mo) - 1, Number(d), Number(hh), Number(mm), Number(ss));
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
    externalSelectedItemId !== undefined ? externalSelectedItemId : internalSelectedItemId;

  const datasetItems = useMemo(
    () =>
      basketItems.filter(
        (item) =>
          item.type === "file" && isDatasetPath(item.path) && !isSqliteContainerPath(item.path),
      ),
    [basketItems],
  );

  const sampleGroups = useMemo(() => {
    const groups = new Map<string, SampleGroup>();

    datasetItems.forEach((item) => {
      const qcodesRun = /\.(db|sqlite)#run_id=\d+$/i.test(item.path);
      if (qcodesRun) {
        const databasePath = item.path.split("#", 1)[0];
        const normalizedDatabasePath = normalizePath(databasePath);
        const databasePathParts = normalizedDatabasePath.split("/").filter(Boolean);
        const databaseName = databasePathParts[databasePathParts.length - 1] || "QCoDeS";
        const key = `qcodes:${normalizedDatabasePath.toLowerCase()}`;
        const databaseUuid = getAttrValue(item, "qimchi_db_uuid", "qimchi_db_uuid");
        const existing = groups.get(key);
        if (existing) {
          existing.items.push(item);
          existing.databaseUuid ||= databaseUuid;
          return;
        }
        groups.set(key, {
          key,
          kind: "qcodes",
          sampleName: databaseName,
          samplePath: databasePath,
          cryostatName: "QCoDeS",
          pooledFilename: "Overall database notes",
          databaseUuid,
          items: [item],
        });
        return;
      }

      const samplePath = inferSamplePath(item.path);
      const samplePathParts = samplePath.split("/").filter(Boolean);

      const sampleName =
        getAttrValue(item, "sample_name", "Sample Name") ||
        samplePathParts[samplePathParts.length - 1] ||
        "sample";

      const cryostatName = getAttrValue(item, "cryostat", "Cryostat") || "cryostat";

      const pooledFilename = `${cryostatName}_${sampleName}.md`;
      const key = samplePath.toLowerCase();

      const existing = groups.get(key);
      if (existing) {
        existing.items.push(item);
        return;
      }

      groups.set(key, {
        key,
        kind: "sample",
        sampleName,
        samplePath,
        cryostatName,
        pooledFilename,
        items: [item],
      });
    });

    return Array.from(groups.values()).sort((a, b) => a.sampleName.localeCompare(b.sampleName));
  }, [datasetItems, getAttrValue, inferSamplePath, normalizePath]);

  const selectedSample = sampleGroups.find((group) => group.key === selectedSampleKey);

  const selectedMeasurement =
    selectedScope === "measurement"
      ? datasetItems.find((item) => item.id === selectedItemId) || null
      : null;

  const selectedTarget = useMemo<NoteTarget | null>(() => {
    if (selectedScope === "measurement" && selectedMeasurement) {
      const group = sampleGroups.find((sample) =>
        sample.items.some((item) => item.id === selectedMeasurement.id),
      );
      const qcodesRun = /\.(db|sqlite)#run_id=\d+$/i.test(selectedMeasurement.path);
      const qcodesUuid = getAttrValue(selectedMeasurement, "qimchi_db_uuid", "qimchi_db_uuid");
      if (qcodesRun && !qcodesUuid) return null;
      return {
        scope: "measurement" as NoteScope,
        path: selectedMeasurement.path,
        uuid: qcodesUuid,
        runId: getRunId(selectedMeasurement),
        samplePath: group?.samplePath,
        sampleName: group?.sampleName,
        cryostatName: group?.cryostatName,
        displayName: selectedMeasurement.name,
      };
    }

    if (selectedScope === "sample" && selectedSample) {
      const fallbackMeasurement = selectedSample.items[0];
      if (selectedSample.kind === "qcodes") {
        if (!selectedSample.databaseUuid) return null;
        return {
          scope: "measurement" as NoteScope,
          path: selectedSample.samplePath,
          uuid: selectedSample.databaseUuid,
          displayName: selectedSample.pooledFilename,
          readOnly: true,
        };
      }
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
  }, [selectedScope, selectedMeasurement, selectedSample, sampleGroups, getAttrValue, getRunId]);

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

    const selected = datasetItems.find((item) => item.id === selectedItemId);
    if (!selected) return;

    const group = sampleGroups.find((sample) =>
      sample.items.some((item) => item.id === selected.id),
    );
    if (!group) return;
    setSelectedSampleKey(group.key);
    setSelectedScope("measurement");
  }, [selectedItemId, datasetItems, sampleGroups]);

  // Initialize sample + measurement selection when basket changes.
  useEffect(() => {
    if (sampleGroups.length === 0) {
      setSelectedSampleKey(null);
      handleSelectionChange(null);
      return;
    }

    const hasCurrentSample =
      selectedSampleKey && sampleGroups.some((group) => group.key === selectedSampleKey);

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
      } else if (!datasetItems.some((item) => item.id === selectedItemId)) {
        const fallback = sampleGroups[0].items[0];
        handleSelectionChange(fallback?.id || null);
      }
    }
  }, [
    sampleGroups,
    selectedItemId,
    selectedSampleKey,
    selectedScope,
    datasetItems,
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

    window.addEventListener("notes:select-sample", handleSelectSample as EventListener);
    return () => {
      window.removeEventListener("notes:select-sample", handleSelectSample as EventListener);
    };
  }, [sampleGroups, handleSelectionChange, normalizePath]);

  const loadNotes = useCallback(
    async (
      scope: NoteScope,
      path: string,
      samplePath?: string,
      sampleName?: string,
      cryostatName?: string,
      uuid?: string,
      runId?: number,
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
            uuid,
            run_id: runId,
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
        setLastSavedAt(parseBackendTimestamp(response.data?.last_saved) || null);

        if (response.data.error) {
          setError(response.data.error);
        }
      } catch (err) {
        if (axios.isCancel(err)) {
          console.log("Load notes request cancelled");
          return;
        }

        setError(requestErrorMessage(err, "Failed to load notes"));
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
      const selectedSamplePath = (selectedTarget.samplePath || "").toLowerCase();

      const shouldRefreshMeasurement =
        selectedTarget.scope === "measurement" &&
        normalizePath(selectedTarget.path)
          .replace(/^memory:\/\//, "")
          .split("/")
          .pop()
          ?.replace(/\.(zarr|nc|h5|hdf5|csv|txt|dat)$/i, "")
          .toLowerCase() ===
          normalizePath(datasetPath)
            .replace(/^memory:\/\//, "")
            .split("/")
            .pop()
            ?.replace(/\.(zarr|nc|h5|hdf5|csv|txt|dat)$/i, "")
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
        selectedTarget.uuid,
        selectedTarget.runId,
      );
    };

    window.addEventListener("notes:refresh", handleRefresh as EventListener);
    return () => {
      window.removeEventListener("notes:refresh", handleRefresh as EventListener);
    };
  }, [selectedTarget, hasUnsavedChanges, inferSamplePath, normalizePath, loadNotes]);

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
          uuid: selectedTarget.uuid,
          run_id: selectedTarget.runId,
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
      setError(requestErrorMessage(err, "Failed to save notes"));

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
        selectedTarget.uuid,
        selectedTarget.runId,
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

    if (!selectedTarget || selectedTarget.readOnly) return;

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

  const hasTarget = Boolean(selectedTarget);
  const canEdit = hasTarget && !selectedTarget?.readOnly;

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
              <label className="block text-[11px] text-[var(--qimchi-panel-title-fg)] opacity-80 mb-1">
                Sample / Database
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
              <label className="block text-[11px] text-[var(--qimchi-panel-title-fg)] opacity-80 mb-1">
                Measurement
              </label>
              <select
                value={selectedScope === "sample" ? "__sample__" : selectedItemId || ""}
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
                    <option value="__sample__">
                      {selectedSample.kind === "qcodes"
                        ? "Overall database notes"
                        : "Pooled sample notes"}
                    </option>
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
            <div className="text-[11px] text-[var(--qimchi-panel-title-fg)] opacity-75 truncate">
              {selectedScope === "sample"
                ? selectedSample?.kind === "qcodes"
                  ? `${selectedSample.sampleName} -> Overall database notes`
                  : `${selectedSample?.cryostatName}/${selectedSample?.sampleName} -> ${selectedSample?.pooledFilename}`
                : selectedTarget.path}
            </div>
          )}

          {/* Row 2: Left Last Saved, Right Autosave indicator */}
          <div className="flex items-center justify-between">
            {datasetItems.length > 0 && (
              <div className="text-xs text-[var(--qimchi-panel-title-fg)]">
                {lastSavedAt ? (
                  <span>
                    <span className="font-medium text-[var(--qimchi-panel-title-fg)] mr-2">
                      Last Saved:
                    </span>
                    <span className="text-[var(--qimchi-panel-title-fg)] opacity-75">
                      {formatLastSaved(lastSavedAt)}
                    </span>
                  </span>
                ) : (
                  <span className="text-[var(--qimchi-panel-title-fg)] opacity-75">
                    Last Saved: -
                  </span>
                )}
              </div>
            )}

            <div>
              {canEdit && (
                <div className="flex items-center space-x-3">
                  <div className="flex items-center space-x-1 text-xs text-[var(--qimchi-panel-title-fg)] bg-white/50 dark:bg-black/20 px-2 py-1 rounded-md">
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
                    <span className="text-[10px] text-[var(--qimchi-panel-title-fg)] opacity-75">
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
              <Loader2 className={`w-6 h-6 animate-spin ${themeClasses.accentIcon} mx-auto mb-2`} />
              <p className="text-gray-600">Loading notes...</p>
            </div>
          </div>
        ) : hasTarget ? (
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
                  <NotebookPen className={`w-8 h-8 mx-auto mb-2 ${themeClasses.accentIcon}`} />
                  <p className="text-sm font-medium">Drop datasets here</p>
                  <p className="text-xs">Their paths will be added to your notes</p>
                </div>
              </div>
            )}
            <MarkdownEditor
              value={notes}
              onChange={handleNotesChange}
              placeholder="Start typing your notes here... Auto-save is enabled. You can also drag and drop dataset paths from the explorer."
              disabled={loading || !canEdit}
            />
          </div>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-gray-500">
            <NotebookPen size={48} className="mb-2 text-gray-400" />
            <p>No datasets in basket</p>
            <p className="text-sm mt-1">Add datasets to view or edit notes</p>
          </div>
        )}
      </div>
    </div>
  );
}

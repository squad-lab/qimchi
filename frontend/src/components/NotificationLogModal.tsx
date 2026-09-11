import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  X,
  History,
  Trash2,
  CheckCircle,
  AlertCircle,
  AlertTriangle,
  Info,
  Search,
  ChevronDown,
  ChevronUp,
  ScrollText,
} from "lucide-react";
import { Rnd } from "react-rnd";
import JsonView from "@uiw/react-json-view";
import { LogItem } from "../hooks/useToast";

interface NotificationLogModalProps {
  isOpen: boolean;
  onClose: () => void;
  logs: LogItem[];
  onClear: () => void;
}

// Simple global z-index manager so modals can stack above each other.
const getNextGlobalModalZ = (): number => {
  if (typeof window === "undefined") return 2000;
  const w = window as unknown as { __qimchi_modal_z?: number };
  if (!w.__qimchi_modal_z) w.__qimchi_modal_z = 2000;
  w.__qimchi_modal_z = (w.__qimchi_modal_z || 2000) + 1;
  return w.__qimchi_modal_z;
};

const formatTime = (isoString: string) => {
  try {
    const date = new Date(isoString);
    return date.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return "";
  }
};

const formatDate = (isoString: string) => {
  try {
    const date = new Date(isoString);
    return date.toLocaleDateString();
  } catch {
    return "";
  }
};

const NotificationLogEntry: React.FC<{
  log: LogItem;
  getIcon: (type: string) => React.ReactNode;
  getLogStyles: (type: string) => string;
}> = ({ log, getIcon, getLogStyles }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const hasMetadata =
    log.metadata &&
    (typeof log.metadata === "object"
      ? Object.keys(log.metadata).length > 0
      : String(log.metadata).length > 0);

  return (
    <div
      className={`p-3 rounded-lg border shadow-sm flex flex-col gap-2 transition-all ${getLogStyles(log.type)} ${hasMetadata ? "cursor-pointer hover:shadow-md" : ""}`}
      onClick={() => hasMetadata && setIsExpanded(!isExpanded)}
    >
      <div className="flex items-start gap-3">
        <div className="shrink-0">{getIcon(log.type)}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-medium wrap-break-word leading-tight">{log.message}</p>
            {hasMetadata && (
              <div className="text-slate-400 mt-0.5">
                {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1.5 opacity-70">
            {log.source && (
              <span className="text-[10px] px-1.5 py-0.5 bg-black bg-opacity-10 rounded font-bold uppercase tracking-tight">
                {log.source}
              </span>
            )}
            <span className="text-[10px] uppercase tracking-wider font-semibold">{log.type}</span>
            <span className="w-1 h-1 rounded-full bg-current opacity-40"></span>
            <span className="text-xs">{formatTime(log.timestamp)}</span>
            <span className="text-[10px] ml-auto">{formatDate(log.timestamp)}</span>
          </div>
        </div>
      </div>

      {isExpanded && hasMetadata && (
        <div
          className="mt-2 p-2 bg-white bg-opacity-50 rounded border border-black border-opacity-5 overflow-hidden text-xs"
          onClick={(e) => e.stopPropagation()}
        >
          <p className="text-[10px] font-bold uppercase text-slate-500 mb-1">Technical Details</p>
          {typeof log.metadata === "object" ? (
            <JsonView
              value={log.metadata}
              displayDataTypes={false}
              displayObjectSize={false}
              enableClipboard={true}
              collapsed={1}
              style={
                {
                  fontSize: "11px",
                  backgroundColor: "transparent",
                  "--w-rjv-background-color": "transparent",
                  "--w-rjv-line-color": "rgba(0,0,0,0.05)",
                } as any
              }
            />
          ) : (
            <pre className="whitespace-pre-wrap font-mono text-[11px]">{String(log.metadata)}</pre>
          )}
        </div>
      )}
    </div>
  );
};

const NotificationLogModal: React.FC<NotificationLogModalProps> = ({
  isOpen,
  onClose,
  logs,
  onClear,
}) => {
  const zRef = useRef<number | undefined>(undefined);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  // Search state
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  // Debounce search input
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      setSearchQuery(searchInput);
    }, 300);
    return () => clearTimeout(timeoutId);
  }, [searchInput]);

  // Filter logs based on search query
  const filteredLogs = useMemo(() => {
    if (!searchQuery.trim()) return logs;
    const lowerQuery = searchQuery.toLowerCase();
    return logs.filter((log) => {
      const msgMatch = log.message.toLowerCase().includes(lowerQuery);
      const typeMatch = log.type.toLowerCase().includes(lowerQuery);
      const sourceMatch = log.source?.toLowerCase().includes(lowerQuery);
      const metaMatch =
        log.metadata && JSON.stringify(log.metadata).toLowerCase().includes(lowerQuery);
      return msgMatch || typeMatch || sourceMatch || metaMatch;
    });
  }, [logs, searchQuery]);

  useEffect(() => {
    if (isOpen) {
      const next = getNextGlobalModalZ();
      zRef.current = next;
      if (wrapperRef.current) {
        wrapperRef.current.style.zIndex = String(next);
      }
    }
  }, [isOpen]);

  const bringToFront = () => {
    const next = getNextGlobalModalZ();
    zRef.current = next;
    if (wrapperRef.current) {
      wrapperRef.current.style.zIndex = String(next);
    }
  };

  // Desktop-only: the launcher exposes a way to tail ~/.qimchi/qimchi_debug.log
  // in a real terminal. Hidden in the browser/Docker build (no window.pywebview).
  const canOpenLog = typeof window !== "undefined" && !!window.pywebview?.api?.open_log_terminal;

  const openDebugLog = async () => {
    try {
      await window.pywebview?.api?.open_log_terminal?.();
    } catch (err) {
      console.error("Failed to open debug log terminal:", err);
    }
  };

  if (!isOpen) return null;

  const getIcon = (type: string) => {
    switch (type) {
      case "success":
        return <CheckCircle size={16} className="text-green-600 mt-0.5" />;
      case "error":
        return <AlertCircle size={16} className="text-red-600 mt-0.5" />;
      case "warning":
        return <AlertTriangle size={16} className="text-yellow-600 mt-0.5" />;
      case "info":
      default:
        return <Info size={16} className="text-blue-600 mt-0.5" />;
    }
  };

  const getLogStyles = (type: string) => {
    switch (type) {
      case "success":
        return "bg-green-50 border-green-200 text-green-800";
      case "error":
        return "bg-red-50 border-red-200 text-red-800";
      case "warning":
        return "bg-yellow-50 border-yellow-200 text-yellow-800";
      case "info":
      default:
        return "bg-blue-50 border-blue-200 text-blue-800";
    }
  };

  return (
    <div ref={wrapperRef} className="fixed inset-0 pointer-events-none">
      <Rnd
        default={{
          x: window.innerWidth - 384 - 28,
          y: window.innerHeight - 550 - 28,
          width: 384,
          height: 550,
        }}
        minWidth={300}
        minHeight={200}
        bounds="parent"
        dragHandleClassName="drag-handle"
        style={{ pointerEvents: "auto" }}
        onMouseDown={() => bringToFront()}
        onPointerDown={() => bringToFront()}
      >
        <div className="bg-white rounded-lg shadow-2xl border-2 border-slate-300 w-full h-full flex flex-col overflow-hidden">
          {/* Header */}
          <div className="flex bg-gray-200 items-center justify-between p-2 border-b border-slate-300 drag-handle cursor-move">
            <h3 className="font-semibold text-slate-800 flex items-center gap-2">
              <History size={18} className="text-blue-600" />
              Notifications Log
            </h3>
            <div className="flex items-center gap-1">
              {canOpenLog && (
                <button
                  onClick={openDebugLog}
                  className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors"
                  title="Open debug log (live) in a terminal"
                >
                  <ScrollText size={16} />
                </button>
              )}
              {logs.length > 0 && (
                <button
                  onClick={onClear}
                  className="p-1.5 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"
                  title="Clear Logs"
                >
                  <Trash2 size={16} />
                </button>
              )}
              <button
                onClick={onClose}
                className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-200 rounded-md transition-colors"
                title="Close"
              >
                <X size={18} />
              </button>
            </div>
          </div>

          {/* Search Bar - Similar to Metadata.tsx */}
          <div className="bg-slate-100 p-2 px-3 border-b border-slate-200">
            <div className="relative">
              <Search
                size={14}
                className="absolute left-2.5 top-1/2 transform -translate-y-1/2 text-slate-400"
              />
              <input
                type="text"
                placeholder="Search notifications..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="w-full pl-8 pr-8 py-1.5 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white text-slate-700"
              />
              {searchInput && (
                <button
                  onClick={() => {
                    setSearchInput("");
                    setSearchQuery("");
                  }}
                  className="absolute right-2 top-1/2 transform -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5"
                  title="Clear search"
                >
                  <X size={14} />
                </button>
              )}
            </div>
            {searchQuery && (
              <div className="mt-1.5 px-0.5 flex justify-between items-center text-[11px] text-slate-500 italic">
                <span>
                  Found {filteredLogs.length} match
                  {filteredLogs.length !== 1 ? "es" : ""}
                </span>
                {searchInput !== searchQuery && <span>Searching...</span>}
              </div>
            )}
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2 bg-slate-50">
            {filteredLogs.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-slate-400">
                <History size={32} className="mb-2 opacity-30" />
                <p className="text-sm">
                  {searchInput ? "No matches found" : "No notifications yet"}
                </p>
              </div>
            ) : (
              filteredLogs.map((log) => (
                <NotificationLogEntry
                  key={log.id}
                  log={log}
                  getIcon={getIcon}
                  getLogStyles={getLogStyles}
                />
              ))
            )}
          </div>
        </div>
      </Rnd>
    </div>
  );
};

export default NotificationLogModal;

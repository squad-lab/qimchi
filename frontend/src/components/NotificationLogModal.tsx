import React, { useState, useEffect, useRef } from "react";
import {
  X,
  History,
  Trash2,
  CheckCircle,
  AlertCircle,
  AlertTriangle,
  Info,
} from "lucide-react";
import { Rnd } from "react-rnd";
import { LogItem } from "../hooks/useToast";

interface NotificationLogModalProps {
  isOpen: boolean;
  onClose: () => void;
  logs: LogItem[];
  onClear: () => void;
}

// Simple global z-index manager so modals can stack above each other.
const getNextGlobalModalZ = (): number => {
  if (typeof window === "undefined") return 1000;
  const w = window as unknown as { __qimchi_modal_z?: number };
  if (!w.__qimchi_modal_z) w.__qimchi_modal_z = 1000;
  w.__qimchi_modal_z = (w.__qimchi_modal_z || 1000) + 1;
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

const NotificationLogModal: React.FC<NotificationLogModalProps> = ({
  isOpen,
  onClose,
  logs,
  onClear,
}) => {
  const [zIndexLocal, setZIndexLocal] = useState<number | undefined>(undefined);
  const zRef = useRef<number | undefined>(undefined);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      const next = getNextGlobalModalZ();
      zRef.current = next;
      setZIndexLocal(next);
    }
  }, [isOpen]);

  useEffect(() => {
    if (wrapperRef.current && zIndexLocal !== undefined) {
      wrapperRef.current.style.zIndex = String(zIndexLocal);
    }
  }, [zIndexLocal]);

  const bringToFront = () => {
    const next = getNextGlobalModalZ();
    zRef.current = next;
    setZIndexLocal(next);
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

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2 bg-slate-50">
            {logs.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-slate-400">
                <History size={32} className="mb-2 opacity-30" />
                <p className="text-sm">No notifications yet</p>
              </div>
            ) : (
              logs.map((log) => (
                <div
                  key={log.id}
                  className={`p-3 rounded-lg border shadow-sm flex items-start gap-3 ${getLogStyles(log.type)}`}
                >
                  <div className="flex-shrink-0">{getIcon(log.type)}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium break-words leading-tight">
                      {log.message}
                    </p>
                    <div className="flex items-center gap-2 mt-1.5 opacity-70">
                      <span className="text-[10px] uppercase tracking-wider font-semibold">
                        {log.type}
                      </span>
                      <span className="w-1 h-1 rounded-full bg-current opacity-40"></span>
                      <span className="text-xs">
                        {formatTime(log.timestamp)}
                      </span>
                      <span className="text-[10px] ml-auto">
                        {formatDate(log.timestamp)}
                      </span>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </Rnd>
    </div>
  );
};

export default NotificationLogModal;

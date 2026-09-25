import React, { useState, useEffect, useCallback, useMemo } from "react";
import { X, AlertCircle, CheckCircle, Info, AlertTriangle } from "lucide-react";
import { ToastContext, LogItem, ToastAction } from "../hooks/useToast";
import NotificationLogModal from "./NotificationLogModal";
import { useShortcut } from "../hooks/useGlobalShortcuts";

interface ToastProps {
  message: string;
  type?: "success" | "error" | "warning" | "info";
  duration?: number;
  onClose?: () => void;
  className?: string;
  action?: ToastAction;
  /** Pause automatic dismissal. */
  paused?: boolean;
}

interface ToastItem {
  id: string;
  message: string;
  type: "success" | "error" | "warning" | "info";
  duration: number;
  action?: ToastAction;
}

// The log is a running history, so it needs a ceiling: a long session with
// live measurements can raise thousands of notifications, each holding its
// metadata.
const MAX_LOG_ENTRIES = 500;

export const ToastProvider: React.FC<{
  children: React.ReactNode;
  /** How many notifications the log keeps; only tests pass a smaller one. */
  maxLogEntries?: number;
}> = ({ children, maxLogEntries = MAX_LOG_ENTRIES }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [logs, setLogs] = useState<LogItem[]>([]);
  const [isLogModalOpen, setIsLogModalOpen] = useState(false);

  const showToast = useCallback(
    (
      message: string,
      type: "success" | "error" | "warning" | "info" = "info",
      duration: number = 3000,
      source?: string,
      metadata?: any,
      action?: ToastAction,
    ) => {
      const id = Date.now().toString() + Math.random().toString(36).substr(2, 9);
      const newToast: ToastItem = { id, message, type, duration, action };

      setToasts((prev) => [...prev, newToast]);
      setLogs((prev) =>
        [
          {
            id,
            message,
            type,
            timestamp: new Date().toISOString(),
            source,
            metadata,
          },
          ...prev,
        ].slice(0, maxLogEntries),
      );

      // Each card owns its pausable dismiss timer.
    },
    [maxLogEntries],
  ); // Otherwise independent: it uses the setToasts/setLogs updaters

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []); // No dependencies - uses setToasts functional update

  const openLogModal = useCallback(() => {
    setIsLogModalOpen(true);
  }, []);

  useShortcut("escape", () => {
    setIsLogModalOpen(false);
  });

  const contextValue = useMemo(() => ({ showToast, openLogModal }), [showToast, openLogModal]);

  return (
    <ToastContext.Provider value={contextValue}>
      {children}
      <ToastContainer toasts={toasts} onRemove={removeToast} />
      <NotificationLogModal
        isOpen={isLogModalOpen}
        onClose={() => setIsLogModalOpen(false)}
        logs={logs}
        onClear={() => setLogs([])}
      />
    </ToastContext.Provider>
  );
};

// Collapse notifications into a deck and expand them on hover.
const STACK_PEEK_PX = 10;
const STACK_SCALE_STEP = 0.04;
const STACK_GAP_PX = 8;
const CARDS_VISIBLE_IN_STACK = 3;
// Fallback until a card has been measured.
const ASSUMED_CARD_HEIGHT_PX = 56;

const ToastContainer: React.FC<{
  toasts: ToastItem[];
  onRemove: (id: string) => void;
}> = ({ toasts, onRemove }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [heights, setHeights] = useState<Record<string, number>>({});

  // Index zero is the front card.
  const ordered = useMemo(() => [...toasts].reverse(), [toasts]);

  const measure = useCallback((id: string, node: HTMLDivElement | null) => {
    if (!node) return;
    const height = node.offsetHeight;
    setHeights((prev) => (prev[id] === height ? prev : { ...prev, [id]: height }));
  }, []);

  useEffect(() => {
    if (!toasts.length) setIsExpanded(false);
  }, [toasts.length]);

  if (!ordered.length) return null;

  // Expanded cards clear the full height of those before them.
  const offsets = ordered.map((_, index) =>
    isExpanded
      ? ordered
          .slice(0, index)
          .reduce(
            (sum, front) => sum + (heights[front.id] || ASSUMED_CARD_HEIGHT_PX) + STACK_GAP_PX,
            0,
          )
      : index * STACK_PEEK_PX,
  );

  return (
    <div
      className="fixed bottom-4 right-4 z-50 w-[min(24rem,calc(100vw-2rem))]"
      onMouseEnter={() => setIsExpanded(true)}
      onMouseLeave={() => setIsExpanded(false)}
    >
      {ordered.map((toast, index) => {
        const buried = !isExpanded && index >= CARDS_VISIBLE_IN_STACK;
        return (
          <div
            key={toast.id}
            ref={(node) => measure(toast.id, node)}
            className="absolute bottom-0 right-0 w-full origin-bottom transition-all duration-200 ease-out"
            style={{
              transform: `translateY(${-offsets[index]}px) scale(${
                isExpanded ? 1 : 1 - index * STACK_SCALE_STEP
              })`,
              zIndex: ordered.length - index,
              opacity: buried ? 0 : 1,
              pointerEvents: buried ? "none" : "auto",
            }}
          >
            <Toast
              message={toast.message}
              type={toast.type}
              duration={toast.duration}
              action={toast.action}
              paused={isExpanded}
              onClose={() => onRemove(toast.id)}
            />
          </div>
        );
      })}
    </div>
  );
};

const Toast: React.FC<ToastProps> = ({
  message,
  type = "info",
  duration = 3000,
  onClose,
  className = "",
  action,
  paused = false,
}) => {
  const [isVisible, setIsVisible] = useState(true);
  const [isExiting, setIsExiting] = useState(false);

  useEffect(() => {
    if (paused) return;
    const timer = setTimeout(() => {
      setIsExiting(true);
      setTimeout(() => {
        setIsVisible(false);
        onClose?.();
      }, 200); // Animation duration
    }, duration);

    return () => clearTimeout(timer);
  }, [duration, onClose, paused]);

  const getToastStyles = () => {
    switch (type) {
      case "success":
        return {
          bg: "bg-green-50",
          border: "border-green-200",
          text: "text-green-800",
          icon: <CheckCircle size={20} className="text-green-600" />,
        };
      case "error":
        return {
          bg: "bg-red-50",
          border: "border-red-200",
          text: "text-red-800",
          icon: <AlertCircle size={20} className="text-red-600" />,
        };
      case "warning":
        return {
          bg: "bg-yellow-50",
          border: "border-yellow-200",
          text: "text-yellow-800",
          icon: <AlertTriangle size={20} className="text-yellow-600" />,
        };
      case "info":
      default:
        return {
          bg: "bg-blue-50",
          border: "border-blue-200",
          text: "text-blue-800",
          icon: <Info size={20} className="text-blue-600" />,
        };
    }
  };

  const styles = getToastStyles();

  if (!isVisible) return null;

  return (
    <div
      className={`
        flex items-center space-x-3 p-4 rounded-lg border shadow-lg transition-all duration-200
        ${styles.bg} ${styles.border} ${styles.text}
        ${
          isExiting ? "opacity-0 transform translate-x-full" : "opacity-100 transform translate-x-0"
        }
        ${className}
      `}
    >
      {styles.icon}
      <span className="min-w-0 flex-1 text-sm font-medium wrap-anywhere">{message}</span>
      {action && (
        <button
          type="button"
          onClick={() => {
            action.onClick();
            setIsVisible(false);
            onClose?.();
          }}
          className="rounded px-2 py-1 text-sm font-semibold underline underline-offset-2 hover:bg-black/5"
        >
          {action.label}
        </button>
      )}
      <button
        onClick={() => {
          setIsExiting(true);
          setTimeout(() => {
            setIsVisible(false);
            onClose?.();
          }, 200);
        }}
        className="text-gray-400 hover:text-gray-600 transition-colors"
        aria-label="Close toast"
      >
        <X size={16} />
      </button>
    </div>
  );
};

export default Toast;

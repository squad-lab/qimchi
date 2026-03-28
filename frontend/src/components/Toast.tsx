import React, { useState, useEffect, useCallback, useMemo } from "react";
import { X, AlertCircle, CheckCircle, Info, AlertTriangle } from "lucide-react";
import { ToastContext, LogItem } from "../hooks/useToast";
import NotificationLogModal from "./NotificationLogModal";
import { useShortcut } from "../hooks/useGlobalShortcuts";

interface ToastProps {
  message: string;
  type?: "success" | "error" | "warning" | "info";
  duration?: number;
  onClose?: () => void;
  className?: string;
}

interface ToastItem {
  id: string;
  message: string;
  type: "success" | "error" | "warning" | "info";
  duration: number;
}

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
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
    ) => {
      const id =
        Date.now().toString() + Math.random().toString(36).substr(2, 9);
      const newToast: ToastItem = { id, message, type, duration };

      setToasts((prev) => [...prev, newToast]);
      setLogs((prev) => [
        {
          id,
          message,
          type,
          timestamp: new Date().toISOString(),
          source,
          metadata,
        },
        ...prev,
      ]);

      // Auto-remove toast after duration
      setTimeout(() => {
        setToasts((prev) => prev.filter((toast) => toast.id !== id));
      }, duration);
    },
    [],
  ); // No dependencies - uses setToasts functional update

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []); // No dependencies - uses setToasts functional update

  const openLogModal = useCallback(() => {
    setIsLogModalOpen(true);
  }, []);

  useShortcut("escape", () => {
    setIsLogModalOpen(false);
  });

  const contextValue = useMemo(
    () => ({ showToast, openLogModal }),
    [showToast, openLogModal],
  );

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

const ToastContainer: React.FC<{
  toasts: ToastItem[];
  onRemove: (id: string) => void;
}> = ({ toasts, onRemove }) => {
  return (
    <div className="fixed bottom-4 right-4 z-50 space-y-2">
      {toasts.map((toast) => (
        <Toast
          key={toast.id}
          message={toast.message}
          type={toast.type}
          duration={toast.duration}
          onClose={() => onRemove(toast.id)}
        />
      ))}
    </div>
  );
};

const Toast: React.FC<ToastProps> = ({
  message,
  type = "info",
  duration = 3000,
  onClose,
  className = "",
}) => {
  const [isVisible, setIsVisible] = useState(true);
  const [isExiting, setIsExiting] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsExiting(true);
      setTimeout(() => {
        setIsVisible(false);
        onClose?.();
      }, 200); // Animation duration
    }, duration);

    return () => clearTimeout(timer);
  }, [duration, onClose]);

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
          isExiting
            ? "opacity-0 transform translate-x-full"
            : "opacity-100 transform translate-x-0"
        }
        ${className}
      `}
    >
      {styles.icon}
      <span className="flex-1 text-sm font-medium">{message}</span>
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

import React from "react";

interface ToastContextType {
  showToast: (message: string, type?: "success" | "error" | "warning" | "info", duration?: number) => void;
}

export const ToastContext = React.createContext<ToastContextType | null>(null);

export const useToast = () => {
  const context = React.useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context;
};

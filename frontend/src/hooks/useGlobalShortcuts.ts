import { useEffect, useRef } from "react";

export const isEditableTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tagName = target.tagName.toLowerCase();
  if (tagName === "input" || tagName === "textarea" || tagName === "select") {
    const inputTarget = target as HTMLInputElement;
    if (
      tagName === "input" &&
      (inputTarget.type === "checkbox" ||
        inputTarget.type === "radio" ||
        inputTarget.type === "range" ||
        inputTarget.type === "color")
    ) {
      return false;
    }
    return true;
  }

  if (target.isContentEditable) {
    return true;
  }

  return Boolean(target.closest("[contenteditable='true'], [role='textbox']"));
};

export type ShortcutAction =
  | "plot"
  | "heatmap"
  | "lineplot"
  | "toggle-sidebar"
  | "toggle-metadata"
  | "toggle-notes"
  | "clear-composer"
  | "clear-basket"
  | "clear-viewer"
  | "refresh-dir";

interface ShortcutConfig {
  action: ShortcutAction;
  alt?: boolean;
  shift?: boolean;
}

// Single-file mapping for all global shortcuts
export const KEYBOARD_SHORTCUTS: Record<string, ShortcutConfig> = {
  p: { action: "plot" },
  h: { action: "heatmap" },
  l: { action: "lineplot" },
  e: { action: "toggle-sidebar", shift: true },
  m: { action: "toggle-metadata", shift: true },
  n: { action: "toggle-notes", shift: true },
  r: { action: "refresh-dir", shift: true },
  c: { action: "clear-composer", alt: true, shift: true }, // Alt+Shift+C
  b: { action: "clear-basket", alt: true, shift: true },   // Alt+Shift+B
  v: { action: "clear-viewer", alt: true, shift: true },   // Alt+Shift+V
};

export const useGlobalShortcutsInit = () => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.repeat || isEditableTarget(e.target)) {
        return;
      }

      const key = e.key.toLowerCase();
      // Only process standard keyboard commands without ctrl or meta to avoid OS/browser conflicts
      if (e.ctrlKey || e.metaKey) {
        return;
      }

      for (const [mappedKey, config] of Object.entries(KEYBOARD_SHORTCUTS)) {
        if (key === mappedKey) {
          const requiresAlt = config.alt || false;
          const requiresShift = config.shift || false;

          if (e.altKey === requiresAlt && e.shiftKey === requiresShift) {
            e.preventDefault();
            window.dispatchEvent(
              new CustomEvent(`qimchi:shortcut:${config.action}`)
            );
            return;
          }
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);
};

export const useShortcut = (action: ShortcutAction, callback: () => void) => {
  const callbackRef = useRef(callback);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    const handler = () => callbackRef.current();
    const eventName = `qimchi:shortcut:${action}`;

    window.addEventListener(eventName, handler);
    return () => window.removeEventListener(eventName, handler);
  }, [action]);
};

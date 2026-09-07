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
  | "refresh-dir"
  | "select-plot-1"
  | "select-plot-2"
  | "select-plot-3"
  | "select-plot-4"
  | "select-plot-5"
  | "select-plot-6"
  | "select-plot-7"
  | "select-plot-8"
  | "select-plot-9"
  | "selected-enter-linecut"
  | "selected-open-filters"
  | "selected-open-appearance"
  | "selected-toggle-maximize"
  | "selected-toggle-bgcorr"
  | "selected-swap-axes"
  | "selected-reset-plot"
  | "selected-send-to-notes"
  | "selected-export-images"
  | "selected-remove-plot"
  | "toggle-help"
  | "escape";

interface ShortcutConfig {
  action: ShortcutAction;
  alt?: boolean;
  shift?: boolean;
}

// Single-file mapping for all global shortcuts
export const KEYBOARD_SHORTCUTS: Record<string, ShortcutConfig | ShortcutConfig[]> = {
  escape: { action: "escape" },
  esc: { action: "escape" },
  p: { action: "plot" },
  l: { action: "lineplot" },
  f: { action: "selected-open-filters" },
  a: { action: "selected-open-appearance" },
  b: [
    { action: "selected-toggle-bgcorr" },
    { action: "clear-basket", alt: true, shift: true }, // Alt+Shift+B
  ],
  s: { action: "selected-swap-axes" },
  x: { action: "selected-enter-linecut", shift: true },
  "1": { action: "select-plot-1" },
  "2": { action: "select-plot-2" },
  "3": { action: "select-plot-3" },
  "4": { action: "select-plot-4" },
  "5": { action: "select-plot-5" },
  "6": { action: "select-plot-6" },
  "7": { action: "select-plot-7" },
  "8": { action: "select-plot-8" },
  "9": { action: "select-plot-9" },
  m: [{ action: "selected-toggle-maximize" }, { action: "toggle-metadata", shift: true }],
  e: [{ action: "selected-export-images" }, { action: "toggle-sidebar", shift: true }],
  n: [{ action: "selected-send-to-notes" }, { action: "toggle-notes", shift: true }],
  r: [{ action: "selected-reset-plot" }, { action: "refresh-dir", shift: true }],
  c: { action: "clear-composer", alt: true, shift: true }, // Alt+Shift+C
  v: { action: "clear-viewer", alt: true, shift: true }, // Alt+Shift+V
  h: [
    { action: "heatmap" },
    { action: "toggle-help", shift: true }, // Shift+H
  ],
  delete: { action: "selected-remove-plot" },
};

export const useGlobalShortcutsInit = () => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      // Always allow Escape, even when an input/textarea has focus.
      if (e.repeat || (key !== "escape" && key !== "esc" && isEditableTarget(e.target))) {
        return;
      }

      // Only process standard keyboard commands without ctrl or meta to avoid OS/browser conflicts
      if (e.ctrlKey || e.metaKey) {
        return;
      }

      for (const [mappedKey, rawConfig] of Object.entries(KEYBOARD_SHORTCUTS)) {
        if (key === mappedKey) {
          const configs = Array.isArray(rawConfig) ? rawConfig : [rawConfig];
          for (const config of configs) {
            const requiresAlt = config.alt || false;
            const requiresShift = config.shift || false;

            if (e.altKey === requiresAlt && e.shiftKey === requiresShift) {
              e.preventDefault();
              window.dispatchEvent(new CustomEvent(`qimchi:shortcut:${config.action}`));
              return;
            }
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

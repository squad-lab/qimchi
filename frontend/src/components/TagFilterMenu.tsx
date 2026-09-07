// Searchable tag-filter dropdown for the DirTree filter panel.
//
// Distinct from TagPopover: that one ASSIGNS tags to a measurement, this one
// SELECTS tags to filter the tree by.
//
// Rendered in a portal so it isn't clipped by the virtualized tree.
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Search } from "lucide-react";

import type { Tag } from "../services/libraryAPI";

interface Props {
  anchorEl: HTMLElement;
  tags: Tag[];
  selectedTagIds: number[];
  onToggle: (tagId: number) => void;
  onClear: () => void;
  onClose: () => void;
}

const TagFilterMenu = ({ anchorEl, tags, selectedTagIds, onToggle, onClear, onClose }: Props) => {
  const ref = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");

  // Position under the anchor, clamped to the viewport.
  const rect = anchorEl.getBoundingClientRect();
  const pos = {
    top: Math.min(rect.bottom + 4, window.innerHeight - 300),
    left: Math.min(rect.left, window.innerWidth - 240),
  };

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (
        ref.current &&
        !ref.current.contains(e.target as Node) &&
        !anchorEl.contains(e.target as Node)
      ) {
        onClose();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [anchorEl, onClose]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matching = q ? tags.filter((t) => t.name.toLowerCase().includes(q)) : tags;
    // Selected tags float to the top so the active filter stays visible even
    // once the list is long enough to scroll.
    return [...matching].sort((a, b) => {
      const aSel = selectedTagIds.includes(a.id) ? 0 : 1;
      const bSel = selectedTagIds.includes(b.id) ? 0 : 1;
      return aSel - bSel || a.name.localeCompare(b.name);
    });
  }, [tags, query, selectedTagIds]);

  return createPortal(
    <div
      ref={ref}
      style={{ top: pos.top, left: pos.left }}
      className="fixed z-50 w-56 rounded-md border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-800"
      role="dialog"
      aria-label="Filter by tags"
    >
      <div className="flex items-center gap-1.5 border-b border-gray-200 px-2 py-1.5 dark:border-gray-700">
        <Search size={12} className="shrink-0 text-gray-400" />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter tags..."
          className="w-full bg-transparent text-xs outline-none placeholder:text-gray-400"
        />
      </div>

      <div className="max-h-52 overflow-y-auto py-1">
        {visible.length === 0 ? (
          <div className="px-3 py-2 text-xs text-gray-400">
            {tags.length === 0 ? "No tags yet" : "No matching tags"}
          </div>
        ) : (
          visible.map((tag) => {
            const active = selectedTagIds.includes(tag.id);
            return (
              <button
                key={tag.id}
                type="button"
                onClick={() => onToggle(tag.id)}
                className="flex w-full items-center gap-2 px-2 py-1 text-left text-xs hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                <span
                  className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border ${
                    active
                      ? "border-indigo-500 bg-indigo-500 text-white"
                      : "border-gray-300 dark:border-gray-600"
                  }`}
                >
                  {active && <Check size={10} />}
                </span>
                <span className="truncate">#{tag.name}</span>
              </button>
            );
          })
        )}
      </div>

      {selectedTagIds.length > 0 && (
        <div className="border-t border-gray-200 px-2 py-1 dark:border-gray-700">
          <button
            type="button"
            onClick={onClear}
            className="w-full rounded px-2 py-1 text-left text-[11px] text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            Clear {selectedTagIds.length} selected
          </button>
        </div>
      )}
    </div>,
    document.body,
  );
};

export default TagFilterMenu;

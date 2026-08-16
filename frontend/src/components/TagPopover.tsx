// Small popover for adding/removing/creating tags on a measurement. Rendered in
// a portal so it isn't clipped by the virtualized DirTree rows. Used by
// DirTree's per-row tag button (see stores/libraryStore).
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Plus } from "lucide-react";

import type { Tag } from "../services/libraryAPI";

interface Props {
  anchorEl: HTMLElement;
  tags: Tag[];
  currentTagIds: number[];
  onToggle: (tagId: number) => void;
  onCreate: (name: string) => Promise<Tag | undefined>;
  onClose: () => void;
}

const TagPopover = ({
  anchorEl,
  tags,
  currentTagIds,
  onToggle,
  onCreate,
  onClose,
}: Props) => {
  const ref = useRef<HTMLDivElement>(null);
  const [name, setName] = useState("");

  // Position under the anchor, clamped to the viewport. Computed during render
  // (the anchor element is stable for the popover's lifetime).
  const rect = anchorEl.getBoundingClientRect();
  const pos = {
    top: Math.min(rect.bottom + 4, window.innerHeight - 260),
    left: Math.min(rect.left, window.innerWidth - 232),
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
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onEsc);
    };
  }, [anchorEl, onClose]);

  const handleCreate = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const existing = tags.find(
      (t) => t.name.toLowerCase() === trimmed.toLowerCase(),
    );
    if (existing) {
      if (!currentTagIds.includes(existing.id)) onToggle(existing.id);
    } else {
      const created = await onCreate(trimmed);
      if (created) onToggle(created.id);
    }
    setName("");
  };

  return createPortal(
    <div
      ref={ref}
      className="fixed z-[1000] w-56 bg-white border border-gray-200 rounded-lg shadow-lg p-2 text-sm"
      style={{ top: pos.top, left: pos.left }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="max-h-40 overflow-y-auto">
        {tags.length === 0 && (
          <div className="text-gray-400 text-xs px-1 py-1">No tags yet</div>
        )}
        {tags.map((tag) => {
          const on = currentTagIds.includes(tag.id);
          return (
            <button
              key={tag.id}
              type="button"
              onClick={() => onToggle(tag.id)}
              className={`w-full flex items-center gap-2 px-2 py-1 rounded hover:bg-gray-100 ${
                on ? "text-indigo-700" : "text-gray-700"
              }`}
            >
              <span
                className={`w-4 h-4 flex items-center justify-center rounded border shrink-0 ${
                  on ? "bg-indigo-500 border-indigo-500" : "border-gray-300"
                }`}
              >
                {on && <Check size={12} className="text-white" />}
              </span>
              <span className="truncate">#{tag.name}</span>
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-1 mt-1 border-t border-gray-100 pt-1.5">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleCreate();
            }
          }}
          placeholder="New tag..."
          autoFocus
          className="flex-1 min-w-0 border border-gray-300 rounded px-2 py-1 text-xs"
        />
        <button
          type="button"
          onClick={handleCreate}
          className="p-1 text-indigo-600 hover:bg-indigo-50 rounded shrink-0"
          aria-label="Create and apply tag"
        >
          <Plus size={14} />
        </button>
      </div>
    </div>,
    document.body,
  );
};

export default TagPopover;

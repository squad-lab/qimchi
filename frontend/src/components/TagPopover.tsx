// Small popover for adding/removing/creating tags on a measurement, and for
// renaming or deleting the tags themselves. Rendered in a portal so it isn't
// clipped by the virtualized DirTree rows. Used by DirTree's per-row tag
// button and its bulk tag button (see stores/libraryStore).
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";

import type { Tag } from "../services/libraryAPI";

interface Props {
  anchorEl: HTMLElement;
  tags: Tag[];
  currentTagIds: number[];
  onToggle: (tagId: number) => void;
  onCreate: (name: string) => Promise<Tag | undefined>;
  /** Resolves to an error message when the new name is rejected. */
  onRename?: (tagId: number, name: string) => Promise<string | undefined>;
  onDelete?: (tagId: number) => Promise<void>;
  onClose: () => void;
}

const TagPopover = ({
  anchorEl,
  tags,
  currentTagIds,
  onToggle,
  onCreate,
  onRename,
  onDelete,
  onClose,
}: Props) => {
  const ref = useRef<HTMLDivElement>(null);
  const [name, setName] = useState("");
  // Which tag is being renamed, and the draft name for it.
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Deleting a tag removes it from every measurement carrying it, so it is
  // confirmed inside the row rather than on the first click.
  const [confirmingId, setConfirmingId] = useState<number | null>(null);

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
      if (e.key !== "Escape") return;
      // Esc backs out of a rename or a pending delete first, so it cannot
      // close the popover out from under an unfinished edit.
      if (editingId !== null || confirmingId !== null) {
        setEditingId(null);
        setConfirmingId(null);
        setError(null);
        return;
      }
      onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onEsc);
    };
  }, [anchorEl, onClose, editingId, confirmingId]);

  const handleCreate = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const existing = tags.find((t) => t.name.toLowerCase() === trimmed.toLowerCase());
    if (existing) {
      if (!currentTagIds.includes(existing.id)) onToggle(existing.id);
    } else {
      const created = await onCreate(trimmed);
      if (created) onToggle(created.id);
    }
    setName("");
  };

  const startRename = (tag: Tag) => {
    setConfirmingId(null);
    setError(null);
    setEditingId(tag.id);
    setDraft(tag.name);
  };

  const commitRename = async (tagId: number) => {
    const trimmed = draft.trim();
    if (!trimmed || !onRename) {
      setEditingId(null);
      return;
    }
    const message = await onRename(tagId, trimmed);
    if (message) {
      setError(message);
      return; // keep the row open so the name can be corrected
    }
    setEditingId(null);
    setError(null);
  };

  const confirmDelete = async (tagId: number) => {
    if (onDelete) await onDelete(tagId);
    setConfirmingId(null);
  };

  return createPortal(
    <div
      ref={ref}
      className="fixed z-[1000] w-64 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-2 text-sm"
      style={{ top: pos.top, left: pos.left }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="max-h-48 overflow-y-auto">
        {tags.length === 0 && <div className="text-gray-400 text-xs px-1 py-1">No tags yet</div>}
        {tags.map((tag) => {
          const on = currentTagIds.includes(tag.id);

          if (editingId === tag.id) {
            return (
              <div key={tag.id} className="flex items-center gap-1 px-1 py-1">
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void commitRename(tag.id);
                    }
                  }}
                  autoFocus
                  aria-label={`Rename tag ${tag.name}`}
                  className="flex-1 min-w-0 border border-gray-300 rounded px-2 py-1 text-xs"
                />
                <button
                  type="button"
                  onClick={() => void commitRename(tag.id)}
                  className="p-1 text-indigo-600 hover:bg-indigo-50 rounded shrink-0"
                  aria-label="Save tag name"
                >
                  <Check size={14} />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditingId(null);
                    setError(null);
                  }}
                  className="p-1 text-gray-500 hover:bg-gray-100 rounded shrink-0"
                  aria-label="Cancel rename"
                >
                  <X size={14} />
                </button>
              </div>
            );
          }

          if (confirmingId === tag.id) {
            const count = tag.count ?? 0;
            return (
              <div key={tag.id} className="px-2 py-1.5 rounded bg-red-50 text-[11px]">
                <div className="text-red-900 leading-snug">
                  Delete <span className="font-medium">#{tag.name}</span>?{" "}
                  {count === 1 ? "1 dataset" : `${count} datasets`} will be affected.
                </div>
                <div className="flex justify-end gap-1 mt-1">
                  <button
                    type="button"
                    onClick={() => setConfirmingId(null)}
                    className="px-2 py-0.5 rounded border border-gray-300 text-gray-700 hover:bg-gray-100"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void confirmDelete(tag.id)}
                    className="px-2 py-0.5 rounded bg-red-600 text-white hover:bg-red-700"
                  >
                    Delete
                  </button>
                </div>
              </div>
            );
          }

          return (
            <div
              key={tag.id}
              className="group flex items-center rounded hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              <button
                type="button"
                onClick={() => onToggle(tag.id)}
                className={`flex-1 min-w-0 flex items-center gap-2 px-2 py-1 text-left ${
                  on ? "text-indigo-700 dark:text-indigo-300" : "text-gray-700 dark:text-gray-200"
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
                {(tag.count ?? 0) > 0 && (
                  <span className="ml-auto text-[10px] text-gray-400 shrink-0">{tag.count}</span>
                )}
              </button>
              {onRename && (
                <button
                  type="button"
                  onClick={() => startRename(tag)}
                  className="qimchi-tag-action qimchi-tag-action-edit p-1 mr-0.5 rounded shrink-0"
                  aria-label={`Rename tag ${tag.name}`}
                  title="Rename tag"
                >
                  <Pencil size={12} />
                </button>
              )}
              {onDelete && (
                <button
                  type="button"
                  onClick={() => {
                    setEditingId(null);
                    setConfirmingId(tag.id);
                  }}
                  className="qimchi-tag-action qimchi-tag-action-delete p-1 mr-1 rounded shrink-0"
                  aria-label={`Delete tag ${tag.name}`}
                  title="Delete tag"
                >
                  <Trash2 size={12} />
                </button>
              )}
            </div>
          );
        })}
      </div>
      {error && (
        <div className="mt-1 px-2 py-1 rounded bg-red-50 text-red-800 text-[11px]" role="alert">
          {error}
        </div>
      )}
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

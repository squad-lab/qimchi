import { useState } from "react";
import {
  Bookmark,
  Check,
  Pencil,
  Play,
  Replace,
  RotateCcw,
  Save,
  Trash2,
  Unlink,
  X,
} from "lucide-react";

import Tooltip from "../Tooltip";
import type { FilterPreset, PresetFilter } from "../../services/libraryAPI";
import { describePresetChanges, presetSummary, samePresetFilters } from "../../utils/filterPresets";

const buttonBase =
  "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50";
const primaryClass = `${buttonBase} bg-blue-600 px-2.5 py-1.5 text-white shadow-sm hover:bg-blue-700`;
const secondaryClass = `${buttonBase} qimchi-dark-hover-plain border border-gray-300 px-2.5 py-1.5 text-gray-700 hover:bg-gray-100`;
const dangerClass = `${buttonBase} bg-red-600 px-2.5 py-1.5 text-white shadow-sm hover:bg-red-700`;
// Disabled buttons swallow no pointer events, so their Tooltip still shows.
const iconClass =
  "qimchi-dark-hover-plain shrink-0 rounded p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 disabled:pointer-events-none disabled:opacity-40";
const inputClass =
  "min-w-0 flex-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500";

/** Resolve to null on success or an error message. */
type Saver = () => Promise<string | null>;

type Tone = "blue" | "amber" | "gray";

const TONES: Record<Tone, string> = {
  blue: "border-blue-200 bg-blue-50 text-blue-700",
  amber: "border-amber-200 bg-amber-100 text-amber-800",
  gray: "border-gray-200 bg-gray-100 text-gray-600",
};

const Chip = ({ tone, children }: { tone: Tone; children: React.ReactNode }) => (
  <span
    className={`shrink-0 rounded border px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide ${TONES[tone]}`}
  >
    {children}
  </span>
);

const ErrorText = ({ children }: { children: React.ReactNode }) => (
  <p role="alert" className="text-xs text-red-700">
    {children}
  </p>
);

/** Single-line preset name form. */
const NameForm = ({
  initial = "",
  label,
  placeholder,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial?: string;
  label: string;
  placeholder?: string;
  submitLabel: string;
  onSubmit: (name: string) => Promise<string | null>;
  onCancel: () => void;
}) => {
  const [name, setName] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    const failure = await onSubmit(trimmed);
    setBusy(false);
    setError(failure);
  };

  return (
    <div className="space-y-1.5">
      <form
        className="flex items-center gap-1.5"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <input
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            setError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              onCancel();
            }
          }}
          aria-label={label}
          placeholder={placeholder}
          autoFocus
          className={inputClass}
        />
        <button type="submit" disabled={busy || !name.trim()} className={primaryClass}>
          <Check size={13} />
          {submitLabel}
        </button>
        <Tooltip content="Cancel" position="top">
          <button type="button" onClick={onCancel} className={iconClass} aria-label="Cancel">
            <X size={16} />
          </button>
        </Tooltip>
      </form>
      {error && <ErrorText>{error}</ErrorText>}
    </div>
  );
};

/** Confirm replacing a preset and show both filter sequences. */
const ReplaceConfirm = ({
  preset,
  filters,
  showChanges = true,
  onConfirm,
  onCancel,
}: {
  preset: FilterPreset;
  filters: PresetFilter[];
  /** List what changes; off where the list is already on screen. */
  showChanges?: boolean;
  onConfirm: Saver;
  onCancel: () => void;
}) => {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const before = presetSummary(preset.filters);
  const after = presetSummary(filters);
  const changes = showChanges ? describePresetChanges(preset.filters, filters) : [];
  return (
    <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-2.5 text-xs text-gray-700">
      <p className="text-sm">
        Replace the filters saved in <strong>{preset.name}</strong>?
      </p>
      {/* The same filters in the same order differ only in settings, listed below. */}
      {before !== after && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
          <dt className="text-gray-500">Now</dt>
          <dd className="text-gray-500 line-through">{before}</dd>
          <dt className="text-gray-500">New</dt>
          <dd className="font-medium">{after}</dd>
        </dl>
      )}
      {changes.length > 0 && (
        <ul className="space-y-0.5 pl-4" aria-label="What changes">
          {changes.map((change) => (
            <li key={change} className="list-disc">
              {change}
            </li>
          ))}
        </ul>
      )}
      <div className="flex justify-end gap-1.5">
        <button type="button" onClick={onCancel} className={secondaryClass}>
          Cancel
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const failure = await onConfirm();
            setBusy(false);
            if (failure) setError(failure);
          }}
          className={primaryClass}
        >
          <Replace size={13} />
          Replace
        </button>
      </div>
      {error && <ErrorText>{error}</ErrorText>}
    </div>
  );
};

type AppliedProps = {
  filters: PresetFilter[];
  /** Preset linked to these filters, if any. */
  linked: FilterPreset | null;
  disabledReason: string | null;
  onSaveNew: (name: string) => Promise<string | null>;
  onUpdate: (preset: FilterPreset) => Promise<string | null>;
  onRevert: (preset: FilterPreset) => void;
  onUnlink: () => void;
};

/** Controls for a plot's linked preset and local changes. */
export const AppliedPreset = ({
  filters,
  linked,
  disabledReason,
  onSaveNew,
  onUpdate,
  onRevert,
  onUnlink,
}: AppliedProps) => {
  const [mode, setMode] = useState<"idle" | "naming" | "confirming">("idle");
  const idle = () => setMode("idle");

  if (disabledReason) return <p className="text-xs text-gray-500">{disabledReason}</p>;

  const changes = linked ? describePresetChanges(linked.filters, filters) : [];
  const edited = changes.length > 0;

  const nameForm = (
    <NameForm
      label="Preset name"
      placeholder={linked ? "Name for the new preset" : "Preset name"}
      submitLabel="Save"
      onSubmit={async (name) => {
        const failure = await onSaveNew(name);
        if (!failure) idle();
        return failure;
      }}
      onCancel={idle}
    />
  );

  if (!linked) {
    return mode === "naming" ? (
      nameForm
    ) : (
      <button type="button" onClick={() => setMode("naming")} className={secondaryClass}>
        <Save size={13} />
        Save as preset
      </button>
    );
  }

  return (
    <section
      aria-label="Linked preset"
      className="space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-2.5"
    >
      <div className="flex min-w-0 items-center gap-2">
        <Bookmark size={14} className="shrink-0 text-blue-600" />
        <span className="min-w-0 truncate text-sm font-semibold text-gray-800" title={linked.name}>
          {linked.name}
        </span>
        {edited ? <Chip tone="amber">Edited</Chip> : <Chip tone="blue">Matches</Chip>}
        <Tooltip content="Unlink these filters from the preset" position="left" className="ml-auto">
          <button
            type="button"
            onClick={onUnlink}
            className={iconClass}
            aria-label={`Unlink from ${linked.name}`}
          >
            <Unlink size={15} />
          </button>
        </Tooltip>
      </div>
      {edited && (
        <ul
          className="space-y-0.5 pl-5 text-xs text-gray-600"
          aria-label="Changes since the preset"
        >
          {changes.map((change) => (
            <li key={change} className="list-disc">
              {change}
            </li>
          ))}
        </ul>
      )}
      {mode === "naming" && nameForm}
      {mode === "confirming" && (
        <ReplaceConfirm
          preset={linked}
          filters={filters}
          showChanges={false}
          onConfirm={async () => {
            const failure = await onUpdate(linked);
            if (!failure) idle();
            return failure;
          }}
          onCancel={idle}
        />
      )}
      {mode === "idle" && (
        <div className="flex flex-wrap gap-1.5">
          {edited && (
            <>
              <button type="button" onClick={() => setMode("confirming")} className={primaryClass}>
                <Save size={13} />
                Update “{linked.name}”
              </button>
              <button type="button" onClick={() => onRevert(linked)} className={secondaryClass}>
                <RotateCcw size={13} />
                Revert
              </button>
            </>
          )}
          <button type="button" onClick={() => setMode("naming")} className={secondaryClass}>
            Save as new preset
          </button>
        </div>
      )}
    </section>
  );
};

type SavedProps = {
  presets: FilterPreset[] | null;
  filters: PresetFilter[];
  linkedId: number | null;
  error: string | null;
  /** Return why a preset is incompatible, or null. */
  unusableReason: (preset: FilterPreset) => string | null;
  onApply: (preset: FilterPreset) => void;
  onSaveNew: (name: string) => Promise<string | null>;
  onReplace: (preset: FilterPreset) => Promise<string | null>;
  onRename: (preset: FilterPreset, name: string) => Promise<string | null>;
  onDelete: (preset: FilterPreset) => Promise<string | null>;
};

type RowMode = { id: number; kind: "renaming" | "replacing" | "removing" } | null;

/** List and manage saved presets. */
export const SavedPresets = ({
  presets,
  filters,
  linkedId,
  error,
  unusableReason,
  onApply,
  onSaveNew,
  onReplace,
  onRename,
  onDelete,
}: SavedProps) => {
  const [naming, setNaming] = useState(false);
  const [rowMode, setRowMode] = useState<RowMode>(null);
  const [rowError, setRowError] = useState<{ id: number; message: string } | null>(null);

  if (error) return <p className="text-sm text-gray-500">{error}</p>;
  if (presets === null) return <p className="text-sm text-gray-500">Loading presets…</p>;

  const hasFilters = filters.length > 0;
  const openRow = (id: number, kind: NonNullable<RowMode>["kind"]) => {
    setRowError(null);
    setRowMode({ id, kind });
  };
  const clearRow = () => {
    setRowMode(null);
    setRowError(null);
  };

  return (
    <div className="space-y-3">
      {naming ? (
        <NameForm
          label="Preset name"
          placeholder="Name for the current filters"
          submitLabel="Save"
          onSubmit={async (name) => {
            const failure = await onSaveNew(name);
            if (!failure) setNaming(false);
            return failure;
          }}
          onCancel={() => setNaming(false)}
        />
      ) : (
        <Tooltip
          content={
            hasFilters ? "Save the applied filters as a new preset" : "Apply some filters first"
          }
          position="left"
          className="w-fit"
        >
          <button
            type="button"
            disabled={!hasFilters}
            onClick={() => setNaming(true)}
            className={`${secondaryClass} disabled:pointer-events-none`}
          >
            <Save size={13} />
            Save current filters as preset
          </button>
        </Tooltip>
      )}

      {presets.length === 0 ? (
        <p className="text-sm text-gray-500">
          No presets yet. Apply filters, then save them here or under Applied.
        </p>
      ) : (
        <ul className="space-y-2">
          {presets.map((preset) => {
            const reason = unusableReason(preset);
            const linked = preset.id === linkedId;
            const matches = hasFilters && samePresetFilters(preset.filters, filters);
            const mode = rowMode?.id === preset.id ? rowMode.kind : null;
            const failure = rowError?.id === preset.id ? rowError.message : null;

            if (mode === "renaming") {
              return (
                <li key={preset.id} className="rounded-lg border border-blue-300 p-2">
                  <NameForm
                    initial={preset.name}
                    label={`Rename preset ${preset.name}`}
                    submitLabel="Rename"
                    onSubmit={async (name) => {
                      const result = await onRename(preset, name);
                      if (!result) clearRow();
                      return result;
                    }}
                    onCancel={clearRow}
                  />
                </li>
              );
            }

            return (
              <li
                key={preset.id}
                className={`space-y-1.5 rounded-lg border p-2.5 ${
                  linked ? "border-blue-300 bg-blue-50" : "border-gray-200"
                }`}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <Bookmark
                    size={14}
                    className={`shrink-0 ${linked ? "text-blue-600" : "text-gray-400"}`}
                  />
                  <span
                    className="min-w-0 truncate text-sm font-semibold text-gray-800"
                    title={preset.name}
                  >
                    {preset.name}
                  </span>
                  {linked && !matches && <Chip tone="amber">Applied · edited</Chip>}
                  {linked && matches && <Chip tone="blue">Applied</Chip>}
                  {!linked && matches && <Chip tone="gray">Matches current</Chip>}
                  <span className="ml-auto flex shrink-0 items-center">
                    <Tooltip
                      content={
                        !hasFilters
                          ? "Apply some filters to replace this preset with them"
                          : matches
                            ? "This preset already has the current filters"
                            : "Replace with the current filters"
                      }
                      position="left"
                    >
                      <button
                        type="button"
                        disabled={!hasFilters || matches}
                        onClick={() => openRow(preset.id, "replacing")}
                        className={iconClass}
                        aria-label={`Replace preset ${preset.name} with the current filters`}
                      >
                        <Replace size={14} />
                      </button>
                    </Tooltip>
                    <Tooltip content="Rename" position="left">
                      <button
                        type="button"
                        onClick={() => openRow(preset.id, "renaming")}
                        className={iconClass}
                        aria-label={`Rename preset ${preset.name}`}
                      >
                        <Pencil size={14} />
                      </button>
                    </Tooltip>
                    <Tooltip content="Remove" position="left">
                      <button
                        type="button"
                        onClick={() => openRow(preset.id, "removing")}
                        className={iconClass}
                        aria-label={`Remove preset ${preset.name}`}
                      >
                        <Trash2 size={14} />
                      </button>
                    </Tooltip>
                  </span>
                </div>
                <p className="text-xs text-gray-500" title={presetSummary(preset.filters)}>
                  {presetSummary(preset.filters)}
                </p>

                {mode === "replacing" && (
                  <ReplaceConfirm
                    preset={preset}
                    filters={filters}
                    onConfirm={async () => {
                      const result = await onReplace(preset);
                      if (!result) clearRow();
                      return result;
                    }}
                    onCancel={clearRow}
                  />
                )}

                {mode === "removing" && (
                  <div className="space-y-2 rounded-md border border-red-200 bg-red-50 p-2.5 text-sm text-red-900">
                    <p>
                      Remove <strong>{preset.name}</strong>? Existing plots keep their filters.
                    </p>
                    <div className="flex justify-end gap-1.5">
                      <button type="button" onClick={clearRow} className={secondaryClass}>
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          const result = await onDelete(preset);
                          if (result) setRowError({ id: preset.id, message: result });
                          else clearRow();
                        }}
                        className={dangerClass}
                      >
                        <Trash2 size={13} />
                        Remove
                      </button>
                    </div>
                  </div>
                )}

                {mode === null && !(linked && matches) && (
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 text-[11px] text-amber-700">{reason}</span>
                    <button
                      type="button"
                      disabled={Boolean(reason)}
                      onClick={() => onApply(preset)}
                      className={primaryClass}
                      aria-label={`${linked ? "Revert to" : "Apply"} preset ${preset.name}`}
                    >
                      {linked ? <RotateCcw size={12} /> : <Play size={12} />}
                      {linked ? "Revert" : "Apply"}
                    </button>
                  </div>
                )}
                {failure && <ErrorText>{failure}</ErrorText>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

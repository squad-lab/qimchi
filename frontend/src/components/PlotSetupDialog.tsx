import { useEffect, useRef, useState } from "react";
import { Database, Download, Bookmark, FolderOpen, Pencil, Play, Trash2, X } from "lucide-react";

import Tooltip from "./Tooltip";
import {
  NameForm,
  dangerClass,
  iconClass,
  primaryClass,
  secondaryClass,
} from "./Plots/FilterPresets";
import {
  createPlotSetup,
  deletePlotSetup,
  getPlotSetups,
  libraryErrorMessage,
  updatePlotSetup,
  type SavedPlotSetup,
} from "../services/libraryAPI";
import { useLibraryStore } from "../stores/libraryStore";
import {
  describePlot,
  plotSetupFileName,
  readPlotSetup,
  readPlotSetupValue,
  type PlotSetupFile,
  type ReadPlotSetupResult,
  type SavedPlot,
} from "../utils/plotSetup";
import { saveTextFile } from "../utils/saveTextFile";

export type PlotSetupDialogMode = "save" | "load";

interface PlotSetupDialogProps {
  mode: PlotSetupDialogMode | null;
  onClose: () => void;
  /** Build a setup from the visible plots using this name. */
  buildSetup: (name: string) => PlotSetupFile;
  /** Draw the setup for selected measurements; return whether plots were added. */
  onLoad: (read: ReadPlotSetupResult, source: string) => boolean;
  /** Reason loading is unavailable, or null when allowed. */
  loadBlockedReason: string | null;
  notify: (message: string, type: "success" | "error") => void;
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

const summary = (plots: SavedPlot[]) => {
  const listed = plots.slice(0, 2).map((plot) => `${plot.plotType}: ${describePlot(plot)}`);
  return plots.length > 2 ? `${listed.join("; ")} and ${plots.length - 2} more` : listed.join("; ");
};

const suggestedName = (plots: SavedPlot[]) =>
  plots.length === 0
    ? "Plot setup"
    : `${describePlot(plots[0])}${plots.length > 1 ? ` and ${plots.length - 1} more` : ""}`;

const saveToFile = async (setup: PlotSetupFile, name: string) =>
  saveTextFile(plotSetupFileName(name), JSON.stringify({ ...setup, name }, null, 2));

/** Dialog for saving and loading plot setups in the library or a file. */
const PlotSetupDialog = ({
  mode,
  onClose,
  buildSetup,
  onLoad,
  loadBlockedReason,
  notify,
}: PlotSetupDialogProps) => {
  const dbAvailable = useLibraryStore((state) => state.dbAvailable);
  const dbError = useLibraryStore((state) => state.dbError);
  const [entries, setEntries] = useState<SavedPlotSetup[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  useEffect(() => {
    if (!mode) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [mode, onClose]);

  useEffect(() => {
    if (!mode || !dbAvailable) return;
    let current = true;
    setListError(null);
    getPlotSetups()
      .then((rows) => current && setEntries(rows))
      .catch(
        (error) =>
          current &&
          setListError(libraryErrorMessage(error, "Saved plot setups could not be loaded.")),
      );
    return () => {
      current = false;
    };
  }, [mode, dbAvailable]);

  if (!mode) return null;

  const upsert = (entry: SavedPlotSetup) =>
    setEntries((rows) =>
      [...(rows ?? []).filter((row) => row.id !== entry.id), entry].sort((a, b) =>
        a.name.localeCompare(b.name),
      ),
    );
  const libraryUnavailable = dbAvailable
    ? listError
    : `The library is unavailable${dbError ? `: ${dbError}` : "."}`;

  return (
    <div
      className="fixed inset-0 z-[2100] flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={mode === "save" ? "Save plot setup" : "Load plot setup"}
        data-qimchi-popup
        className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-lg border-2 border-gray-300 bg-white text-sm text-gray-700 shadow-2xl"
      >
        {/* Match the Filters panel header. */}
        <div className="flex shrink-0 items-center justify-between border-b-2 border-gray-300 bg-gray-200 p-2">
          <div className="flex items-center gap-2">
            <Bookmark size={16} className="shrink-0 text-blue-600" />
            <h2 className="text-base leading-none font-semibold text-gray-800">
              {mode === "save" ? "Save plot setup" : "Load plot setup"}
            </h2>
          </div>
          <Tooltip content="Close" position="bottom">
            <button
              type="button"
              onClick={onClose}
              className="rounded p-1.5 transition-colors hover:bg-gray-300"
              aria-label="Close"
            >
              <X size={16} className="text-red-600" />
            </button>
          </Tooltip>
        </div>
        <div className="min-h-0 space-y-4 overflow-y-auto px-4 py-3">
          {mode === "save" ? (
            <SaveView
              buildSetup={buildSetup}
              entries={entries}
              libraryUnavailable={libraryUnavailable}
              onSaved={(entry) => {
                if (entry) upsert(entry);
                onClose();
              }}
              notify={notify}
            />
          ) : (
            <LoadView
              entries={entries}
              libraryUnavailable={libraryUnavailable}
              loadBlockedReason={loadBlockedReason}
              onLoad={(read, source) => {
                if (onLoad(read, source)) onClose();
              }}
              onRenamed={upsert}
              onRemoved={(id) => setEntries((rows) => (rows ?? []).filter((row) => row.id !== id))}
              notify={notify}
            />
          )}
        </div>
      </div>
    </div>
  );
};

const SaveView = ({
  buildSetup,
  entries,
  libraryUnavailable,
  onSaved,
  notify,
}: {
  buildSetup: (name: string) => PlotSetupFile;
  entries: SavedPlotSetup[] | null;
  libraryUnavailable: string | null;
  onSaved: (entry?: SavedPlotSetup) => void;
  notify: PlotSetupDialogProps["notify"];
}) => {
  const [plots] = useState(() => buildSetup("").plots);
  const [name, setName] = useState(() => suggestedName(plots));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmed = name.trim();
  const existing = entries?.find((entry) => entry.name === trimmed) ?? null;
  const [replacing, setReplacing] = useState(false);

  const saveToLibrary = async () => {
    setBusy(true);
    setError(null);
    try {
      const setup = buildSetup(trimmed);
      const entry = existing
        ? await updatePlotSetup(existing.id, { setup })
        : await createPlotSetup(trimmed, setup);
      notify(`Saved “${entry.name}” to the library.`, "success");
      onSaved(entry);
    } catch (failure) {
      setError(libraryErrorMessage(failure, "The plot setup could not be saved."));
    } finally {
      setBusy(false);
    }
  };

  const saveFile = async () => {
    setBusy(true);
    setError(null);
    try {
      const savedTo = await saveToFile(buildSetup(trimmed), trimmed);
      // An empty path indicates a cancelled save dialog.
      if (savedTo === "") return;
      if (savedTo) notify(`Plot setup saved to ${savedTo}`, "success");
      onSaved();
    } catch (failure) {
      setError(`The plot setup could not be saved: ${failure}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <p className="text-xs text-gray-600">
        Saves what the {plural(plots.length, "plot")} in the Viewer show and how, but not their
        measurements, so the setup can be loaded for others with the same variables.
      </p>
      <ul className="space-y-0.5 pl-4 text-xs text-gray-500" aria-label="Plots in the setup">
        {plots.map((plot, index) => (
          <li key={index} className="list-disc">
            {plot.plotType}: {describePlot(plot)}
          </li>
        ))}
      </ul>
      <label className="block space-y-1">
        <span className="text-xs font-medium text-gray-700">Name</span>
        <input
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            setReplacing(false);
            setError(null);
          }}
          autoFocus
          aria-label="Plot setup name"
          className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500"
        />
        <span className="block text-[0.6875rem] text-gray-500">
          The file is called {plotSetupFileName(trimmed)}
        </span>
      </label>

      {replacing && existing ? (
        <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-2.5 text-xs">
          <p className="text-sm">
            Replace the plots saved in <strong>{existing.name}</strong> with these?
          </p>
          <div className="flex justify-end gap-1.5">
            <button type="button" onClick={() => setReplacing(false)} className={secondaryClass}>
              Cancel
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void saveToLibrary()}
              className={primaryClass}
            >
              Replace
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          <Tooltip
            content={libraryUnavailable ?? "Keep it in Qimchi's library on this computer"}
            position="top"
          >
            <button
              type="button"
              disabled={busy || !trimmed || Boolean(libraryUnavailable) || entries === null}
              onClick={() => (existing ? setReplacing(true) : void saveToLibrary())}
              className={`${primaryClass} disabled:pointer-events-none`}
            >
              <Database size={13} />
              Save to library
            </button>
          </Tooltip>
          <button
            type="button"
            disabled={busy || !trimmed}
            onClick={() => void saveFile()}
            className={secondaryClass}
          >
            <Download size={13} />
            Save to file
          </button>
        </div>
      )}
      {existing && !replacing && (
        <p className="text-xs text-amber-700">
          The library already has a setup called “{existing.name}”. Saving to the library replaces
          it.
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-red-700">
          {error}
        </p>
      )}
    </>
  );
};

type RowMode = { id: number; kind: "renaming" | "removing" } | null;

const LoadView = ({
  entries,
  libraryUnavailable,
  loadBlockedReason,
  onLoad,
  onRenamed,
  onRemoved,
  notify,
}: {
  entries: SavedPlotSetup[] | null;
  libraryUnavailable: string | null;
  loadBlockedReason: string | null;
  onLoad: (read: ReadPlotSetupResult, source: string) => void;
  onRenamed: (entry: SavedPlotSetup) => void;
  onRemoved: (id: number) => void;
  notify: PlotSetupDialogProps["notify"];
}) => {
  const fileRef = useRef<HTMLInputElement>(null);
  const [rowMode, setRowMode] = useState<RowMode>(null);
  const [rowError, setRowError] = useState<{ id: number; message: string } | null>(null);

  return (
    <>
      <p className={`text-xs ${loadBlockedReason ? "text-amber-700" : "text-gray-600"}`}>
        {loadBlockedReason ??
          "The plots are drawn for the measurements selected in the Basket, next to the plots already in the Viewer."}
      </p>
      <button
        type="button"
        disabled={Boolean(loadBlockedReason)}
        onClick={() => fileRef.current?.click()}
        className={secondaryClass}
      >
        <FolderOpen size={13} />
        Load from file…
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        aria-label="Plot setup file to load"
        onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) onLoad(readPlotSetup(await file.text()), file.name);
        }}
      />

      <section aria-label="Library" className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Library</h3>
        {libraryUnavailable ? (
          <p className="text-xs text-gray-500">{libraryUnavailable}</p>
        ) : entries === null ? (
          <p className="text-xs text-gray-500">Loading saved setups…</p>
        ) : entries.length === 0 ? (
          <p className="text-xs text-gray-500">
            No plot setups in the library yet. Save one with Plot setup, then Save.
          </p>
        ) : (
          <ul className="space-y-2">
            {entries.map((entry) => {
              const read = readPlotSetupValue(entry.setup);
              const mode = rowMode?.id === entry.id ? rowMode.kind : null;
              const failure = rowError?.id === entry.id ? rowError.message : null;
              const clearRow = () => {
                setRowMode(null);
                setRowError(null);
              };

              if (mode === "renaming") {
                return (
                  <li key={entry.id} className="rounded-lg border border-blue-300 p-2">
                    <NameForm
                      initial={entry.name}
                      label={`Rename plot setup ${entry.name}`}
                      submitLabel="Rename"
                      onSubmit={async (name) => {
                        try {
                          onRenamed(await updatePlotSetup(entry.id, { name }));
                          clearRow();
                          return null;
                        } catch (error) {
                          return libraryErrorMessage(error, "The plot setup could not be renamed.");
                        }
                      }}
                      onCancel={clearRow}
                    />
                  </li>
                );
              }

              return (
                <li key={entry.id} className="space-y-1.5 rounded-lg border border-gray-200 p-2.5">
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className="min-w-0 truncate text-sm font-semibold text-gray-800"
                      title={entry.name}
                    >
                      {entry.name}
                    </span>
                    <span className="ml-auto flex shrink-0 items-center">
                      <Tooltip content="Save to file" position="left">
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              const savedTo = await saveToFile(
                                entry.setup as PlotSetupFile,
                                entry.name,
                              );
                              if (savedTo) notify(`Plot setup saved to ${savedTo}`, "success");
                            } catch (error) {
                              notify(`The plot setup could not be saved: ${error}`, "error");
                            }
                          }}
                          className={iconClass}
                          aria-label={`Save plot setup ${entry.name} to a file`}
                        >
                          <Download size={14} />
                        </button>
                      </Tooltip>
                      <Tooltip content="Rename" position="left">
                        <button
                          type="button"
                          onClick={() => setRowMode({ id: entry.id, kind: "renaming" })}
                          className={iconClass}
                          aria-label={`Rename plot setup ${entry.name}`}
                        >
                          <Pencil size={14} />
                        </button>
                      </Tooltip>
                      <Tooltip content="Remove" position="left">
                        <button
                          type="button"
                          onClick={() => setRowMode({ id: entry.id, kind: "removing" })}
                          className={iconClass}
                          aria-label={`Remove plot setup ${entry.name}`}
                        >
                          <Trash2 size={14} />
                        </button>
                      </Tooltip>
                    </span>
                  </div>
                  <p className="text-xs text-gray-500">
                    {read.ok
                      ? `${plural(read.plots.length, "plot")}: ${summary(read.plots)}`
                      : read.error}
                  </p>
                  {mode === "removing" ? (
                    <div className="space-y-2 rounded-md border border-red-200 bg-red-50 p-2.5 text-sm text-red-900">
                      <p>
                        Remove <strong>{entry.name}</strong> from the library? Plots already in the
                        Viewer stay.
                      </p>
                      <div className="flex justify-end gap-1.5">
                        <button type="button" onClick={clearRow} className={secondaryClass}>
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              await deletePlotSetup(entry.id);
                              onRemoved(entry.id);
                              clearRow();
                            } catch (error) {
                              setRowError({
                                id: entry.id,
                                message: libraryErrorMessage(
                                  error,
                                  "The plot setup could not be removed.",
                                ),
                              });
                            }
                          }}
                          className={dangerClass}
                        >
                          <Trash2 size={13} />
                          Remove
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex justify-end">
                      <button
                        type="button"
                        disabled={Boolean(loadBlockedReason) || !read.ok}
                        onClick={() => onLoad(read, entry.name)}
                        className={primaryClass}
                        aria-label={`Load plot setup ${entry.name}`}
                      >
                        <Play size={12} />
                        Load
                      </button>
                    </div>
                  )}
                  {failure && (
                    <p role="alert" className="text-xs text-red-700">
                      {failure}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
};

export default PlotSetupDialog;

import { useState } from "react";
import { FileArchive, FolderOpen, Loader2, TriangleAlert } from "lucide-react";

import { saveLogBundle } from "../services/diagnosticsAPI";

/** Settings > Developer: zip Qimchi's logs (and optionally crash reports) for a bug report. */
const LogBundlePanel = () => {
  const [includeCrashReports, setIncludeCrashReports] = useState(true);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<{ path: string | null; crashReports: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canReveal = Boolean(window.pywebview?.api.reveal_file);

  const save = async () => {
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      setSaved(await saveLogBundle(includeCrashReports));
    } catch {
      setError("The logs could not be saved. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 rounded-md border border-gray-200 bg-gray-50 p-4">
      <p className="text-xs leading-relaxed text-gray-600">
        Creates one zip file to attach to a bug report. It includes:
      </p>
      <ul className="list-disc space-y-1 pl-5 text-xs leading-relaxed text-gray-600">
        <li>Qimchi logs</li>
        <li>A summary of this computer</li>
      </ul>
      <label className="flex items-start gap-2 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700">
        <input
          type="checkbox"
          checked={includeCrashReports}
          onChange={(event) => setIncludeCrashReports(event.target.checked)}
          className="mt-0.5"
        />
        <span>
          Include recent crash reports
          <span className="mt-0.5 block text-xs text-gray-500">
            Last two weeks · WebView on Windows · WebKit and Qimchi on macOS
          </span>
        </span>
      </label>
      <div className="flex gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
        <TriangleAlert size={15} className="mt-0.5 shrink-0" />
        <span>
          The bundle may contain measurement file and folder names. Crash reports can be large and,
          on macOS, may include Safari reports.
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy}
          title="Save logs for a bug report"
          className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <FileArchive size={14} />}
          {busy ? "Saving…" : "Save logs"}
        </button>
        {saved?.path && canReveal && (
          <button
            type="button"
            onClick={() => void window.pywebview?.api.reveal_file?.(saved.path!)}
            className="qimchi-dark-hover-plain inline-flex items-center gap-1.5 rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100"
          >
            <FolderOpen size={15} />
            Show in folder
          </button>
        )}
      </div>
      <div aria-live="polite" className="text-xs">
        {saved?.path && (
          <p className="break-all text-gray-600">
            Saved to <span className="font-mono">{saved.path}</span>
            {includeCrashReports &&
              ` (${saved.crashReports} crash report${saved.crashReports === 1 ? "" : "s"})`}
          </p>
        )}
        {saved && !saved.path && <p className="text-gray-600">Downloaded the logs.</p>}
        {error && (
          <p role="alert" className="text-red-700">
            {error}
          </p>
        )}
      </div>
    </div>
  );
};

export default LogBundlePanel;

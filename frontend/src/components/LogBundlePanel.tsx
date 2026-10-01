import { useState } from "react";
import { FileArchive, FolderOpen, Loader2, TriangleAlert } from "lucide-react";

import { saveLogBundle } from "../services/diagnosticsAPI";

interface LogBundlePanelProps {
  onSaveStatusChange?: (saved: boolean) => void;
}

/** Creates a diagnostic bundle for a bug report. */
const LogBundlePanel = ({ onSaveStatusChange }: LogBundlePanelProps) => {
  const [includeCrashReports, setIncludeCrashReports] = useState(true);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<{ path: string | null; crashReports: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canReveal = Boolean(window.pywebview?.api.reveal_file);

  const save = async () => {
    setBusy(true);
    setError(null);
    setSaved(null);
    onSaveStatusChange?.(false);
    try {
      const result = await saveLogBundle(includeCrashReports);
      setSaved(result);
      onSaveStatusChange?.(true);
    } catch {
      setError("The logs could not be saved. Please try again.");
      onSaveStatusChange?.(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 rounded-md border border-gray-200 bg-gray-50 p-3 text-xs dark:border-[#3e4451] dark:bg-[#21252b]">
      <p className="leading-relaxed text-gray-600 dark:text-[#c7cbd1]">
        Creates one zip file to attach to a bug report. It includes:
      </p>
      <ul className="list-disc space-y-1 pl-5 leading-relaxed text-gray-600 dark:text-[#c7cbd1]">
        <li>Qimchi logs</li>
        <li>A summary of this computer</li>
      </ul>
      <label className="flex items-start gap-2 rounded-md border border-gray-200 bg-white px-3 py-2 text-gray-700 dark:border-[#3e4451] dark:bg-[#282c34] dark:text-[#d7dae0]">
        <input
          type="checkbox"
          checked={includeCrashReports}
          onChange={(event) => setIncludeCrashReports(event.target.checked)}
          className="mt-0.5 accent-blue-600"
        />
        <span>
          Include recent crash reports
          <span className="mt-0.5 block text-gray-500 dark:text-[#9aa1ad]">
            Last two weeks · WebView on Windows · WebKit and Qimchi on macOS
          </span>
        </span>
      </label>
      <div className="flex gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 leading-relaxed text-amber-900 dark:border-[#806221] dark:bg-[#332b19] dark:text-[#e5c07b]">
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
          className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <FileArchive size={14} />}
          {busy ? "Saving…" : "Save logs"}
        </button>
        {saved?.path && canReveal && (
          <button
            type="button"
            onClick={() => void window.pywebview?.api.reveal_file?.(saved.path!)}
            className="qimchi-dark-hover-plain inline-flex items-center gap-1.5 rounded-md border border-gray-300 px-2.5 py-1.5 text-gray-700 hover:bg-gray-100 dark:border-[#4b5263] dark:text-[#d7dae0] dark:hover:bg-[#353b45]"
          >
            <FolderOpen size={15} />
            Show in folder
          </button>
        )}
      </div>
      <div aria-live="polite">
        {saved?.path && (
          <p className="text-gray-600 dark:text-[#c7cbd1]">
            Saved to <span className="break-all font-mono">{saved.path}</span>
            {includeCrashReports && (
              <span className="ml-1 whitespace-nowrap">
                ({saved.crashReports} crash report{saved.crashReports === 1 ? "" : "s"})
              </span>
            )}
          </p>
        )}
        {saved && !saved.path && (
          <p className="text-gray-600 dark:text-[#c7cbd1]">Downloaded the logs.</p>
        )}
        {error && (
          <p role="alert" className="text-red-700 dark:text-[#e06c75]">
            {error}
          </p>
        )}
      </div>
    </div>
  );
};

export default LogBundlePanel;

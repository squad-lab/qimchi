// Client helpers for asynchronous image-export tasks.
import axios from "axios";

import { PROD_BACKEND_URL } from "../config";
import type { AppliedFilter, AttrData } from "../components/interfaces";

/** Plot state required to reproduce the current view during export. */
export interface PlotExportPayload {
  plot_json: unknown;
  fpath: string;
  relayout_data: Record<string, unknown> | null;
  applied_filters: AppliedFilter[];
  measurement_info?: AttrData;
  title?: string;
}

export interface ExportOutcome {
  filename: string;
  /** Desktop app only: where the backend saved the zip. */
  savedTo?: string;
  /** Batch exports only. */
  exported?: number;
  failures?: string[];
}

const POLL_MS = 500;

const runExportTask = async (
  startPath: string,
  body: unknown,
  timeoutMs: number,
): Promise<ExportOutcome> => {
  const start = await axios.post(`${PROD_BACKEND_URL}${startPath}`, body, {
    headers: { "Content-Type": "application/json" },
  });
  if (start.status !== 202 || !start.data.task_id) {
    throw new Error(start.data.message || "Failed to start export");
  }
  const taskId: string = start.data.task_id;

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    const { data } = await axios.get(`${PROD_BACKEND_URL}/export-plot-images/status/${taskId}`);
    if (data.status === "failed") throw new Error(data.error || "Export failed");
    if (data.status !== "completed") continue;

    const outcome: ExportOutcome = {
      filename: data.zip_filename || "plot_images.zip",
      savedTo: data.saved_to,
      exported: data.exported,
      failures: data.failures,
    };
    // Desktop exports are written by the backend because WebView2 discards downloads.
    if (outcome.savedTo) return outcome;

    const download = await axios.get(`${PROD_BACKEND_URL}${data.download_url}`, {
      responseType: "blob",
    });
    const url = URL.createObjectURL(new Blob([download.data], { type: "application/zip" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = outcome.filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    return outcome;
  }
  throw new Error(`Export timed out after ${Math.round(timeoutMs / 1000)} seconds`);
};

export const exportPlotImages = (payload: PlotExportPayload) =>
  runExportTask("/export-plot-images", payload, 60_000);

/** Export each plot to a nested archive inside one batch archive. */
export const exportManyPlotImages = (plots: PlotExportPayload[]) =>
  runExportTask("/export-plot-images/batch", { plots }, 60_000 + plots.length * 30_000);

// Registered providers let Viewer collect current state for a batch export.
const providers = new Map<string, () => PlotExportPayload | null>();

export const registerPlotExport = (id: string, provider: () => PlotExportPayload | null) => {
  providers.set(id, provider);
  return () => {
    if (providers.get(id) === provider) providers.delete(id);
  };
};

export const collectPlotExports = (ids: string[]): PlotExportPayload[] =>
  ids.flatMap((id) => {
    const payload = providers.get(id)?.();
    return payload ? [payload] : [];
  });

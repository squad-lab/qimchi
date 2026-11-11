import type { AxiosResponse } from "axios";

const SAVED_TO_HEADER = "x-qimchi-saved-to";
const QCODES_RUNS_HEADER = "x-qimchi-qcodes-runs";

export interface DownloadResult {
  savedTo?: string;
  /** QCoDeS runs the archive holds as NetCDF files. */
  qcodesRuns?: number;
}

const qcodesRunsIn = (response: AxiosResponse<BlobPart>): number | undefined => {
  const count = Number(response.headers?.[QCODES_RUNS_HEADER]);
  return count > 0 ? count : undefined;
};

/** Describe a completed download, using `fallback` when no details are available. */
export function downloadMessage(result: DownloadResult, fallback: string): string;
export function downloadMessage(result: DownloadResult): string | undefined;
export function downloadMessage(result: DownloadResult, fallback?: string): string | undefined {
  const base = result.savedTo ? `Saved to ${result.savedTo}` : fallback;
  if (!result.qcodesRuns) return base;
  const note =
    result.qcodesRuns === 1
      ? "The QCoDeS run is saved as a NetCDF file."
      : "QCoDeS runs are saved as NetCDF files, one per run.";
  return base ? `${base}. ${note}` : note;
}

/** Finish a backend archive download in browser or pywebview desktop mode. */
export const finishArchiveDownload = (
  response: AxiosResponse<BlobPart>,
  fallbackFilename: string,
): DownloadResult => {
  const qcodesRuns = qcodesRunsIn(response);
  const encodedSavedTo = response.headers?.[SAVED_TO_HEADER] as string | undefined;
  if (encodedSavedTo) {
    return { savedTo: decodeURIComponent(encodedSavedTo), qcodesRuns };
  }

  const url = window.URL.createObjectURL(new Blob([response.data], { type: "application/zip" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fallbackFilename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
  return { qcodesRuns };
};

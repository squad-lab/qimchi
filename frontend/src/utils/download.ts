import type { AxiosResponse } from "axios";

const SAVED_TO_HEADER = "x-qimchi-saved-to";

export interface DownloadResult {
  savedTo?: string;
}

/** Finish a backend archive download in browser or pywebview desktop mode. */
export const finishArchiveDownload = (
  response: AxiosResponse<BlobPart>,
  fallbackFilename: string,
): DownloadResult => {
  const encodedSavedTo = response.headers?.[SAVED_TO_HEADER] as string | undefined;
  if (encodedSavedTo) {
    return { savedTo: decodeURIComponent(encodedSavedTo) };
  }

  const url = window.URL.createObjectURL(new Blob([response.data], { type: "application/zip" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fallbackFilename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
  return {};
};

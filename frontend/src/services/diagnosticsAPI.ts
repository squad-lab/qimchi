import axios from "axios";

import { PROD_BACKEND_URL } from "../config";

export interface ClientLogEntry {
  level: "error" | "warning" | "info";
  message?: string;
  stack?: string;
  source?: string;
  heap_used?: number;
  heap_total?: number;
}

/** Send a page error (or a heap heartbeat) to the app log. Never throws. */
export async function sendClientLog(entry: ClientLogEntry): Promise<void> {
  try {
    await axios.post(`${PROD_BACKEND_URL}/diagnostics/client-log`, entry, { timeout: 5000 });
  } catch {
    // Reporting must never cause errors of its own.
  }
}

/** Where a desktop bundle was saved, or null when the browser downloaded it. */
export interface LogBundleResult {
  path: string | null;
  crashReports: number;
}

/**
 * Zip the logs for a bug report. The desktop app saves the zip itself (its
 * WebView cannot download) and reports where; a browser downloads it.
 */
export async function saveLogBundle(includeCrashReports: boolean): Promise<LogBundleResult> {
  const response = await axios.post<Blob>(
    `${PROD_BACKEND_URL}/diagnostics/bundle`,
    { include_crash_reports: includeCrashReports },
    { responseType: "blob", timeout: 120_000 },
  );
  const type = String(response.headers["content-type"] ?? "");
  if (type.includes("application/json")) {
    const saved = JSON.parse(await response.data.text()) as {
      path: string;
      crash_reports?: string[];
    };
    return { path: saved.path, crashReports: saved.crash_reports?.length ?? 0 };
  }

  const disposition = String(response.headers["content-disposition"] ?? "");
  const name = /filename="?([^";]+)"?/.exec(disposition)?.[1] ?? "qimchi-logs.zip";
  const url = URL.createObjectURL(response.data);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
  return { path: null, crashReports: 0 };
}

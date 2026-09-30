// API service for the user's settings (backend/api/settings.py). The backend
// stores only values that differ from the defaults; a null in a patch removes
// a value. Endpoints return 503 with the reason when the database is down.
import axios from "axios";

import { PROD_BACKEND_URL } from "../config";

export interface StoredSettings {
  settings: Record<string, unknown>;
  updatedAt: string | null;
}

// Anything else (an HTML page from a proxy, say) must not be taken for "no
// settings", or every saved preference would silently reset.
const checked = (data: unknown): StoredSettings => {
  const settings = (data as { settings?: unknown } | null)?.settings;
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    throw new Error("The server's settings response was not understood");
  }
  return data as StoredSettings;
};

export async function getSettings(): Promise<StoredSettings> {
  const { data } = await axios.get<StoredSettings>(`${PROD_BACKEND_URL}/settings`);
  return checked(data);
}

export async function patchSettings(patch: Record<string, unknown>): Promise<StoredSettings> {
  const { data } = await axios.patch<StoredSettings>(`${PROD_BACKEND_URL}/settings`, {
    settings: patch,
  });
  return checked(data);
}

/** Replace the whole document, e.g. with an imported settings file. */
export async function replaceSettings(document: Record<string, unknown>): Promise<StoredSettings> {
  const { data } = await axios.put<StoredSettings>(`${PROD_BACKEND_URL}/settings`, {
    settings: document,
  });
  return checked(data);
}

export async function resetSettings(): Promise<StoredSettings> {
  const { data } = await axios.delete<StoredSettings>(`${PROD_BACKEND_URL}/settings`);
  return checked(data);
}

/** The backend's reason for a failed request, when it gave one. */
export const settingsErrorMessage = (error: unknown): string => {
  const response = (error as { response?: { status?: number; data?: { detail?: unknown } } })
    ?.response;
  const detail = response?.data?.detail;
  if (typeof detail === "string" && detail) return detail;
  if (response?.status) return `The server answered ${response.status}`;
  if (error instanceof Error && error.message) return error.message;
  return "The server could not be reached";
};

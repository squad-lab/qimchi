// API service for the Qimchi library (per-measurement heart/trash/tag state).
// Backed by the /library/* endpoints (see backend/api/library.py).
import axios from "axios";

import { PROD_BACKEND_URL } from "../config";

const API_BASE_URL = PROD_BACKEND_URL;

export interface LibraryState {
  uuid: string | null;
  hearted: boolean;
  trashed: boolean;
  unhearted_paths?: string[];
}

export interface MeasurementStateOut {
  uuid: string;
  abs_path: string | null;
  hearted: boolean;
  trashed: boolean;
  tags: number[];
}

export interface Tag {
  id: number;
  name: string;
  /** Measurements currently carrying the tag; drives the delete confirmation. */
  count?: number;
}

export interface DbStatus {
  dbReady: boolean;
  dbError: string | null;
}

/**
 * Ask the backend whether the library database came up. Plotting works either
 * way; this decides whether the heart/tag/notes affordances are usable.
 */
export async function getDbStatus(): Promise<DbStatus> {
  const { data } = await axios.get<{ dbReady?: boolean; dbError?: string | null }>(
    `${API_BASE_URL}/health`,
  );
  return { dbReady: data.dbReady !== false, dbError: data.dbError ?? null };
}

/** Register an opened measurement using its already-fetched attrs. */
export async function registerMeasurement(
  path: string,
  attrs?: Record<string, unknown>,
  folder = false,
): Promise<LibraryState> {
  const { data } = await axios.post<LibraryState>(`${API_BASE_URL}/library/register`, {
    path,
    attrs,
    ...(folder ? { folder } : {}),
  });
  return data;
}

export async function setHeart(uuid: string, hearted: boolean): Promise<LibraryState> {
  const { data } = await axios.post<LibraryState>(`${API_BASE_URL}/library/heart`, {
    uuid,
    hearted,
  });
  return data;
}

export async function setTrash(uuid: string, trashed: boolean): Promise<LibraryState> {
  const { data } = await axios.post<LibraryState>(`${API_BASE_URL}/library/trash`, {
    uuid,
    trashed,
  });
  return data;
}

/** All hearted/trashed/tagged measurements for the current user (DirTree filters). */
export async function getLibraryStates(): Promise<MeasurementStateOut[]> {
  const { data } = await axios.get<MeasurementStateOut[]>(`${API_BASE_URL}/library/states`);
  return data;
}

export async function getTags(): Promise<Tag[]> {
  const { data } = await axios.get<Tag[]>(`${API_BASE_URL}/library/tags`);
  return data;
}

export async function createTag(name: string): Promise<Tag> {
  const { data } = await axios.post<Tag>(`${API_BASE_URL}/library/tags`, {
    name,
  });
  return data;
}

/** Rename a tag in place; every measurement carrying it keeps it. */
export async function renameTag(id: number, name: string): Promise<Tag> {
  const { data } = await axios.patch<Tag>(`${API_BASE_URL}/library/tags/${id}`, {
    name,
  });
  return data;
}

export async function deleteTag(id: number): Promise<void> {
  await axios.delete(`${API_BASE_URL}/library/tags/${id}`);
}

/** Add/remove a tag on a measurement; returns the measurement's tag ids. */
export async function tagMeasurement(uuid: string, tagId: number, add: boolean): Promise<number[]> {
  const { data } = await axios.post<number[]>(`${API_BASE_URL}/library/tag`, {
    uuid,
    tag_id: tagId,
    add,
  });
  return data;
}

export interface PresetFilter {
  name: string;
  options?: unknown;
}

export interface FilterPreset {
  id: number;
  name: string;
  filters: PresetFilter[];
  updatedAt: string;
}

export async function getFilterPresets(): Promise<FilterPreset[]> {
  const { data } = await axios.get<FilterPreset[]>(`${API_BASE_URL}/library/filter-presets`);
  return data;
}

/** Create a preset. Duplicate names return HTTP 409. */
export async function createFilterPreset(
  name: string,
  filters: PresetFilter[],
): Promise<FilterPreset> {
  const { data } = await axios.post<FilterPreset>(`${API_BASE_URL}/library/filter-presets`, {
    name,
    filters,
  });
  return data;
}

/** Rename a preset, replace its filters, or both. */
export async function updateFilterPreset(
  id: number,
  changes: { name?: string; filters?: PresetFilter[] },
): Promise<FilterPreset> {
  const { data } = await axios.patch<FilterPreset>(
    `${API_BASE_URL}/library/filter-presets/${id}`,
    changes,
  );
  return data;
}

export async function deleteFilterPreset(id: number): Promise<void> {
  await axios.delete(`${API_BASE_URL}/library/filter-presets/${id}`);
}

/** Return the server error detail or a fallback message. */
export function libraryErrorMessage(error: unknown, fallback: string): string {
  const detail = (error as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  return typeof detail === "string" ? detail : fallback;
}

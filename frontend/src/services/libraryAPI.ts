// API service for the Qimchi library (per-measurement heart/trash/tag state).
// Backed by the /library/* endpoints (see backend/api/library.py). Keyed on a
// measurement UUID resolved by the backend (qcutils "Measurement ID", QCoDeS
// run guid, or a content signature); only datasets it cannot identify return a
// null uuid. Endpoints return 503 when the library DB failed to start.
import axios from "axios";

import { PROD_BACKEND_URL } from "../config";

const API_BASE_URL = PROD_BACKEND_URL;

export interface LibraryState {
  uuid: string | null;
  hearted: boolean;
  trashed: boolean;
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

/**
 * Register (or refresh) a measurement when it is opened, returning its
 * heart/trash state. `attrs` is the object already fetched from /load-attrs/,
 * passed through so the backend doesn't re-load the dataset.
 */
export async function registerMeasurement(
  path: string,
  attrs?: Record<string, unknown>,
): Promise<LibraryState> {
  const { data } = await axios.post<LibraryState>(
    `${API_BASE_URL}/library/register`,
    { path, attrs },
  );
  return data;
}

export async function setHeart(
  uuid: string,
  hearted: boolean,
): Promise<LibraryState> {
  const { data } = await axios.post<LibraryState>(
    `${API_BASE_URL}/library/heart`,
    { uuid, hearted },
  );
  return data;
}

export async function setTrash(
  uuid: string,
  trashed: boolean,
): Promise<LibraryState> {
  const { data } = await axios.post<LibraryState>(
    `${API_BASE_URL}/library/trash`,
    { uuid, trashed },
  );
  return data;
}

/** All hearted/trashed/tagged measurements for the current user (DirTree filters). */
export async function getLibraryStates(): Promise<MeasurementStateOut[]> {
  const { data } = await axios.get<MeasurementStateOut[]>(
    `${API_BASE_URL}/library/states`,
  );
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

export async function deleteTag(id: number): Promise<void> {
  await axios.delete(`${API_BASE_URL}/library/tags/${id}`);
}

/** Add/remove a tag on a measurement; returns the measurement's tag ids. */
export async function tagMeasurement(
  uuid: string,
  tagId: number,
  add: boolean,
): Promise<number[]> {
  const { data } = await axios.post<number[]>(`${API_BASE_URL}/library/tag`, {
    uuid,
    tag_id: tagId,
    add,
  });
  return data;
}

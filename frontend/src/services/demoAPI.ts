// Client for walkthrough demo endpoints in backend/api/demo.py.
import axios from "axios";

import { PROD_BACKEND_URL } from "../config";

export interface DemoFiles {
  folder: string;
  logo: string;
  reveal: string;
}

export interface LiveDemo {
  measurementId: string;
  path: string;
  nodeId: string;
  name: string;
}

export async function prepareDemo(): Promise<DemoFiles> {
  const { data } = await axios.post<DemoFiles>(`${PROD_BACKEND_URL}/demo/prepare`);
  return data;
}

export async function startLiveDemo(): Promise<LiveDemo> {
  const { data } = await axios.post<LiveDemo>(`${PROD_BACKEND_URL}/demo/live/start`);
  return data;
}

export async function stopLiveDemo(): Promise<void> {
  await axios.post(`${PROD_BACKEND_URL}/demo/live/stop`);
}

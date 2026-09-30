import axios from "axios";

import { PROD_BACKEND_URL } from "../config";

export interface PinnedParameter {
  name: string;
  label?: string;
  /** Value with an SI prefix, such as "12.35 mV". */
  display?: string;
  /** Parameter not found in the measurement. */
  missing?: boolean;
}

/** Fetch named qanary Parameters Snapshot entries. */
export const fetchPinnedParameters = async (
  path: string,
  names: string[],
): Promise<PinnedParameter[]> => {
  const response = await axios.post<{ parameters: PinnedParameter[] }>(
    `${PROD_BACKEND_URL}/load-meta/parameters/`,
    { path, names },
  );
  return response.data.parameters;
};

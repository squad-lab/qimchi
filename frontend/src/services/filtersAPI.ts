import axios from "axios";

// Local imports
import { PROD_BACKEND_URL } from "../config";
import type { FilterRequest, FilterResponse } from "../components/interfaces";

const API_BASE_URL = PROD_BACKEND_URL;

export const applyFilters = async (
  request: FilterRequest
): Promise<FilterResponse> => {
  try {
    console.log("[FiltersAPI] Starting applyFilters request");
    const response = await axios.post<FilterResponse>(
      `${API_BASE_URL}/apply-filters`,
      request,
      {
        headers: {
          "Content-Type": "application/json",
        },
        timeout: 10000, // 10 second timeout
      }
    );

    console.log("[FiltersAPI] applyFilters request completed successfully");
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      if (error.code === "ECONNABORTED") {
        console.error(
          "[FiltersAPI] applyFilters request timed out after 10 seconds"
        );
        throw new Error("Request timed out after 10 seconds");
      }
      if (error.response) {
        throw new Error(
          `HTTP error! status: ${error.response.status}, message: ${
            error.response.data?.detail || "Unknown error"
          }`
        );
      }
    }
    console.error("[FiltersAPI] Error applying filters:", error);
    throw error;
  }
};

// API service for plot-related requests
import axios from "axios";
import { Data, Layout, Config } from "plotly.js";

// Local imports
import { PROD_BACKEND_URL } from "../config";
import type { SliderConfig } from "../components/interfaces";

const API_BASE_URL = PROD_BACKEND_URL;

export interface PlotRequest {
  fpaths: string[];
  indeps: string[];
  deps: string[];
  plotType: "LinePlot" | "HeatMap";
  filters_order?: string[];
  filters_opts?: Record<string, unknown>;
  slider?: Record<string, SliderConfig>;
  source?: "memory" | "disk"; // Source of the data (memory for live, disk for ended measurements)
  signal?: AbortSignal; // For request cancellation
}

// SliderConfig imported from centralized interfaces

export interface PlotData {
  id: string;
  plot_ref?: string;
  clientId?: string; // Client-side unique identifier as backup
  resolved_fpath?: string; // Canonical dataset path used by backend (disk path when live has ended)
  plotJson: {
    data: Data[];
    layout: Partial<Layout>;
    config?: Partial<Config>;
  };
  title?: string;
  type: "LinePlot" | "HeatMap";
  slider_config?: Record<string, SliderConfig>; // Slider configs from backend
  is_live?: boolean; // True if loaded from memory via WebSocket, false if from disk
}

export interface PlotResponse {
  plots: PlotData[];
  success: boolean;
  message: string;
  skip_update?: boolean; // E.g., transient error
}

export interface TransformPlotRequest {
  plot_ref: string;
  filters_order: string[];
  filters_opts: Record<string, unknown>;
  slider?: Record<string, SliderConfig>;
  swap_xy?: boolean;
}

export interface TransformPlotResponse {
  plot_json: {
    data: Data[];
    layout: Partial<Layout>;
    config?: Partial<Config>;
  };
  plot_ref: string;
}

export class PlotAPI {
  static async createPlots(request: PlotRequest): Promise<PlotResponse> {
    try {
      // console.debug("[PlotAPI] createPlots request:", request);
      const { signal, ...requestData } = request; // Extract signal separately
      const resp = await axios.post(`${API_BASE_URL}/plot/`, requestData, {
        headers: { "Content-Type": "application/json" },
        responseType: "json",
        signal: signal,
      });

      return resp.data as PlotResponse;
    } catch (error) {
      // Handle abort errors gracefully
      if (axios.isCancel(error) || (error as any).name === 'AbortError') {
        console.log("[PlotAPI] Request cancelled");
        throw error; // Re-throw to let caller handle
      }
      console.error("Error creating plots:", error);
      return {
        plots: [],
        success: false,
        message:
          error instanceof Error ? error.message : "Unknown error occurred",
      };
    }
  }

  static async transformPlot(
    request: TransformPlotRequest,
  ): Promise<TransformPlotResponse> {
    try {
      const resp = await axios.post(`${API_BASE_URL}/transform-plot`, request, {
        headers: { "Content-Type": "application/json" },
        responseType: "json",
      });

      return resp.data as TransformPlotResponse;
    } catch (error) {
      console.error("Error transforming plot:", error);
      throw error;
    }
  }
}

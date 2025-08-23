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
}

// SliderConfig imported from centralized interfaces

export interface PlotData {
  id: string;
  clientId?: string; // Client-side unique identifier as backup
  plotJson: {
    data: Data[];
    layout: Partial<Layout>;
    config?: Partial<Config>;
  };
  title?: string;
  type: "LinePlot" | "HeatMap";
  slider_config?: Record<string, SliderConfig>; // Slider configs from backend
}

export interface PlotResponse {
  plots: PlotData[];
  success: boolean;
  message: string;
}

export interface SliderRequest {
  filters_order: string[];
  filters_opts: Record<string, unknown>;
  slider: Record<string, SliderConfig>;
  fpath: string;
  indeps: string[];
  deps: string[];
  plotType: string;
}

export interface SliderResponse {
  sliced_plot_json: {
    data: Data[];
    layout: Partial<Layout>;
    config?: Partial<Config>;
  };
}

export class PlotAPI {
  static async createPlots(request: PlotRequest): Promise<PlotResponse> {
    try {
      // console.debug("[PlotAPI] createPlots request:", request);
      const resp = await axios.post(`${API_BASE_URL}/plot/`, request, {
        headers: { "Content-Type": "application/json" },
        responseType: "json",
      });

      return resp.data as PlotResponse;
    } catch (error) {
      console.error("Error creating plots:", error);
      return {
        plots: [],
        success: false,
        message:
          error instanceof Error ? error.message : "Unknown error occurred",
      };
    }
  }

  static async applySliders(request: SliderRequest): Promise<SliderResponse> {
    try {
      console.log("[PlotAPI] Starting applySliders request");
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

      const resp = await axios.post(`${API_BASE_URL}/apply-sliders`, request, {
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        responseType: "json",
      });

      clearTimeout(timeoutId);
      console.log("[PlotAPI] applySliders request completed successfully");
      return resp.data as SliderResponse;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        console.error(
          "[PlotAPI] applySliders request timed out after 10 seconds"
        );
        throw new Error("Request timed out after 10 seconds");
      }
      console.error("Error applying sliders:", error);
      throw error;
    }
  }
}

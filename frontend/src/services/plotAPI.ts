// API service for plot-related requests
import axios from "axios";
import { Data, Layout, Config } from "plotly.js";

// Local imports
import { PROD_BACKEND_URL } from "../config";
import type { LineCut, SliderConfig } from "../components/interfaces";
import { plotContextFor, rememberPlotContext, type PlotContext } from "./plotContexts";

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
  swap_xy?: boolean;
  cut?: LineCut;
}

// SliderConfig imported from centralized interfaces

export interface PlotData {
  id: string;
  plot_ref?: string;
  /** Plot parameters sent with transforms so the server can restore a missing context. */
  plot_context?: PlotContext;
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
  warnings?: string[];
}

export interface PlotResponse {
  plots: PlotData[];
  success: boolean;
  message: string;
  skip_update?: boolean; // E.g., transient error
  invalid?: boolean; // The request is permanently invalid and should not be retried.
}

export interface TransformPlotRequest {
  plot_ref: string;
  filters_order: string[];
  filters_opts: Record<string, unknown>;
  slider?: Record<string, SliderConfig>;
  swap_xy?: boolean;
  context?: PlotContext;
}

export interface TransformPlotResponse {
  plot_json: {
    data: Data[];
    layout: Partial<Layout>;
    config?: Partial<Config>;
  };
  plot_ref: string;
  warnings?: string[];
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

      const data = resp.data as PlotResponse;
      for (const plot of data.plots ?? []) {
        if (plot.plot_ref) rememberPlotContext(plot.plot_ref, plot.plot_context);
      }
      return data;
    } catch (error) {
      // Handle abort errors gracefully
      if (axios.isCancel(error) || (error as any).name === "AbortError") {
        console.log("[PlotAPI] Request cancelled");
        throw error; // Re-throw to let caller handle
      }
      console.error("Error creating plots:", error);
      return {
        plots: [],
        success: false,
        message: error instanceof Error ? error.message : "Unknown error occurred",
      };
    }
  }

  static async transformPlot(request: TransformPlotRequest): Promise<TransformPlotResponse> {
    try {
      const context = request.context ?? plotContextFor(request.plot_ref);
      const body = context ? { ...request, context } : request;
      const resp = await axios.post(`${API_BASE_URL}/transform-plot`, body, {
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

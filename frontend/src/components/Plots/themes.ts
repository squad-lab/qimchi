import { Layout } from "plotly.js";

// Local imports
import type { PlotTheme } from "../interfaces";

export const lightTheme: PlotTheme = {
  name: "light",
  colors: {
    primary: [
      "#10B981", // emerald-500
      "#3B82F6", // blue-500
      "#EF4444", // red-500
      "#F59E0B", // amber-500
      "#8B5CF6", // violet-500
      "#06B6D4", // cyan-500
      "#F97316", // orange-500
      "#84CC16", // lime-500
    ],
    background: "rgba(0,0,0,0)",
    paper: "rgba(0,0,0,0)",
    text: "#374151",
    grid: "#f3f4f6",
    zeroline: "#e5e7eb",
  },
  font: {
    family: '"Inter", "Segoe UI", "Roboto", sans-serif',
    size: 12,
  },
};

export const darkTheme: PlotTheme = {
  name: "dark",
  colors: {
    primary: [
      "#60A5FA", // blue-400
      "#F87171", // red-400
      "#34D399", // emerald-400
      "#FBBF24", // amber-400
      "#A78BFA", // violet-400
      "#22D3EE", // cyan-400
      "#FB923C", // orange-400
      "#A3E635", // lime-400
    ],
    background: "#1F2937",
    paper: "#1F2937",
    text: "#F3F4F6",
    grid: "#374151",
    zeroline: "#4B5563",
  },
  font: {
    family: '"Inter", "Segoe UI", "Roboto", sans-serif',
    size: 12,
  },
};

export const applyThemeToLayout = (
  layout: Partial<Layout>,
  theme: PlotTheme
): Partial<Layout> => {
  return {
    ...layout,
    paper_bgcolor: theme.colors.paper,
    plot_bgcolor: theme.colors.background,
    font: {
      family: theme.font.family,
      size: theme.font.size,
      color: theme.colors.text,
      ...layout.font,
    },
    colorway: theme.colors.primary,
    margin: {
      l: 60,
      r: 20,
      t: 40,
      b: 50,
      ...layout.margin,
    },
    xaxis: {
      ...layout.xaxis,
      gridcolor: theme.colors.grid,
      zerolinecolor: theme.colors.zeroline,
      tickfont: {
        size: theme.font.size - 1,
        color: theme.colors.text,
        family: theme.font.family,
      },
      titlefont: {
        size: theme.font.size,
        color: theme.colors.text,
        family: theme.font.family,
      },
    },
    yaxis: {
      ...layout.yaxis,
      gridcolor: theme.colors.grid,
      zerolinecolor: theme.colors.zeroline,
      tickfont: {
        size: theme.font.size - 1,
        color: theme.colors.text,
        family: theme.font.family,
      },
      titlefont: {
        size: theme.font.size,
        color: theme.colors.text,
        family: theme.font.family,
      },
    },
  };
};

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
    titleText: "#111827",
    grid: "#f3f4f6",
    zeroline: "#e5e7eb",
  },
  font: {
    family: '"Fira Sans", Arial, sans-serif',
    size: 12,
  },
};

export const darkTheme: PlotTheme = {
  name: "dark",
  colors: {
    // Atom One Dark syntax accents, used as the categorical line/marker palette.
    primary: [
      "#61AFEF", // blue
      "#E06C75", // red
      "#98C379", // green
      "#E5C07B", // yellow
      "#C678DD", // purple
      "#56B6C2", // cyan
      "#D19A66", // orange
      "#ABB2BF", // mono (muted foreground, for an 8th series)
    ],
    background: "rgba(0,0,0,0)",
    paper: "rgba(0,0,0,0)",
    text: "#ABB2BF",
    titleText: "#F0F6FC",
    grid: "#3E4451",
    zeroline: "#5C6370",
  },
  font: {
    family: '"Fira Sans", Arial, sans-serif',
    size: 12,
  },
};

export const applyThemeToLayout = (layout: Partial<Layout>, theme: PlotTheme): Partial<Layout> => {
  const titleSize = layout.font?.size ?? 16;
  const tickSize = 14;

  return {
    ...layout,
    paper_bgcolor: theme.colors.paper,
    plot_bgcolor: theme.colors.background,
    font: {
      ...layout.font,
      family: theme.font.family,
      size: layout.font?.size ?? theme.font.size,
      color: theme.colors.text,
    },
    ...(layout.title
      ? {
          title: {
            ...layout.title,
            font: {
              ...layout.title.font,
              family: theme.font.family,
              size: layout.title.font?.size ?? titleSize,
              color: theme.colors.titleText,
            },
          },
        }
      : {}),
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
        size: tickSize,
        color: theme.colors.text,
        family: theme.font.family,
      },
      title: {
        ...(typeof layout.xaxis?.title === "object" ? layout.xaxis.title : {}),
        font: {
          ...(typeof layout.xaxis?.title === "object" ? layout.xaxis.title.font : {}),
          size:
            (typeof layout.xaxis?.title === "object" && layout.xaxis.title.font?.size) ||
            titleSize,
          color: theme.colors.text,
          family: theme.font.family,
        },
      },
    },
    yaxis: {
      ...layout.yaxis,
      gridcolor: theme.colors.grid,
      zerolinecolor: theme.colors.zeroline,
      tickfont: {
        size: tickSize,
        color: theme.colors.text,
        family: theme.font.family,
      },
      title: {
        ...(typeof layout.yaxis?.title === "object" ? layout.yaxis.title : {}),
        font: {
          ...(typeof layout.yaxis?.title === "object" ? layout.yaxis.title.font : {}),
          size:
            (typeof layout.yaxis?.title === "object" && layout.yaxis.title.font?.size) ||
            titleSize,
          color: theme.colors.text,
          family: theme.font.family,
        },
      },
    },
    coloraxis: layout.coloraxis
      ? {
          ...layout.coloraxis,
          colorbar: {
            ...layout.coloraxis.colorbar,
            tickfont: {
              ...layout.coloraxis.colorbar?.tickfont,
              size: tickSize,
              color: theme.colors.text,
              family: theme.font.family,
            },
          },
        }
      : layout.coloraxis,
  };
};

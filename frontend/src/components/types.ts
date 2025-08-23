/**
 * Centralized shared exported types (non-interface)
 **/

export type PlotAppearanceSettings = {
  hmap?: {
    colorscale: string;
    rangecolor?: [number, number] | null;
  };
  line: {
    mode: string;
    color: string;
    width: number;
    opacity: number;
    dash: string;
    shape: string;
    smoothing: number;
  };
  marker: {
    color: string;
    size: number;
    symbol: string;
    opacity: number;
  };
  x: {
    maj: {
      showgrid: boolean;
      type: string;
      nticks: number;
      gridcolor: string;
      griddash: string;
      gridwidth: number;
      tickcolor: string;
      tickwidth: number;
      ticklen: number;
      tickangle: number;
    };
    min: {
      showgrid: boolean;
      nticks: number;
      gridcolor: string;
      griddash: string;
      gridwidth: number;
      tickcolor: string;
      tickwidth: number;
      ticklen: number;
    };
  };
  y: {
    maj: {
      showgrid: boolean;
      type: string;
      nticks: number;
      gridcolor: string;
      griddash: string;
      gridwidth: number;
      tickcolor: string;
      tickwidth: number;
      ticklen: number;
      tickangle: number;
    };
    min: {
      showgrid: boolean;
      nticks: number;
      gridcolor: string;
      griddash: string;
      gridwidth: number;
      tickcolor: string;
      tickwidth: number;
      ticklen: number;
    };
  };
};

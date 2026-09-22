// plotly.js ships no types for its partial-bundle entry points.
declare module "plotly.js/lib/core" {
  const Plotly: typeof import("plotly.js") & {
    register: (modules: unknown[]) => void;
  };
  export default Plotly;
}

declare module "plotly.js/lib/heatmap" {
  const trace: unknown;
  export default trace;
}

declare module "plotly.js/lib/scatter" {
  const trace: unknown;
  export default trace;
}

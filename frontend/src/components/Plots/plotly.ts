// Register only the trace types Qimchi uses.
import PlotlyCore from "plotly.js/lib/core";
import heatmap from "plotly.js/lib/heatmap";
import scatter from "plotly.js/lib/scatter";

PlotlyCore.register([heatmap, scatter]);

const Plotly = PlotlyCore as typeof import("plotly.js");

export default Plotly;

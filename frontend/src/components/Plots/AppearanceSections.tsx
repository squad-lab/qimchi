import React from "react";
import {
  X,
  RotateCcw,
  // Undo,
  // Redo,
  Minus,
  Circle,
  TrendingUp,
  Square,
  Diamond,
  Plus,
  Triangle,
  RedoDot,
  UndoDot,
  ChartLine,
  ChartSpline,
  ChartNoAxesCombined,
  Hourglass,
  Info,
  AlertTriangle,
} from "lucide-react";
import plotlyColorscales from "./plotly_colorscales_plotlyjs.json";

// Local imports
import type { PlotAppearanceSettings } from "../../components/types";
import { IconDropdown, LogChartIcon } from "./UtilComponents";
import DualThumbSlider from "./DualThumbSlider";
import Tooltip from "../Tooltip";
import { engineeringFormatter } from "../../utils/engineeringFormat";

// The controls for each part of a plot's appearance. The per-plot Appearance
// panel shows them as tabs; Settings shows them as the defaults for new plots.

export type UpdateAppearanceSetting = (path: string[], value: unknown) => void;

interface SectionProps {
  settings: PlotAppearanceSettings;
  updateSetting: UpdateAppearanceSetting;
}

// Options based on the Python backend
const LINE_MODE_OPTS = [
  { label: "Lines", value: "lines", icon: Minus },
  { label: "Markers", value: "markers", icon: Circle },
  { label: "Lines + Markers", value: "lines+markers", icon: TrendingUp },
];

const LINE_COLOR_OPTS = [
  "#6acc64",
  "#4878d0",
  "#ee854a",
  "#d65f5f",
  "#956cb4",
  "#8c613c",
  "#dc7ec0",
  "#797979",
  "#d5bb67",
  "#82c6e2",
];

const LINE_DASH_OPTS = [
  { label: "Solid", value: "solid", icon: "━━━━" },
  { label: "Dash", value: "dash", icon: "━ ━" },
  { label: "Dot", value: "dot", icon: "• • •" },
  { label: "Long Dash", value: "longdash", icon: "━━ ━━" },
  { label: "Dash Dot", value: "dashdot", icon: "━ • ━" },
  { label: "Long Dash Dot", value: "longdashdot", icon: "━━ • ━━" },
];

const LINE_SHAPE_OPTS = [
  { label: "Linear", value: "linear", icon: ChartLine },
  { label: "Spline", value: "spline", icon: ChartSpline },
  { label: "Step", value: "hv", icon: ChartNoAxesCombined },
  { label: "Step Before", value: "hvh", icon: UndoDot },
  { label: "Step After", value: "vhv", icon: RedoDot },
];

// Custom Icons/Symbols for markers
const TriangleDown = () => (
  <Triangle
    size={14}
    className="text-gray-500 min-w-[14px]"
    style={{ transform: "rotate(180deg)" }}
  />
);

const TriangleLeft = () => (
  <Triangle
    size={14}
    className="text-gray-500 min-w-[14px]"
    style={{ transform: "rotate(90deg)" }}
  />
);

const TriangleRight = () => (
  <Triangle
    size={14}
    className="text-gray-500 min-w-[14px]"
    style={{ transform: "rotate(-90deg)" }}
  />
);

const DiamondFilled = () => (
  <Diamond
    size={14}
    className="text-gray-500 min-w-[14px] fill-current"
    style={{ transform: "scaleX(0.6)" }}
  />
);

const DiamondTallOpen = () => (
  <Diamond size={14} className="text-gray-500 min-w-[14px]" style={{ transform: "scaleX(0.6)" }} />
);

const DiamondFilledWide = () => (
  <Diamond
    size={14}
    className="text-gray-500 min-w-[14px] fill-current"
    style={{ transform: "scaleY(0.6)" }}
  />
);

const DiamondWideOpen = () => (
  <Diamond size={14} className="text-gray-500 min-w-[14px]" style={{ transform: "scaleY(0.6)" }} />
);

const HourglassFilled = () => (
  <Hourglass size={14} className="text-gray-500 min-w-[14px] fill-current" />
);

const MARKER_SYMBOL_OPTS = [
  { label: "Circle", value: "circle", icon: Circle },
  { label: "Square", value: "square", icon: Square },
  { label: "Cross", value: "cross", icon: Plus },
  { label: "X", value: "x", icon: X },
  { label: "Triangle-Up", value: "triangle-up", icon: Triangle },
  { label: "Triangle-Down", value: "triangle-down", icon: TriangleDown },
  { label: "Triangle-Left", value: "triangle-left", icon: TriangleLeft },
  { label: "Triangle-Right", value: "triangle-right", icon: TriangleRight },
  { label: "Diamond", value: "diamond", icon: Diamond },
  { label: "Diamond-Tall", value: "diamond-tall", icon: DiamondFilled },
  {
    label: "Diamond-Tall-Open",
    value: "diamond-tall-open",
    icon: DiamondTallOpen,
  },
  { label: "Diamond-Wide", value: "diamond-wide", icon: DiamondFilledWide },
  {
    label: "Diamond-Wide-Open",
    value: "diamond-wide-open",
    icon: DiamondWideOpen,
  },
  { label: "Hourglass", value: "hourglass", icon: HourglassFilled },
  { label: "Hourglass-Open", value: "hourglass-open", icon: Hourglass },
];

const AXIS_TYPE_OPTS = [
  { label: "Linear", value: "linear", icon: ChartLine },
  { label: "Log", value: "log", icon: LogChartIcon },
];

const GRID_DASH_OPTS = [
  { label: "Solid", value: "solid", icon: "━━━━" },
  { label: "Dash", value: "dash", icon: "━ ━" },
  { label: "Dot", value: "dot", icon: "• • •" },
  { label: "Long Dash", value: "longdash", icon: "━━ ━━" },
  { label: "Dash Dot", value: "dashdot", icon: "━ • ━" },
  { label: "Long Dash Dot", value: "longdashdot", icon: "━━ • ━━" },
];

// Plotly colorscales for heatmaps, organized by category
// NOTE: Cyclical colormaps (edge, phase, twilight, mrybm, mygbm) should be avoided for continuous heatmaps

// Get all available colorscales from the imported JSON
const availableColorscales = Object.keys(plotlyColorscales);

// Cyclical colormaps - should have warnings
const CYCLICAL_COLORSCALES = ["edge", "phase", "twilight", "mrybm", "mygbm"];

// Organize colorscales by category
interface ColorscaleOption {
  label: string;
  value: string;
  warning?: boolean;
}

interface ColorscaleCategory {
  label: string;
  options: ColorscaleOption[];
}

const COLORSCALE_CATEGORIES: ColorscaleCategory[] = [
  {
    label: "Recommended",
    options: [
      { label: "Viridis", value: "viridis" },
      { label: "Inferno", value: "inferno" },
      { label: "Balance", value: "balance" },
    ].filter((opt) => availableColorscales.includes(opt.value)),
  },
  {
    label: "Sequential (Uniform)",
    options: [
      { label: "Viridis", value: "viridis" },
      { label: "Plasma", value: "plasma" },
      { label: "Inferno", value: "inferno" },
      { label: "Magma", value: "magma" },
      { label: "Turbo", value: "turbo" },
      { label: "Cividis", value: "cividis" },
    ].filter((opt) => availableColorscales.includes(opt.value)),
  },
  {
    label: "Sequential (Single-hue)",
    options: [
      { label: "Blues", value: "blues" },
      { label: "Greens", value: "greens" },
      { label: "Greys", value: "greys" },
      { label: "Reds", value: "reds" },
      { label: "Oranges", value: "oranges" },
      { label: "Purples", value: "purples" },
      { label: "Teal", value: "teal" },
      { label: "Mint", value: "mint" },
      { label: "Burg", value: "burg" },
      { label: "Peach", value: "peach" },
      { label: "Pinkyl", value: "pinkyl" },
    ].filter((opt) => availableColorscales.includes(opt.value)),
  },
  {
    label: "Sequential (Multi-hue)",
    options: [
      { label: "YlOrRd", value: "ylorrd" },
      { label: "YlGnBu", value: "ylgnbu" },
      { label: "YlGn", value: "ylgn" },
      { label: "BuGn", value: "bugn" },
      { label: "BuPu", value: "bupu" },
      { label: "GnBu", value: "gnbu" },
      { label: "OrRd", value: "orrd" },
      { label: "PuBuGn", value: "pubugn" },
      { label: "PuBu", value: "pubu" },
      { label: "PuRd", value: "purd" },
      { label: "RdPu", value: "rdpu" },
      { label: "YlOrBr", value: "ylorbr" },
      { label: "Aggrnyl", value: "aggrnyl" },
      { label: "Agsunset", value: "agsunset" },
      { label: "Blugrn", value: "blugrn" },
      { label: "Bluyl", value: "bluyl" },
      { label: "Brwnyl", value: "brwnyl" },
      { label: "Burgyl", value: "burgyl" },
      { label: "Darkmint", value: "darkmint" },
      { label: "Emrld", value: "emrld" },
      { label: "Oryel", value: "oryel" },
      { label: "Purpor", value: "purpor" },
      { label: "Redor", value: "redor" },
      { label: "Sunset", value: "sunset" },
      { label: "Sunsetdark", value: "sunsetdark" },
      { label: "Tealgrn", value: "tealgrn" },
    ].filter((opt) => availableColorscales.includes(opt.value)),
  },
  {
    label: "Diverging",
    options: [
      { label: "RdBu", value: "rdbu" },
      { label: "Spectral", value: "spectral" },
      { label: "RdYlBu", value: "rdylbu" },
      { label: "RdYlGn", value: "rdylgn" },
      { label: "PiYG", value: "piyg" },
      { label: "PRGn", value: "prgn" },
      { label: "BrBG", value: "brbg" },
      { label: "PuOr", value: "puor" },
      { label: "RdGy", value: "rdgy" },
      { label: "Armyrose", value: "armyrose" },
      { label: "Earth", value: "earth" },
      { label: "Fall", value: "fall" },
      { label: "Geyser", value: "geyser" },
      { label: "Temps", value: "temps" },
      { label: "Tropic", value: "tropic" },
      { label: "Balance", value: "balance" },
      { label: "Curl", value: "curl" },
      { label: "Delta", value: "delta" },
      { label: "Oxy", value: "oxy" },
      { label: "Tealrose", value: "tealrose" },
    ].filter((opt) => availableColorscales.includes(opt.value)),
  },
  {
    label: "Cyclical",
    options: [
      { label: "Twilight", value: "twilight", warning: true },
      { label: "Phase", value: "phase", warning: true },
      { label: "Edge", value: "edge", warning: true },
      { label: "Mrybm", value: "mrybm", warning: true },
      { label: "Mygbm", value: "mygbm", warning: true },
    ].filter((opt) => availableColorscales.includes(opt.value)),
  },
  {
    label: "Other",
    options: [
      { label: "Hot", value: "hot" },
      { label: "Jet", value: "jet" },
      { label: "Rainbow", value: "rainbow" },
      { label: "Blackbody", value: "blackbody" },
      { label: "Bluered", value: "bluered" },
      { label: "Electric", value: "electric" },
      { label: "Picnic", value: "picnic" },
      { label: "Portland", value: "portland" },
    ].filter((opt) => availableColorscales.includes(opt.value)),
  },
];

// A reversed map is stored Matplotlib-style, as the base name plus "_r".
const splitColorscale = (value: string) => ({
  base: value.replace(/_r$/, ""),
  reversed: /_r$/.test(value),
});

export const LineStyleSection: React.FC<SectionProps> = ({ settings, updateSetting }) => (
  <div className="space-y-4">
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1.5">Mode</label>
      <IconDropdown
        value={settings.line.mode}
        onChange={(value) => updateSetting(["line", "mode"], value)}
        options={LINE_MODE_OPTS}
        className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        title="Line mode"
        aria-label="Line mode"
      />
    </div>

    {/* Line Settings - Show when mode includes "lines" */}
    {(settings.line.mode === "lines" || settings.line.mode === "lines+markers") && (
      <>
        <div className="border-t border-gray-200 pt-4">
          <h4 className="text-md font-medium text-gray-800 mb-3">Line Settings</h4>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Color</label>
          <div className="flex gap-2 items-center">
            <input
              type="color"
              value={settings.line.color}
              onChange={(e) => updateSetting(["line", "color"], e.target.value)}
              className="w-12 h-10 border border-gray-300 rounded cursor-pointer"
              title="Line color"
              aria-label="Line color"
            />
            <div className="flex flex-wrap gap-1 flex-1">
              {LINE_COLOR_OPTS.map((color) => (
                <button
                  key={color}
                  onClick={() => updateSetting(["line", "color"], color)}
                  className="w-6 h-6 rounded border border-gray-300 hover:scale-110 transition-transform"
                  style={{ backgroundColor: color }}
                  title={`Select color ${color}`}
                  aria-label={`Select color ${color}`}
                />
              ))}
            </div>
          </div>
        </div>

        <div>
          <label className="flex items-center justify-between text-sm font-medium text-gray-700 mb-1.5">
            Width
            <span className="text-xs text-gray-500">{settings.line.width}px</span>
          </label>
          <input
            type="range"
            min="1"
            max="10"
            step="0.5"
            value={settings.line.width}
            onChange={(e) => updateSetting(["line", "width"], parseFloat(e.target.value))}
            className="w-full"
            title="Line width"
            aria-label="Line width"
          />
        </div>

        <div>
          <label className="flex items-center justify-between text-sm font-medium text-gray-700 mb-1.5">
            Opacity
            <span className="text-xs text-gray-500">{settings.line.opacity}</span>
          </label>
          <input
            type="range"
            min="0"
            max="1"
            step="0.1"
            value={settings.line.opacity}
            onChange={(e) => updateSetting(["line", "opacity"], parseFloat(e.target.value))}
            className="w-full"
            title="Line opacity"
            aria-label="Line opacity"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Dash Style</label>
          <IconDropdown
            value={settings.line.dash}
            onChange={(value: string) => updateSetting(["line", "dash"], value)}
            options={LINE_DASH_OPTS}
            className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            title="Line dash style"
            aria-label="Line dash style"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Shape</label>
          <IconDropdown
            value={settings.line.shape}
            onChange={(value: string) => updateSetting(["line", "shape"], value)}
            options={LINE_SHAPE_OPTS}
            className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            title="Line shape"
            aria-label="Line shape"
          />
        </div>

        <div>
          <label className="flex items-center justify-between text-sm font-medium text-gray-700 mb-1.5">
            Smoothing
            <span className="text-xs text-gray-500">{settings.line.smoothing}</span>
          </label>
          <input
            type="range"
            min="0"
            max="1"
            step="0.1"
            value={settings.line.smoothing}
            onChange={(e) => updateSetting(["line", "smoothing"], parseFloat(e.target.value))}
            className="w-full"
            title="Line smoothing (for spline shapes)"
            aria-label="Line smoothing"
          />
        </div>
      </>
    )}

    {/* Marker Settings - Show when mode includes "markers" */}
    {(settings.line.mode === "markers" || settings.line.mode === "lines+markers") && (
      <>
        <div className="border-t border-gray-200 pt-4">
          <h4 className="text-md font-medium text-gray-800 mb-3">Marker Settings</h4>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Symbol</label>
          <IconDropdown
            value={settings.marker.symbol}
            onChange={(value: string) => updateSetting(["marker", "symbol"], value)}
            options={MARKER_SYMBOL_OPTS}
            className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            title="Marker symbol"
            aria-label="Marker symbol"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Color</label>
          <div className="flex gap-2 items-center">
            <input
              type="color"
              value={settings.marker.color}
              onChange={(e) => updateSetting(["marker", "color"], e.target.value)}
              className="w-12 h-10 border border-gray-300 rounded cursor-pointer"
              title="Marker color"
              aria-label="Marker color"
            />
            <div className="flex flex-wrap gap-1 flex-1">
              {LINE_COLOR_OPTS.map((color) => (
                <button
                  key={color}
                  onClick={() => updateSetting(["marker", "color"], color)}
                  className="w-6 h-6 rounded border border-gray-300 hover:scale-110 transition-transform"
                  style={{ backgroundColor: color }}
                  title={`Select marker color ${color}`}
                  aria-label={`Select marker color ${color}`}
                />
              ))}
            </div>
          </div>
        </div>

        <div>
          <label className="flex items-center justify-between text-sm font-medium text-gray-700 mb-1.5">
            Size
            <span className="text-xs text-gray-500">{settings.marker.size}px</span>
          </label>
          <input
            type="range"
            min="2"
            max="20"
            step="1"
            value={settings.marker.size}
            onChange={(e) => updateSetting(["marker", "size"], parseInt(e.target.value))}
            className="w-full"
            title="Marker size"
            aria-label="Marker size"
          />
        </div>

        <div>
          <label className="flex items-center justify-between text-sm font-medium text-gray-700 mb-1.5">
            Opacity
            <span className="text-xs text-gray-500">{settings.marker.opacity}</span>
          </label>
          <input
            type="range"
            min="0"
            max="1"
            step="0.1"
            value={settings.marker.opacity}
            onChange={(e) => updateSetting(["marker", "opacity"], parseFloat(e.target.value))}
            className="w-full"
            title="Marker opacity"
            aria-label="Marker opacity"
          />
        </div>
      </>
    )}
  </div>
);

interface ColormapSectionProps extends SectionProps {
  /** The plot the colour range is relative to; omitted for defaults. */
  plotJson?: any;
  showColorRange?: boolean;
}

export const ColormapSection: React.FC<ColormapSectionProps> = ({
  settings,
  updateSetting,
  plotJson,
  showColorRange = true,
}) => {
  const colorscale = splitColorscale(settings.hmap?.colorscale || "viridis");
  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="block text-sm font-medium text-gray-700">Colorscale</label>
          <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-700">
            Reverse
            <span className="relative inline-flex items-center">
              <input
                type="checkbox"
                checked={colorscale.reversed}
                onChange={(e) =>
                  updateSetting(
                    ["hmap", "colorscale"],
                    `${colorscale.base}${e.target.checked ? "_r" : ""}`,
                  )
                }
                className="sr-only peer"
                title="Reverse colorscale"
                aria-label="Reverse colorscale"
              />
              <span className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></span>
            </span>
          </label>
        </div>
        <select
          value={colorscale.base}
          onChange={(e) =>
            updateSetting(
              ["hmap", "colorscale"],
              `${e.target.value}${colorscale.reversed ? "_r" : ""}`,
            )
          }
          className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          title="Heatmap colorscale"
          aria-label="Heatmap colorscale"
        >
          {COLORSCALE_CATEGORIES.map((category) => (
            <optgroup key={category.label} label={category.label}>
              {category.options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.warning ? <AlertTriangle size={14} className="shrink-0 mt-0.5" /> : ""}
                  {option.label}
                  {option.warning ? " (Cyclical)" : ""}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        {CYCLICAL_COLORSCALES.includes(colorscale.base) && (
          <div className="mt-2 flex items-start gap-2 p-2 bg-amber-50 border border-amber-200 rounded text-xs text-amber-800">
            <AlertTriangle size={14} className="shrink-0 mt-0.5" />
            <span>
              <strong>Warning:</strong> This is a cyclical colormap designed for phase or periodic
              data. Because it wraps around, it may be misleading for continuous heatmaps.
            </span>
          </div>
        )}
      </div>

      <div className="text-xs text-gray-500 italic mb-3">
        Tip: Sequential colormaps (Viridis, Plasma, etc.) are recommended for continuous data.
      </div>

      {showColorRange && (
        <div>
          <div className="flex items-center justify-between mb-1.5 h-7">
            <label className="block text-sm font-medium text-gray-700">Color Range</label>
            <div className="flex items-center gap-1">
              {settings.hmap?.rangecolor &&
                (settings.hmap.rangecolor[0] !== 0 || settings.hmap.rangecolor[1] !== 100) && (
                  <Tooltip content="Reset to automatic range">
                    <button
                      onClick={() => updateSetting(["hmap", "rangecolor"], null)}
                      className="p-1 rounded text-gray-500 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                      aria-label="Reset color range"
                    >
                      <RotateCcw size={16} />
                    </button>
                  </Tooltip>
                )}
              <Tooltip content="Percentage of the data range (0% = data min, 100% = data max)">
                <span className="inline-flex items-center gap-1 text-xs text-gray-600">
                  <Info size={16} className="text-blue-500" />
                </span>
              </Tooltip>
            </div>
          </div>
          <div className="mb-2 mt-6 px-1">
            {(() => {
              // Extract bounds to display
              let zMin = Infinity;
              let zMax = -Infinity;

              if (plotJson) {
                const origLayout = plotJson.layout as any;
                if (
                  typeof origLayout?.coloraxis?.cmin === "number" &&
                  typeof origLayout?.coloraxis?.cmax === "number" &&
                  !isNaN(origLayout.coloraxis.cmin) &&
                  !isNaN(origLayout.coloraxis.cmax)
                ) {
                  zMin = origLayout.coloraxis.cmin;
                  zMax = origLayout.coloraxis.cmax;
                } else {
                  (plotJson.data || []).forEach((trace: any) => {
                    if (trace.type === "heatmap") {
                      if (typeof trace.zmin === "number" && typeof trace.zmax === "number") {
                        if (trace.zmin < zMin) zMin = trace.zmin;
                        if (trace.zmax > zMax) zMax = trace.zmax;
                      } else if (trace.z) {
                        const zData = trace.z as any;
                        const isNested =
                          Array.isArray(zData[0]) ||
                          (ArrayBuffer.isView(zData[0]) && !(zData[0] instanceof DataView));
                        if (isNested) {
                          for (let i = 0; i < zData.length; i++) {
                            for (let j = 0; j < zData[i].length; j++) {
                              const val = +zData[i][j];
                              if (!isNaN(val)) {
                                if (val < zMin) zMin = val;
                                if (val > zMax) zMax = val;
                              }
                            }
                          }
                        } else if (Array.isArray(zData) || ArrayBuffer.isView(zData)) {
                          for (let i = 0; i < (zData as any).length; i++) {
                            const val = +(zData as any)[i];
                            if (!isNaN(val)) {
                              if (val < zMin) zMin = val;
                              if (val > zMax) zMax = val;
                            }
                          }
                        }
                      }
                    }
                  });
                }
              }

              const hasValidBounds = zMin !== Infinity && zMax !== -Infinity;
              const range = hasValidBounds ? zMax - zMin : 0;

              const pctMin = settings.hmap?.rangecolor?.[0] ?? 0;
              const pctMax = settings.hmap?.rangecolor?.[1] ?? 100;

              const formatZ = engineeringFormatter(
                (plotJson?.layout as any)?.meta?.qimchi_units?.z,
                hasValidBounds ? [zMin, zMax] : [],
              );
              const displayMin = hasValidBounds
                ? formatZ(zMin + (range * pctMin) / 100)
                : `${pctMin}%`;
              const displayMax = hasValidBounds
                ? formatZ(zMin + (range * pctMax) / 100)
                : `${pctMax}%`;

              return (
                <>
                  <DualThumbSlider
                    min={0}
                    max={100}
                    step={1}
                    value={settings.hmap?.rangecolor || [0, 100]}
                    onChange={(value: [number, number]) => {
                      updateSetting(["hmap", "rangecolor"], value);
                    }}
                    title={`Color Range: ${displayMin} to ${displayMax}`}
                    displayMin={displayMin}
                    displayMax={displayMax}
                  />
                  {hasValidBounds && (
                    <div className="flex justify-between text-[10px] text-gray-400 mt-1 pb-1">
                      <span>Data min: {formatZ(zMin)}</span>
                      <span>Data max: {formatZ(zMax)}</span>
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
};

interface AxisSectionProps extends SectionProps {
  axis: "x" | "y";
  plotType: string;
}

export const AxisSection: React.FC<AxisSectionProps> = ({
  axis,
  plotType,
  settings,
  updateSetting,
}) => {
  const label = axis.toUpperCase();
  return (
    <div className="space-y-6">
      {/* Major Grid & Ticks */}
      <div>
        <h3 className="text-lg font-medium text-gray-800 mb-4">Major Grid & Ticks</h3>

        {/* Show Major Grid Toggle */}
        <div className="mb-4">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-gray-700">Show Major Grid</label>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={settings[axis].maj.showgrid}
                onChange={(e) => updateSetting([axis, "maj", "showgrid"], e.target.checked)}
                className="sr-only peer"
                title={`Show ${label}-axis major grid`}
                aria-label={`Show ${label}-axis major grid`}
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
            </label>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Axis Type</label>
            <IconDropdown
              value={settings[axis].maj.type}
              onChange={(value: string) => updateSetting([axis, "maj", "type"], value)}
              options={AXIS_TYPE_OPTS}
              className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              title={`${label}-axis type`}
              aria-label={`${label}-axis type`}
            />
          </div>

          {/* Major Grid Settings - only show when grid is enabled */}
          {settings[axis].maj.showgrid && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Grid Color</label>
                <input
                  type="color"
                  value={settings[axis].maj.gridcolor}
                  onChange={(e) => updateSetting([axis, "maj", "gridcolor"], e.target.value)}
                  className="w-12 h-10 border border-gray-300 rounded cursor-pointer"
                  title={`${label}-axis major grid color`}
                  aria-label={`${label}-axis major grid color`}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Grid Dash Style
                </label>
                <IconDropdown
                  value={settings[axis].maj.griddash}
                  onChange={(value: string) => updateSetting([axis, "maj", "griddash"], value)}
                  options={GRID_DASH_OPTS}
                  className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  title={`${label}-axis major grid dash style`}
                  aria-label={`${label}-axis major grid dash style`}
                />
              </div>

              {plotType !== "heatmap" && (
                <div>
                  <label className="flex items-center justify-between text-sm font-medium text-gray-700 mb-1.5">
                    Grid Width
                    <span className="text-xs text-gray-500">{settings[axis].maj.gridwidth}px</span>
                  </label>
                  <input
                    type="range"
                    min="1"
                    max="5"
                    step="0.5"
                    value={settings[axis].maj.gridwidth}
                    onChange={(e) =>
                      updateSetting([axis, "maj", "gridwidth"], parseFloat(e.target.value))
                    }
                    className="w-full"
                    title={`${label}-axis major grid width`}
                    aria-label={`${label}-axis major grid width`}
                  />
                </div>
              )}
            </>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Number of Ticks
            </label>
            <input
              type="number"
              min="2"
              max="20"
              value={settings[axis].maj.nticks}
              onChange={(e) => updateSetting([axis, "maj", "nticks"], parseInt(e.target.value))}
              className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              title={`Number of ${label}-axis major ticks`}
              aria-label={`Number of ${label}-axis major ticks`}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Tick Color</label>
            <input
              type="color"
              value={settings[axis].maj.tickcolor}
              onChange={(e) => updateSetting([axis, "maj", "tickcolor"], e.target.value)}
              className="w-12 h-10 border border-gray-300 rounded cursor-pointer"
              title={`${label}-axis major tick color`}
              aria-label={`${label}-axis major tick color`}
            />
          </div>

          <div>
            <label className="flex items-center justify-between text-sm font-medium text-gray-700 mb-1.5">
              Tick Width
              <span className="text-xs text-gray-500">{settings[axis].maj.tickwidth}px</span>
            </label>
            <input
              type="range"
              min="1"
              max="5"
              step="0.5"
              value={settings[axis].maj.tickwidth}
              onChange={(e) =>
                updateSetting([axis, "maj", "tickwidth"], parseFloat(e.target.value))
              }
              className="w-full"
              title={`${label}-axis major tick width`}
              aria-label={`${label}-axis major tick width`}
            />
          </div>

          <div>
            <label className="flex items-center justify-between text-sm font-medium text-gray-700 mb-1.5">
              Tick Length
              <span className="text-xs text-gray-500">{settings[axis].maj.ticklen}px</span>
            </label>
            <input
              type="range"
              min="2"
              max="15"
              step="1"
              value={settings[axis].maj.ticklen}
              onChange={(e) => updateSetting([axis, "maj", "ticklen"], parseInt(e.target.value))}
              className="w-full"
              title={`${label}-axis major tick length`}
              aria-label={`${label}-axis major tick length`}
            />
          </div>

          <div>
            <label className="flex items-center justify-between text-sm font-medium text-gray-700 mb-1.5">
              Tick Angle
              <span className="text-xs text-gray-500">{settings[axis].maj.tickangle}°</span>
            </label>
            <input
              type="range"
              min="-90"
              max="90"
              step="15"
              value={settings[axis].maj.tickangle}
              onChange={(e) => updateSetting([axis, "maj", "tickangle"], parseInt(e.target.value))}
              className="w-full"
              title={`${label}-axis major tick angle`}
              aria-label={`${label}-axis major tick angle`}
            />
          </div>
        </div>
      </div>

      {/* Separator */}
      <div className="border-t border-gray-200 my-6"></div>

      {/* Minor Grid & Ticks */}
      <div>
        <h3 className="text-lg font-medium text-gray-800 mb-4">Minor Grid & Ticks</h3>

        {/* Show Minor Grid Toggle */}
        <div className="mb-4">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-gray-700">Show Minor Grid</label>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={settings[axis].min.showgrid}
                onChange={(e) => updateSetting([axis, "min", "showgrid"], e.target.checked)}
                className="sr-only peer"
                title={`Show ${label}-axis minor grid`}
                aria-label={`Show ${label}-axis minor grid`}
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
            </label>
          </div>
        </div>

        <div className="space-y-4">
          {/* Minor Grid Settings - only show when grid is enabled */}
          {settings[axis].min.showgrid && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Grid Color</label>
                <input
                  type="color"
                  value={settings[axis].min.gridcolor}
                  onChange={(e) => updateSetting([axis, "min", "gridcolor"], e.target.value)}
                  className="w-12 h-10 border border-gray-300 rounded cursor-pointer"
                  title={`${label}-axis minor grid color`}
                  aria-label={`${label}-axis minor grid color`}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Grid Dash Style
                </label>
                <IconDropdown
                  value={settings[axis].min.griddash}
                  onChange={(value: string) => updateSetting([axis, "min", "griddash"], value)}
                  options={GRID_DASH_OPTS}
                  className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  title={`${label}-axis minor grid dash style`}
                  aria-label={`${label}-axis minor grid dash style`}
                />
              </div>

              {plotType !== "heatmap" && (
                <div>
                  <label className="flex items-center justify-between text-sm font-medium text-gray-700 mb-1.5">
                    Grid Width
                    <span className="text-xs text-gray-500">{settings[axis].min.gridwidth}px</span>
                  </label>
                  <input
                    type="range"
                    min="1"
                    max="5"
                    step="0.5"
                    value={settings[axis].min.gridwidth}
                    onChange={(e) =>
                      updateSetting([axis, "min", "gridwidth"], parseFloat(e.target.value))
                    }
                    className="w-full"
                    title={`${label}-axis minor grid width`}
                    aria-label={`${label}-axis minor grid width`}
                  />
                </div>
              )}
            </>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Number of Ticks
            </label>
            <input
              type="number"
              min="2"
              max="20"
              value={settings[axis].min.nticks}
              onChange={(e) => updateSetting([axis, "min", "nticks"], parseInt(e.target.value))}
              className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              title={`Number of ${label}-axis minor ticks`}
              aria-label={`Number of ${label}-axis minor ticks`}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Tick Color</label>
            <input
              type="color"
              value={settings[axis].min.tickcolor}
              onChange={(e) => updateSetting([axis, "min", "tickcolor"], e.target.value)}
              className="w-12 h-10 border border-gray-300 rounded cursor-pointer"
              title={`${label}-axis minor tick color`}
              aria-label={`${label}-axis minor tick color`}
            />
          </div>

          <div>
            <label className="flex items-center justify-between text-sm font-medium text-gray-700 mb-1.5">
              Tick Width
              <span className="text-xs text-gray-500">{settings[axis].min.tickwidth}px</span>
            </label>
            <input
              type="range"
              min="1"
              max="5"
              step="0.5"
              value={settings[axis].min.tickwidth}
              onChange={(e) =>
                updateSetting([axis, "min", "tickwidth"], parseFloat(e.target.value))
              }
              className="w-full"
              title={`${label}-axis minor tick width`}
              aria-label={`${label}-axis minor tick width`}
            />
          </div>

          <div>
            <label className="flex items-center justify-between text-sm font-medium text-gray-700 mb-1.5">
              Tick Length
              <span className="text-xs text-gray-500">{settings[axis].min.ticklen}px</span>
            </label>
            <input
              type="range"
              min="2"
              max="15"
              step="1"
              value={settings[axis].min.ticklen}
              onChange={(e) => updateSetting([axis, "min", "ticklen"], parseInt(e.target.value))}
              className="w-full"
              title={`${label}-axis minor tick length`}
              aria-label={`${label}-axis minor tick length`}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

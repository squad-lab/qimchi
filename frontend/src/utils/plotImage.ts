// Plotly rasterizes SVG through an <img>, which cannot access page fonts.
// Embed those fonts first and apply the light export theme.
import type { Layout } from "plotly.js";

import Plotly from "../components/Plots/plotly";
import { applyThemeToLayout, lightTheme } from "../components/Plots/themes";

/** The first font file listed in an @font-face `src`. */
export const fontUrlOf = (src: string): string | null =>
  src.match(/url\(\s*["']?([^"')]+)["']?\s*\)/)?.[1] ?? null;

/** Put a style block at the start of an SVG document. */
export function withStyle(svg: string, css: string): string {
  const open = svg.match(/<svg\b[^>]*>/);
  if (!open || open.index === undefined) return svg;
  const at = open.index + open[0].length;
  return `${svg.slice(0, at)}<defs><style>${css}</style></defs>${svg.slice(at)}`;
}

/** A layout drawn in the light theme, on a transparent background. */
export function lightLayout(layout: Partial<Layout>): Partial<Layout> {
  const themed = applyThemeToLayout(layout, lightTheme);
  const axisLine = { linecolor: lightTheme.colors.text };
  return {
    ...themed,
    xaxis: { ...themed.xaxis, ...axisLine },
    yaxis: { ...themed.yaxis, ...axisLine },
  };
}

const toDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

const fontCss = new Map<string, Promise<string>>();

/** Return one font family's @font-face rules with their files inlined. */
const embeddedFont = (family: string): Promise<string> => {
  const cached = fontCss.get(family);
  if (cached) return cached;
  const css = (async () => {
    const rules: string[] = [];
    for (const sheet of Array.from(document.styleSheets)) {
      let cssRules: CSSRuleList;
      try {
        cssRules = sheet.cssRules;
      } catch {
        continue; // a cross-origin sheet
      }
      for (const rule of Array.from(cssRules)) {
        if (!(rule instanceof CSSFontFaceRule)) continue;
        if (rule.style.getPropertyValue("font-family").replace(/["']/g, "").trim() !== family) {
          continue;
        }
        const url = fontUrlOf(rule.style.getPropertyValue("src"));
        if (!url) continue;
        try {
          const absolute = new URL(url, sheet.href ?? document.baseURI).href;
          const data = await toDataUrl(await (await fetch(absolute)).blob());
          const descriptors = ["font-family", "font-style", "font-weight", "unicode-range"]
            .map((name) => [name, rule.style.getPropertyValue(name)] as const)
            .filter(([, value]) => value)
            .map(([name, value]) => `${name}:${value};`)
            .join("");
          rules.push(`@font-face{${descriptors}src:url(${data});}`);
        } catch {
          // Leave unavailable fonts to the browser's normal fallback.
        }
      }
    }
    return rules.join("");
  })();
  fontCss.set(family, css);
  return css;
};

/** The font families a Plotly SVG asks for. */
export const fontFamiliesIn = (svg: string): string[] => {
  const families = new Set<string>();
  const text = svg.replace(/&quot;/g, "'");
  for (const match of text.matchAll(/font-family:\s*([^;"]+)/g)) {
    for (const name of match[1].split(",")) {
      const family = name.replace(/["']/g, "").trim();
      if (family) families.add(family);
    }
  }
  return [...families];
};

/** Render the current Plotly view as a transparent PNG. */
export async function plotToPng(graph: HTMLElement, scale: number): Promise<Blob> {
  const width = graph.clientWidth;
  const height = graph.clientHeight;
  const drawn = graph as HTMLElement & { data: Plotly.Data[]; layout: Partial<Layout> };
  const figure = { data: drawn.data, layout: lightLayout(drawn.layout) };
  const svgUrl = await Plotly.toImage(figure, { format: "svg", width, height });
  const svg = decodeURIComponent(svgUrl.slice(svgUrl.indexOf(",") + 1));
  const fonts = await Promise.all(fontFamiliesIn(svg).map(embeddedFont));
  const dressed = withStyle(svg, fonts.join(""));

  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(dressed)}`;
  await image.decode();

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("No canvas to draw the plot on");
  context.scale(scale, scale);
  context.drawImage(image, 0, 0, width, height);
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Could not encode the image"))),
      "image/png",
    ),
  );
}

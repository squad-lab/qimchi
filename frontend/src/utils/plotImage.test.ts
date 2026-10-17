import { describe, expect, it, vi } from "vitest";

vi.mock("../components/Plots/plotly", () => ({ default: {} }));

import {
  fontFamiliesIn,
  fontUrlOf,
  lightLayout,
  darkLayout,
  themedLayout,
  withDrawnSize,
  withStyle,
} from "./plotImage";
import { darkTheme } from "../components/Plots/themes";

describe("fontUrlOf", () => {
  it("takes the first file an @font-face lists", () => {
    expect(
      fontUrlOf('url("/assets/fira-400.woff2") format("woff2"), url(/assets/fira-400.woff)'),
    ).toBe("/assets/fira-400.woff2");
    expect(fontUrlOf("url(fira.woff2)")).toBe("fira.woff2");
    expect(fontUrlOf("local(Arial)")).toBeNull();
  });
});

describe("withStyle", () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><g/></svg>';

  it("adds the fonts before anything is drawn, and no background", () => {
    expect(withStyle(svg, "@font-face{font-family:Fira}")).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">' +
        "<defs><style>@font-face{font-family:Fira}</style></defs><g/></svg>",
    );
  });

  it("leaves something that is not an SVG alone", () => {
    expect(withStyle("<div/>", "")).toBe("<div/>");
  });
});

describe("lightLayout", () => {
  it("draws a dark-theme plot in the light theme on a transparent background", () => {
    const layout = lightLayout({
      paper_bgcolor: "#282c34",
      font: { color: "#ABB2BF" },
      xaxis: { range: [0, 1], linecolor: "#ABB2BF" },
    });

    expect(layout.paper_bgcolor).toBe("rgba(0,0,0,0)");
    expect(layout.plot_bgcolor).toBe("rgba(0,0,0,0)");
    expect(layout.font?.color).toBe("#374151");
    expect(layout.xaxis?.linecolor).toBe("#374151");
    // The view the user is looking at is kept.
    expect(layout.xaxis?.range).toEqual([0, 1]);
  });

  it("draws in a given theme", () => {
    const layout = themedLayout({ xaxis: { range: [0, 1] } }, darkTheme);

    expect(layout.font?.color).toBe(darkTheme.colors.text);
    expect(layout.xaxis?.range).toEqual([0, 1]);
  });
});

describe("fontFamiliesIn", () => {
  it("lists each family the SVG's text asks for once", () => {
    const svg =
      '<text style="font-family: &quot;Fira Sans&quot;, Arial, sans-serif; font-size: 12px"/>' +
      "<text style=\"font-family: 'Fira Sans', Arial; fill: red\"/>";

    expect(fontFamiliesIn(svg)).toEqual(["Fira Sans", "Arial", "sans-serif"]);
  });
});

describe("withDrawnSize", () => {
  const drawn = (width: number, height: number) => {
    const container = document.createElement("div");
    const graph = document.createElement("div");
    graph.className = "js-plotly-plot";
    Object.defineProperty(graph, "clientWidth", { value: width });
    Object.defineProperty(graph, "clientHeight", { value: height });
    container.append(graph);
    return container;
  };

  it("exports a plot at the size it is drawn", () => {
    const figure = { data: [], layout: { title: "T" } };
    expect(withDrawnSize(figure, drawn(1200, 450)).layout).toEqual({
      title: "T",
      width: 1200,
      height: 450,
    });
  });

  it("leaves a plot that is not drawn to the export's default size", () => {
    const figure = { data: [], layout: { title: "T" } };
    expect(withDrawnSize(figure, drawn(0, 0))).toBe(figure);
    expect(withDrawnSize(figure, null)).toBe(figure);
  });
});

describe("darkLayout", () => {
  it("draws the disk export's dark variant: white on transparent", () => {
    const layout = darkLayout({
      title: "Sweep" as never,
      xaxis: { range: [0, 1], title: { text: "Gate" } },
      coloraxis: { colorbar: {} },
    });

    expect(layout.paper_bgcolor).toBe("rgba(0,0,0,0)");
    expect(layout.plot_bgcolor).toBe("rgba(0,0,0,0)");
    expect(layout.font?.color).toBe("white");
    expect(layout.xaxis?.linecolor).toBe("white");
    expect(layout.xaxis?.tickfont?.color).toBe("white");
    expect(layout.xaxis?.title).toMatchObject({ text: "Gate", font: { color: "white" } });
    // A plain-text title keeps its text.
    expect(layout.title).toMatchObject({ text: "Sweep", font: { color: "white" } });
    expect(layout.coloraxis?.colorbar?.tickfont?.color).toBe("white");
    expect(layout.xaxis?.range).toEqual([0, 1]);
  });
});

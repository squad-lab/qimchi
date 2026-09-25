import { describe, expect, it, vi } from "vitest";

vi.mock("../components/Plots/plotly", () => ({ default: {} }));

import { fontFamiliesIn, fontUrlOf, lightLayout, withStyle } from "./plotImage";

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
});

describe("fontFamiliesIn", () => {
  it("lists each family the SVG's text asks for once", () => {
    const svg =
      '<text style="font-family: &quot;Fira Sans&quot;, Arial, sans-serif; font-size: 12px"/>' +
      "<text style=\"font-family: 'Fira Sans', Arial; fill: red\"/>";

    expect(fontFamiliesIn(svg)).toEqual(["Fira Sans", "Arial", "sans-serif"]);
  });
});

import { describe, expect, it } from "vitest";
import { normalizeMixedLatexTitle } from "./latexTitle";

describe("normalizeMixedLatexTitle", () => {
  it("leaves plain and fully mathematical titles alone", () => {
    expect(normalizeMixedLatexTitle("R^SPCHSH^time")).toBe("R^SPCHSH^time");
    expect(normalizeMixedLatexTitle("$\\frac{a}{b}$")).toBe("$\\frac{a}{b}$");
  });

  it("escapes the text around math so MathJax reads it as text", () => {
    expect(normalizeMixedLatexTitle("R^SPCHSH^time $x$ a\\b~c")).toBe(
      "$\\mathrm{R{\\hat{}}SPCHSH{\\hat{}}time\\ }x\\mathrm{\\ a\\backslash{}b{\\sim}c}$",
    );
  });
});

import { createElement } from "react";
import { describe, expect, it } from "vitest";

import { buildHelpIndex, fuzzyMatch, searchHelp } from "./helpSearch";

const section = (id: string, label: string, content: React.ReactNode) => ({
  id,
  label,
  content,
});

describe("fuzzyMatch", () => {
  it("prefers a substring to a scattered subsequence", () => {
    const exact = fuzzyMatch("dark", "dark mode");
    const scattered = fuzzyMatch("dark", "drag and resize a knob");

    expect(exact).not.toBeNull();
    expect(scattered).not.toBeNull();
    expect(exact!.score).toBeGreaterThan(scattered!.score);
  });

  it("prefers a match at a word start", () => {
    const atStart = fuzzyMatch("mode", "mode switch");
    const midWord = fuzzyMatch("mode", "gamemode switch");

    expect(atStart!.score).toBeGreaterThan(midWord!.score);
  });

  it("reports the positions it matched, so they can be highlighted", () => {
    expect(fuzzyMatch("dm", "dark mode")!.positions).toEqual([0, 5]);
    expect(fuzzyMatch("mode", "dark mode")!.positions).toEqual([5, 6, 7, 8]);
  });

  it("returns null when a character is missing, and is case-insensitive", () => {
    expect(fuzzyMatch("zzz", "dark mode")).toBeNull();
    expect(fuzzyMatch("DARK", "dark mode")).not.toBeNull();
  });

  it("treats an empty query as no match rather than matching everything", () => {
    expect(fuzzyMatch("", "dark mode")).toBeNull();
  });
});

describe("buildHelpIndex", () => {
  it("walks a section's JSX, one entry per block, under its heading", () => {
    const content = createElement(
      "div",
      null,
      createElement("h3", null, "Dark mode"),
      createElement("p", null, "Toggle it from the rail."),
      createElement("ul", null, createElement("li", null, "Persists across restarts")),
    );

    const entries = buildHelpIndex([section("viewer", "Viewer", content)]);

    expect(entries.map((entry) => entry.text)).toEqual([
      "Dark mode",
      "Toggle it from the rail.",
      "Persists across restarts",
    ]);
    // The heading is both an entry and the breadcrumb for what follows.
    expect(entries[0].isHeading).toBe(true);
    expect(entries[1].heading).toBe("Dark mode");
    expect(entries[1].sectionLabel).toBe("Viewer");
  });

  it("resolves function components, which is where the help text lives", () => {
    const Inner = () => createElement("p", null, "Inside a component");
    const content = createElement("div", null, createElement(Inner));

    const entries = buildHelpIndex([section("notes", "Notes", content)]);

    expect(entries.map((entry) => entry.text)).toEqual(["Inside a component"]);
  });

  it("flattens nested markup into one entry per block", () => {
    const content = createElement(
      "p",
      null,
      "Press ",
      createElement("strong", null, "Shift+H"),
      " to open help",
    );

    const entries = buildHelpIndex([section("keys", "Shortcuts", content)]);

    expect(entries).toHaveLength(1);
    expect(entries[0].text).toBe("Press Shift+H to open help");
  });

  it("skips a component that throws rather than losing the whole index", () => {
    const Broken = () => {
      throw new Error("uses a hook");
    };
    const content = createElement(
      "div",
      null,
      createElement(Broken),
      createElement("p", null, "Still indexed"),
    );

    const entries = buildHelpIndex([section("mixed", "Mixed", content)]);

    expect(entries.map((entry) => entry.text)).toEqual(["Still indexed"]);
  });
});

describe("searchHelp", () => {
  const index = buildHelpIndex([
    section(
      "viewer",
      "Viewer",
      createElement(
        "div",
        null,
        createElement("h3", null, "Dark mode"),
        createElement("p", null, "Toggle the theme from the sidebar rail."),
        createElement("p", null, "Plots follow the app theme."),
      ),
    ),
    section("explorer", "Explorer", createElement("p", null, "Browse measurements on disk.")),
  ]);

  it("finds body text and ranks headings above it", () => {
    const results = searchHelp(index, "dark");

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].entry.text).toBe("Dark mode");
  });

  it("requires every term, so extra words narrow the results", () => {
    const one = searchHelp(index, "theme");
    const two = searchHelp(index, "theme rail");

    expect(one.length).toBeGreaterThan(two.length);
    expect(two.every((result) => /rail/i.test(result.entry.text))).toBe(true);
  });

  it("matches a term against the section name, not only the body", () => {
    // "Explorer" appears nowhere in that section's text.
    const results = searchHelp(index, "explorer measurements");

    expect(results.map((result) => result.entry.sectionId)).toContain("explorer");
  });

  it("returns nothing for an empty or unmatched query", () => {
    expect(searchHelp(index, "   ")).toEqual([]);
    expect(searchHelp(index, "zzzzz")).toEqual([]);
  });

  it("reports match positions for highlighting, within the entry text", () => {
    const [top] = searchHelp(index, "dark");

    expect(top.positions.length).toBeGreaterThan(0);
    expect(Math.max(...top.positions)).toBeLessThan(top.entry.text.length);
  });

  it("honours the result limit", () => {
    expect(searchHelp(index, "e", 2)).toHaveLength(2);
  });
});

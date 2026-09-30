import { isValidElement, ReactElement, ReactNode } from "react";

// Searchable unit of the Help modal: one paragraph, list item, table cell or
// heading, tagged with the section and nearest heading it sits under.
export interface HelpEntry {
  id: string;
  sectionId: string;
  sectionLabel: string;
  heading: string;
  text: string;
  isHeading: boolean;
}

export interface HelpSearchResult {
  entry: HelpEntry;
  score: number;
  positions: number[]; // Indices into entry.text that matched
}

interface IndexableSection {
  id: string;
  label: string;
  content: ReactNode;
}

type ChildBearing = ReactElement<{ children?: ReactNode }>;

const REACT_MEMO = Symbol.for("react.memo");

// The help sections are hook-free `memo(() => (...))` components, so their JSX
// is only reachable by invoking them. Anything that throws (a component that
// does use hooks, say) is skipped rather than taken down the whole index.
const renderPure = (element: ChildBearing): ReactNode | null => {
  const type: unknown = element.type;

  if (typeof type === "function") {
    try {
      return (type as (props: unknown) => ReactNode)(element.props);
    } catch {
      return null;
    }
  }

  if (type && typeof type === "object") {
    const wrapper = type as { $$typeof?: symbol; type?: unknown };
    if (wrapper.$$typeof === REACT_MEMO && typeof wrapper.type === "function") {
      try {
        return (wrapper.type as (props: unknown) => ReactNode)(element.props);
      } catch {
        return null;
      }
    }
  }

  return null;
};

const normalize = (value: string) => value.replace(/\s+/g, " ").trim();

// Flatten an element subtree to its visible text.
const textOf = (node: ReactNode): string => {
  const parts: string[] = [];

  const walk = (current: ReactNode) => {
    if (current === null || current === undefined || typeof current === "boolean") return;
    if (typeof current === "string" || typeof current === "number") {
      parts.push(String(current));
      return;
    }
    if (Array.isArray(current)) {
      current.forEach(walk);
      return;
    }
    if (isValidElement(current)) {
      const element = current as ChildBearing;
      if (typeof element.type !== "string") {
        const rendered = renderPure(element);
        if (rendered !== null) {
          walk(rendered);
          return;
        }
      }
      walk(element.props?.children);
    }
  };

  walk(node);
  return normalize(parts.join(" "));
};

const HEADING_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);
const BLOCK_TAGS = new Set(["p", "li", "td", "th"]);

// Walk a section, emitting one entry per block element and tracking the
// heading each block sits under so results can show a breadcrumb.
const collectSection = (section: IndexableSection, entries: HelpEntry[]) => {
  let heading = "";
  let counter = 0;

  const push = (text: string, isHeading: boolean) => {
    if (text.length < 3) return;
    entries.push({
      id: `${section.id}-${counter++}`,
      sectionId: section.id,
      sectionLabel: section.label,
      heading,
      text,
      isHeading,
    });
  };

  const walk = (node: ReactNode) => {
    if (node === null || node === undefined || typeof node === "boolean") return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (!isValidElement(node)) return;

    const element = node as ChildBearing;
    const tag = typeof element.type === "string" ? element.type : null;

    if (tag && HEADING_TAGS.has(tag)) {
      const text = textOf(element.props?.children);
      heading = text;
      push(text, true);
      return;
    }

    if (tag && BLOCK_TAGS.has(tag)) {
      push(textOf(element.props?.children), false);
      return;
    }

    if (!tag) {
      const rendered = renderPure(element);
      if (rendered !== null) {
        walk(rendered);
        return;
      }
    }

    walk(element.props?.children);
  };

  walk(section.content);
};

export const buildHelpIndex = (sections: IndexableSection[]): HelpEntry[] => {
  const entries: HelpEntry[] = [];
  sections.forEach((section) => collectSection(section, entries));
  return entries;
};

const isBoundary = (char: string | undefined) => char === undefined || /[^a-z0-9]/i.test(char);

// Subsequence matcher with the usual bonuses: an exact substring beats a
// scattered match, consecutive characters beat gaps, and word starts beat
// mid-word hits. Fast enough to run over the whole index on every keystroke.
export const fuzzyMatch = (
  query: string,
  text: string,
): { score: number; positions: number[] } | null => {
  if (!query) return null;

  const needle = query.toLowerCase();
  const haystack = text.toLowerCase();

  const exact = haystack.indexOf(needle);
  if (exact >= 0) {
    const positions: number[] = [];
    for (let i = 0; i < needle.length; i += 1) positions.push(exact + i);
    const wordStart = isBoundary(haystack[exact - 1]);
    return {
      score: 1000 + needle.length * 8 + (wordStart ? 250 : 0) - Math.min(exact, 200),
      positions,
    };
  }

  const positions: number[] = [];
  let cursor = 0;
  let score = 0;
  let previous = -2;

  for (let qi = 0; qi < needle.length; qi += 1) {
    let found = -1;
    while (cursor < haystack.length) {
      if (haystack[cursor] === needle[qi]) {
        found = cursor;
        cursor += 1;
        break;
      }
      cursor += 1;
    }
    if (found < 0) return null;

    positions.push(found);
    score += found === previous + 1 ? 18 : 1;
    if (isBoundary(haystack[found - 1])) score += 12;
    previous = found;
  }

  return { score: score - positions[0] * 0.1, positions };
};

// Every whitespace-separated term must match, so extra words narrow rather
// than widen. A term may match the section/heading breadcrumb instead of the
// body text, at a discount, so "viewer shortcut" finds the right rows.
export const searchHelp = (entries: HelpEntry[], query: string, limit = 50): HelpSearchResult[] => {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];

  const results: HelpSearchResult[] = [];

  for (const entry of entries) {
    const breadcrumb = `${entry.sectionLabel} ${entry.heading}`;
    const positions = new Set<number>();
    let total = 0;
    let matched = true;

    for (const term of terms) {
      const inText = fuzzyMatch(term, entry.text);
      const inBreadcrumb = fuzzyMatch(term, breadcrumb);

      if (!inText && !inBreadcrumb) {
        matched = false;
        break;
      }

      if (inText) {
        total += inText.score;
        inText.positions.forEach((position) => positions.add(position));
      } else if (inBreadcrumb) {
        total += inBreadcrumb.score * 0.4;
      }
    }

    if (!matched) continue;

    // Headings are short and load-bearing, so surface them above body text.
    if (entry.isHeading) total += 120;

    results.push({ entry, score: total, positions: [...positions].sort((a, b) => a - b) });
  }

  return results.sort((a, b) => b.score - a.score).slice(0, limit);
};

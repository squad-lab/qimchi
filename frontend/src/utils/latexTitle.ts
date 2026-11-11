// As the backend's units.latex_text: the app's MathJax has only the base and ams packages.
const LATEX_TEXT_ESCAPES: Record<string, string> = {
  "\\": "\\backslash{}",
  "{": "\\{",
  "}": "\\}",
  "%": "\\%",
  "&": "\\&",
  "#": "\\#",
  _: "\\_",
  $: "\\$",
  "^": "{\\hat{}}",
  "~": "{\\sim}",
};

export const normalizeMixedLatexTitle = (value: unknown): unknown => {
  if (typeof value !== "string") return value;
  const matches = [...value.matchAll(/\$([^$]+)\$/g)];
  if (!matches.length || (matches.length === 1 && matches[0][0] === value)) return value;

  const escapeText = (text: string) =>
    text.replace(/[\\{}%&#_^~$]/g, (char) => LATEX_TEXT_ESCAPES[char]).replace(/\s+/g, "\\ ");
  let cursor = 0;
  let latex = "$";
  for (const match of matches) {
    const index = match.index ?? cursor;
    const plain = value.slice(cursor, index);
    if (plain) latex += "\\mathrm{" + escapeText(plain) + "}";
    latex += match[1];
    cursor = index + match[0].length;
  }
  const trailing = value.slice(cursor);
  if (trailing) latex += "\\mathrm{" + escapeText(trailing) + "}";
  return latex + "$";
};

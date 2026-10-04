import changelog from "../../../CHANGELOG.md?raw";

// Eager raw imports keep the installed version's notes available offline.
const previewNotes = import.meta.glob<string>("../../../md/release-notes/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
});

export function releaseNotes(version: string): string {
  const tag = `v${version.replace(/^v/, "")}`;
  const source = /-(?:rc|alpha|beta)\.\d+$/.test(tag)
    ? (previewNotes[`../../../md/release-notes/${tag}.md`] ?? "")
    : changelog;
  return changelogSection(source, tag);
}

/** Return only the requested release, including an exact RC suffix. */
export function changelogSection(markdown: string, version: string): string {
  const tag = `v${version.replace(/^v/, "")}`;
  const headings = [
    ...markdown.matchAll(/^### (v\d+\.\d+\.\d+(?:-(?:rc|alpha|beta)\.\d+)?)(?=\s|$)[^\n]*$/gm),
  ];
  const index = headings.findIndex((heading) => heading[1] === tag);
  if (index < 0) return "";
  const heading = headings[index];
  return markdown.slice(heading.index! + heading[0].length, headings[index + 1]?.index).trim();
}

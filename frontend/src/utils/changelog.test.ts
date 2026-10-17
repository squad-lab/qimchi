import { describe, expect, it, vi } from "vitest";
import { changelogSection, releaseNotes } from "./changelog";

vi.mock("../../../CHANGELOG.md?raw", () => ({
  default: "### v0.7.1\n- Stable summary",
}));
vi.mock("../../../md/release-notes/v0.7.1-rc.1.md?raw", () => ({
  default: "### v0.7.1-rc.1\n- Candidate changes",
}));

const notes = `## Changelog
### v0.7.1 - 2026-10-03
- Stable changes
#### Details
Still this release.
### v0.7.1-rc.2 - 2026-10-03
- Second candidate
### v0.7.1-rc.1 - 2026-10-02
- First candidate
`;

describe("changelogSection", () => {
  it("routes stable and preview notes to their bundled sources", () => {
    expect(releaseNotes("0.7.1")).toBe("- Stable summary");
    expect(releaseNotes("v0.7.1-rc.1")).toBe("- Candidate changes");
    expect(releaseNotes("v9.9.9-rc.1")).toBe("");
  });
  it("separates stable and RC versions, retaining nested Markdown", () => {
    expect(changelogSection(notes, "0.7.1")).toBe(
      "- Stable changes\n#### Details\nStill this release.",
    );
    expect(changelogSection(notes, "v0.7.1-rc.2")).toBe("- Second candidate");
    expect(changelogSection(notes, "v0.7.1-rc.1")).toBe("- First candidate");
  });
  it("does not substitute stable notes for an unknown candidate", () => {
    expect(changelogSection(notes, "v0.7.1-rc.3")).toBe("");
    expect(changelogSection("", "v0.7.1")).toBe("");
  });
});

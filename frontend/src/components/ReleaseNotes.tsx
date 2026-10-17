import MDEditor from "@uiw/react-md-editor";
import rehypeSanitize from "rehype-sanitize";

import { useThemeStore } from "../stores/themeStore";

/** Render sanitized Markdown release notes. */
export default function ReleaseNotes({ notes }: { notes: string }) {
  const theme = useThemeStore((state) => state.theme);
  return (
    <div data-color-mode={theme}>
      <MDEditor.Markdown
        source={notes}
        rehypePlugins={[[rehypeSanitize]]}
        className="release-notes"
        style={{ background: "transparent", fontFamily: "inherit", fontSize: "0.8125rem" }}
      />
    </div>
  );
}

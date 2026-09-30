import React from "react";
import MDEditor from "@uiw/react-md-editor";
import rehypeSanitize from "rehype-sanitize";

// Local imports
import { useThemeStore } from "../stores/themeStore";

interface MarkdownEditorProps {
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  initialContent?: string;
  height?: number | string;
}

export default function MarkdownEditor({
  value,
  onChange,
  placeholder = "Please enter your notes here...",
  disabled = false,
  initialContent = "",
  height = "100%",
}: MarkdownEditorProps) {
  // @uiw/react-md-editor themes itself from data-color-mode; it was pinned to
  // "light", which left the editor a white slab in dark mode.
  const theme = useThemeStore((state) => state.theme);

  const [internalValue, setInternalValue] = React.useState(initialContent);

  // Use controlled value if provided, otherwise use internal state
  const currentValue = value !== undefined ? value : internalValue;

  const handleChange = (val: string | undefined) => {
    if (val !== undefined) {
      if (onChange) {
        onChange(val);
      } else {
        setInternalValue(val);
      }
    }
  };

  return (
    <div className="h-full w-full">
      <MDEditor
        value={currentValue}
        onChange={handleChange}
        preview="edit"
        visibleDragbar={false}
        previewOptions={{
          rehypePlugins: [[rehypeSanitize]], // Ensure safe HTML rendering
        }}
        textareaProps={{
          placeholder,
          disabled,
        }}
        data-color-mode={theme}
        tabSize={4}
        height={height}
        className="w-full h-full notes-markdown-editor" // Custom class for additional styling
        style={{ height: "100%" }}
      />
    </div>
  );
}

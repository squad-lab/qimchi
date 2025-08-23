import React from "react";
import MDEditor from "@uiw/react-md-editor";
import rehypeSanitize from "rehype-sanitize";

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
        previewOptions={{
          rehypePlugins: [[rehypeSanitize]], // Ensure safe HTML rendering
        }}
        textareaProps={{
          placeholder,
          disabled,
        }}
        data-color-mode="light" // TODOLATER: THEME:
        tabSize={4}
        height={height}
        className="w-full h-full"
        style={{ height: "100%" }}
      />
    </div>
  );
}

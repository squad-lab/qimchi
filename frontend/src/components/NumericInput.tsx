import React, { useEffect, useRef, useState } from "react";

interface NumericInputProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange" | "type"
> {
  value: number;
  onChange: (value: number) => void;
}

const asText = (value: number): string => (Number.isFinite(value) ? String(value) : "");

/** A numeric field that preserves incomplete input until it can be parsed. */
const NumericInput: React.FC<NumericInputProps> = ({ value, onChange, ...inputProps }) => {
  const [text, setText] = useState(() => asText(value));
  const editingRef = useRef(false);

  // Sync external changes without replacing text mid-edit.
  useEffect(() => {
    if (!editingRef.current) setText(asText(value));
  }, [value]);

  return (
    <input
      {...inputProps}
      type="text"
      inputMode="decimal"
      value={text}
      onChange={(event) => {
        const next = event.target.value;
        setText(next);
        const parsed = Number(next);
        if (next.trim() !== "" && Number.isFinite(parsed)) onChange(parsed);
      }}
      onFocus={(event) => {
        editingRef.current = true;
        inputProps.onFocus?.(event);
      }}
      onBlur={(event) => {
        editingRef.current = false;
        // Discard incomplete input on blur.
        setText(asText(value));
        inputProps.onBlur?.(event);
      }}
    />
  );
};

export default NumericInput;

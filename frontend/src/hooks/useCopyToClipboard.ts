import { useState, useCallback } from "react";

export const useCopyToClipboard = () => {
  const [isCopied, setIsCopied] = useState(false);

  const copyToClipboard = useCallback(async (text: string): Promise<boolean> => {
    try {
      // Modern API
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        setIsCopied(true);
        setTimeout(() => setIsCopied(false), 2000);
        return true;
      }
      // Fallback for older browsers
      else {
        const textArea = document.createElement("textarea");
        textArea.value = text;
        textArea.style.position = "fixed";
        textArea.style.left = "-999999px";
        textArea.style.top = "-999999px";
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();

        const success = document.execCommand("copy");
        document.body.removeChild(textArea);

        if (success) {
          setIsCopied(true);
          setTimeout(() => setIsCopied(false), 2000);
        }
        return success;
      }
    } catch {
      // console.error('Failed to copy to clipboard:', error);
      return false;
    }
  }, []);

  return { copyToClipboard, isCopied };
};

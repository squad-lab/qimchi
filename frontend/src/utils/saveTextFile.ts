/**
 * Save generated text as a file. The desktop app asks where through a native
 * dialog, since WebView2 drops downloads the page starts itself; a browser
 * downloads it. Resolves to the saved path in the desktop app, "" if the user
 * cancelled there, and null in a browser, where the location is not known.
 */
export const saveTextFile = async (
  filename: string,
  content: string,
  type = "application/json",
): Promise<string | null> => {
  const desktopSave = window.pywebview?.api?.save_text_file;
  if (desktopSave) return desktopSave(filename, content);

  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  return null;
};

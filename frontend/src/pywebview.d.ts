// Native APIs exposed by the pywebview desktop shell (window.pywebview).
// Present only in the desktop (pywebview/WebView2) build; absent in browser/Docker.
export {};

declare global {
  interface Window {
    pywebview?: {
      api: {
        /** Open the OS folder picker; resolves to the chosen path (or ""). */
        open_folder_dialog: () => Promise<string>;
        /** Open ~/.qimchi/qimchi_debug.log in a terminal that follows it live. */
        open_log_terminal: () => Promise<boolean>;
      };
    };
  }
}

// Native APIs exposed by the pywebview desktop shell (window.pywebview).
// Present only in the desktop (pywebview/WebView2) build; absent in browser/Docker.
import type { UpdateState } from "./stores/updateStore";

declare global {
  interface Window {
    pywebview?: {
      api: {
        /** Open the OS folder picker; resolves to the chosen path (or ""). */
        open_folder_dialog: () => Promise<string>;
        /** Open ~/.qimchi/qimchi_debug.log in a terminal that follows it live. */
        open_log_terminal: () => Promise<boolean>;
        /** Ask where to save a text file and write it; resolves to the path (or ""). */
        save_text_file: (filename: string, content: string) => Promise<string>;
        /** The launcher's update state; changes also arrive as `qimchi-update` events. */
        update_status?: () => Promise<UpdateState>;
        check_for_updates?: () => Promise<UpdateState>;
        /** Starts a background download; progress arrives as events. */
        download_update?: () => Promise<UpdateState>;
        /** Installs the downloaded update; the app closes. */
        install_update?: () => Promise<UpdateState>;
        remind_update_at_next_launch?: () => Promise<UpdateState>;
        dismiss_update_prompt?: () => Promise<UpdateState>;
      };
    };
  }

  interface WindowEventMap {
    "qimchi-update": CustomEvent<UpdateState>;
  }
}

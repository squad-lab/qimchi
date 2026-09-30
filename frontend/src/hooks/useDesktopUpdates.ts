import { useEffect } from "react";

import { useUpdateStore } from "../stores/updateStore";

/**
 * Follow the desktop launcher's update state. pywebview injects its API after
 * the page loads, so wait for `pywebviewready` when it is not there yet.
 */
export const useDesktopUpdates = () => {
  useEffect(() => {
    const { receive, refresh, setSupported } = useUpdateStore.getState();

    const connect = () => {
      if (!window.pywebview?.api?.update_status) return;
      setSupported(true);
      void refresh();
    };
    const onUpdate = (event: CustomEvent) => receive(event.detail);

    window.addEventListener("qimchi-update", onUpdate);
    window.addEventListener("pywebviewready", connect);
    connect();
    return () => {
      window.removeEventListener("qimchi-update", onUpdate);
      window.removeEventListener("pywebviewready", connect);
    };
  }, []);
};

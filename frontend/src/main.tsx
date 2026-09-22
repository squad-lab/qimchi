import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "@fontsource-variable/martian-mono";
import "@fontsource/fira-sans/latin-400.css";
import "@fontsource/fira-sans/latin-500.css";
import "@fontsource/fira-sans/latin-600.css";
import "@fontsource/fira-sans/latin-700.css";

// Local imports
import "./index.css";
import App from "./App.tsx";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Drop the inline splash once React has painted its first frame.
const splash = document.getElementById("qimchi-splash");
if (splash) {
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      splash.dataset.done = "1";
      splash.addEventListener("transitionend", () => splash.remove(), { once: true });
      window.setTimeout(() => splash.remove(), 600);
    }),
  );
}

import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "");
  const qimchiVersion = (
    env.QIMCHI_VERSION ||
    env.CI_COMMIT_TAG ||
    env.npm_package_version ||
    "unknown"
  ).replace(/^v/, "");

  return {
    plugins: [react()],

    define: {
      global: "globalThis",
      __QIMCHI_VERSION__: JSON.stringify(qimchiVersion),
    },

    resolve: {
      alias: {
        stream: "stream-browserify",
      },
    },

    build: {
      // Allow a larger single bundle without warnings.
      chunkSizeWarningLimit: 8000,
      // For debug
      // minify: false, // Disables minification for both JavaScript and CSS
    },
  };
});

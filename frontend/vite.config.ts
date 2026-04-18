import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],

  define: {
    global: "globalThis",
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
});
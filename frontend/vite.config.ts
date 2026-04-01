import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],

  define: {
    global: "globalThis",
  },

  // build: {
  // For debug
  //   minify: false, // Disables minification for both JavaScript and CSS
  // },
  resolve: {
    alias: {
      stream: "stream-browserify",
    },
  },
});
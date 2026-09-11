import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    // Unit and component tests live beside the source. e2e/ is Playwright's
    // and must stay out of this runner -- both define a global `test`, and
    // Playwright's needs a real browser.
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: ["e2e/**", "node_modules/**", "dist/**"],
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
    coverage: {
      provider: "v8",
      // What this runner is responsible for: pure logic.
      include: ["src/stores/**/*.ts", "src/utils/**/*.ts", "src/components/helpSearch.ts"],
      exclude: ["src/**/*.test.{ts,tsx}", "src/test-setup.ts", "src/**/*.d.ts"],
      reporter: ["text-summary", "lcovonly", "html"],
      reportsDirectory: "./coverage/unit",
      thresholds: {
        lines: 82,
        statements: 79,
        branches: 75,
        functions: 77,
      },
    },
  },
});

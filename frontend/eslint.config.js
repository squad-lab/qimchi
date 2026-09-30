import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "coverage"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // React Compiler is not enabled. Its extra safety rules reject the
      // established Plotly/ref integration even though it is valid runtime
      // React and checked by strict TypeScript.
      "react-hooks/incompatible-library": "off",
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
      // Plotly and browser-extension boundaries intentionally carry dynamic
      // values. Keep strict TypeScript while allowing explicit `any` there.
      "@typescript-eslint/no-explicit-any": "off",
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
    },
  },
);

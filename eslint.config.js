import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  { ignores: ["**/node_modules/", "**/coverage/", "**/dist/", "standards/"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  {
    // Node で実行するプレーン JS(bin / scripts)
    files: ["**/*.mjs", "packages/cli/bin/**/*.js"],
    languageOptions: {
      globals: { console: "readonly", process: "readonly" },
    },
  },
);

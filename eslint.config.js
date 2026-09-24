import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  { ignores: ["**/node_modules/", "**/coverage/", "**/dist/", "standards/", "release/"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      // node-diff3 は文字列を渡すと単語単位マージになり、行の途中でマージされた
      // 壊れたファイルを静かに書き出す。行配列で呼ぶ制約を merge3.ts に封じ込める。
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "node-diff3",
              message:
                "Import merge3() from ./merge3.js instead — node-diff3 must only be called with string[] (line arrays).",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["packages/core/src/merge3.ts"],
    rules: { "no-restricted-imports": "off" },
  },
  {
    // Node で実行するプレーン JS(bin / scripts)
    files: ["**/*.mjs", "packages/cli/bin/**/*.js"],
    languageOptions: {
      globals: { console: "readonly", process: "readonly", URL: "readonly" },
    },
  },
);

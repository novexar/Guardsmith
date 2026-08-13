import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/core/test/**/*.test.ts"],
    // process.chdir() を使う CLI テストがあるため forks プールを明示
    pool: "forks",
    coverage: {
      provider: "v8",
      include: ["packages/core/src/**/*.ts"],
      reporter: ["text", "lcov"],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
});

/**
 * GitHub Releases 配布用バンドルを release/ に生成する。
 * npm レジストリへ到達できない環境(閉域・egress制限)向けに、依存をすべて同梱した
 * guard.mjs + presets/ + standards/ を1つの tar.gz として配布する。
 * 使い方: node scripts/build-release-bundle.mjs && tar -C release -czf release/guardsmith-cli.tar.gz guardsmith-cli
 */
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const OUT = resolve(ROOT, "release/guardsmith-cli");

rmSync(resolve(ROOT, "release"), { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

await build({
  entryPoints: [resolve(ROOT, "packages/core/src/cli.ts")],
  outfile: resolve(OUT, "guard.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  // CJS 依存(tar 等)を ESM バンドルへ取り込むための require シム
  banner: {
    js: "import { createRequire } from 'node:module';const require = createRequire(import.meta.url);",
  },
  logLevel: "info",
});

cpSync(resolve(ROOT, "presets"), resolve(OUT, "presets"), { recursive: true });
cpSync(resolve(ROOT, "standards"), resolve(OUT, "standards"), { recursive: true });
cpSync(resolve(ROOT, "LICENSE"), resolve(OUT, "LICENSE"));
writeFileSync(
  resolve(OUT, "README.md"),
  `# GuardSmith CLI — offline bundle / オフラインバンドル

npm レジストリ不要の単一バンドルです。Node.js 20+ で実行します:
Self-contained bundle (no npm registry required). Run with Node.js 20+:

    node guard.mjs lint
    node guard.mjs new <dir>
    node guard.mjs sync --write

ドキュメント / Documentation: https://github.com/novexar/Guardsmith
`,
);
console.log(`release bundle: ${OUT}`);

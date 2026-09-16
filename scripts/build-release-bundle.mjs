/**
 * GitHub Releases 配布用バンドルを release/ に生成する。
 * npm レジストリへ到達できない環境(閉域・egress制限)向けに、依存をすべて同梱した
 * guard.mjs + presets/ + standards/ を1つの tar.gz として配布する。
 * 依存 OSS のライセンス全文を THIRD-PARTY-NOTICES.md として同梱する(MIT/ISC 等の再配布要件)。
 * 使い方: node scripts/build-release-bundle.mjs && tar -C release -czf release/guardsmith-cli.tar.gz guardsmith-cli
 */
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const OUT = resolve(ROOT, "release/guardsmith-cli");

rmSync(resolve(ROOT, "release"), { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const result = await build({
  entryPoints: [resolve(ROOT, "packages/core/src/cli.ts")],
  outfile: resolve(OUT, "guard.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  metafile: true,
  // CJS 依存(tar 等)を ESM バンドルへ取り込むための require シム
  banner: {
    js: "import { createRequire } from 'node:module';const require = createRequire(import.meta.url);",
  },
  logLevel: "info",
});

/**
 * metafile の入力パスから「実際にバンドルされたパッケージ」のルートディレクトリを導出する。
 * pnpm の実パス(node_modules/.pnpm/<pkg>@<ver>/node_modules/<pkg>/...)にも対応するため、
 * 最後に現れる node_modules/ セグメント直下(スコープ対応)をパッケージ名とみなす。
 * @param {string} inputPath metafile の input キー(ROOT からの相対パス)
 * @returns {{ name: string, root: string } | null}
 */
function packageFromInputPath(inputPath) {
  const normalized = inputPath.replaceAll("\\", "/");
  const marker = "node_modules/";
  const idx = normalized.lastIndexOf(marker);
  if (idx === -1) return null;
  const rest = normalized.slice(idx + marker.length);
  const segments = rest.split("/");
  const nameSegments = segments[0].startsWith("@") ? segments.slice(0, 2) : segments.slice(0, 1);
  if (nameSegments.length === 0 || nameSegments.some((s) => s === "")) return null;
  const name = nameSegments.join("/");
  const root = resolve(ROOT, normalized.slice(0, idx + marker.length) + name);
  return { name, root };
}

/**
 * パッケージルートから LICENSE / LICENCE(.md/.txt 等、大文字小文字ゆらぎ対応)の全文を読む。
 * @param {string} pkgRoot
 * @returns {string | null}
 */
function readLicenseText(pkgRoot) {
  const entries = readdirSync(pkgRoot, { withFileTypes: true });
  const candidates = entries
    .filter((e) => e.isFile() && /^licen[cs]e(\.(md|txt|markdown))?$/i.test(e.name))
    .map((e) => e.name)
    .sort();
  if (candidates.length === 0) return null;
  return readFileSync(resolve(pkgRoot, candidates[0]), "utf8").trim();
}

/**
 * パッケージルート起点で依存パッケージのルートを解決する(pnpm のシンボリックリンク構造対応)。
 * exports で package.json を公開しないパッケージ向けにエントリ解決へフォールバックする。
 * @param {string} fromRoot 依存元パッケージのルート
 * @param {string} depName 依存パッケージ名
 * @returns {string | null}
 */
function resolveDependencyRoot(fromRoot, depName) {
  const req = createRequire(resolve(fromRoot, "package.json"));
  try {
    return dirname(req.resolve(`${depName}/package.json`));
  } catch {
    try {
      return packageFromInputPath(req.resolve(depName))?.root ?? null;
    } catch {
      return null;
    }
  }
}

/**
 * バンドルされたパッケージの一覧(name@version で重複除去、名前順)を収集する。
 * metafile 検出分に加え、各パッケージの runtime dependencies を再帰的に辿る。
 * tar のように推移的依存を事前バンドルした dist を配布するパッケージでは、依存コードが
 * metafile に現れないままバンドルへ同梱されるため、依存グラフ側からも補完する。
 * @param {Record<string, unknown>} inputs result.metafile.inputs
 * @returns {{ name: string, version: string, license: string, licenseText: string | null }[]}
 */
function collectBundledPackages(inputs) {
  const byKey = new Map();
  const visitedRoots = new Set();
  const queue = [];
  for (const inputPath of Object.keys(inputs)) {
    const pkg = packageFromInputPath(inputPath);
    if (pkg) queue.push(pkg.root);
  }
  while (queue.length > 0) {
    const root = queue.shift();
    if (visitedRoots.has(root)) continue;
    visitedRoots.add(root);
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
    } catch {
      console.warn(`third-party notices: package.json not readable at ${root}`);
      continue;
    }
    const key = `${manifest.name}@${manifest.version}`;
    if (!byKey.has(key)) {
      byKey.set(key, {
        name: String(manifest.name ?? "unknown"),
        version: String(manifest.version ?? "unknown"),
        license: String(manifest.license ?? "unknown"),
        licenseText: readLicenseText(root),
      });
    }
    for (const depName of Object.keys(manifest.dependencies ?? {})) {
      const depRoot = resolveDependencyRoot(root, depName);
      if (depRoot === null) {
        console.warn(`third-party notices: cannot resolve ${depName} from ${manifest.name}`);
        continue;
      }
      queue.push(depRoot);
    }
  }
  return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * THIRD-PARTY-NOTICES.md の本文を生成する。
 * @param {{ name: string, version: string, license: string, licenseText: string | null }[]} packages
 * @returns {string}
 */
function renderNotices(packages) {
  const sections = packages.map((pkg) => {
    const heading = `## ${pkg.name}@${pkg.version} (${pkg.license})`;
    const body =
      pkg.licenseText === null
        ? `License: ${pkg.license} — license text not found in package.`
        : "```\n" + pkg.licenseText + "\n```";
    return `${heading}\n\n${body}\n`;
  });
  return [
    "# Third-Party Notices",
    "",
    "This bundle redistributes the following open-source packages. / 本バンドルは以下の OSS を同梱して再配布しています。",
    "",
    ...sections,
  ].join("\n");
}

const bundledPackages = collectBundledPackages(result.metafile.inputs);
if (bundledPackages.length === 0) {
  console.warn("third-party notices: no bundled node_modules packages detected");
}
const missingLicense = bundledPackages.filter((pkg) => pkg.licenseText === null);
for (const pkg of missingLicense) {
  console.warn(`third-party notices: license text not found for ${pkg.name}@${pkg.version}`);
}
writeFileSync(resolve(OUT, "THIRD-PARTY-NOTICES.md"), renderNotices(bundledPackages));
console.log(
  `third-party notices: ${bundledPackages.length} packages (${bundledPackages
    .map((pkg) => `${pkg.name}@${pkg.version}`)
    .join(", ")})`,
);

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

同梱 OSS のライセンスは THIRD-PARTY-NOTICES.md を参照 / Bundled OSS licenses: see THIRD-PARTY-NOTICES.md

ドキュメント / Documentation: https://github.com/novexar/Guardsmith
`,
);
console.log(`release bundle: ${OUT}`);

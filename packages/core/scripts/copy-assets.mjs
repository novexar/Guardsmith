/**
 * prepack: リポジトリルートの presets/ と standards/ をパッケージ内へ同梱する。
 * 公開パッケージでは ASSET_ROOT がパッケージルートに解決される(src/paths.ts)。
 */
import { cpSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(pkgRoot, "../..");

for (const dir of ["presets", "standards"]) {
  const dest = resolve(pkgRoot, dir);
  rmSync(dest, { recursive: true, force: true });
  cpSync(resolve(repoRoot, dir), dest, { recursive: true });
  console.log(`copied ${dir}/ into package`);
}

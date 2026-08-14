/**
 * アセットルート解決 — presets/ と standards/ の探索基点。
 * 開発時(workspace): packages/core/src → ../../.. = リポジトリルート
 * 公開パッケージ: <pkg>/dist → .. = パッケージルート(prepack で presets/standards を同梱)
 * Releases バンドル: guard.mjs と同階層に presets/standards を同梱 → HERE 自身
 */
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

const CANDIDATES = [resolve(HERE, "../../.."), resolve(HERE, ".."), HERE];

export const ASSET_ROOT =
  CANDIDATES.find((c) => existsSync(resolve(c, "presets"))) ?? CANDIDATES[0];

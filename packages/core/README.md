# @guardsmith/core

**GuardSmith のルールエンジン + CLI 本体。** ポリシー(YAML)のスキーマ検証、8種の check
(file-exists / file-absent / content-match / max-lines / frontmatter / json-path / drift / secret-scan)、
`github:` リモート参照の解決(タグ固定・キャッシュ・パストラバーサル対策)、SARIF 出力を提供します。

_English follows Japanese._

> **CLI として使う場合は [`@guardsmith/cli`](https://www.npmjs.com/package/@guardsmith/cli) を
> インストールしてください**(本パッケージはエンジンです。`@guardsmith/cli` の実体は本パッケージの
> `runCli()` への薄いラッパーです)。

## ライブラリとして使う

```ts
import { parsePolicy, runLint, formatConsole } from "@guardsmith/core";
import { parse } from "yaml";
import { readFileSync } from "node:fs";

const parsed = parsePolicy(parse(readFileSync("guard.policy.yaml", "utf8")));
if (parsed.ok) {
  const result = await runLint(parsed.policy, process.cwd());
  console.log(formatConsole(result));
}
```

主なエクスポート:

| エクスポート                            | 説明                                                            |
| --------------------------------------- | --------------------------------------------------------------- |
| `parsePolicy` / `PolicyDocument`        | ポリシーのスキーマ検証(zod。未知キーは拒否)                     |
| `Rule` / `Exemption` / `Severity`       | スキーマ部品(利用側で独自ポリシーを合成する際に再利用可)        |
| `runLint` / `formatConsole` / `toSarif` | 検査の実行と出力                                                |
| `loadPolicy`                            | `extends`(preset: / file: / github:)の多段解決込みの読み込み    |
| プリセット同梱                          | `presets/baseline.yaml`(生成PJ向け)/ `standards/`(配布マスター) |

## ドキュメント

- リポジトリ / 導入ガイド: https://github.com/novexar/Guardsmith

---

# English

**The GuardSmith rule engine + CLI core.** Provides policy (YAML) schema validation,
8 check types (file-exists / file-absent / content-match / max-lines / frontmatter /
json-path / drift / secret-scan), `github:` remote reference resolution (tag-pinned,
cached, path-traversal hardened), and SARIF output.

> **If you want the CLI, install [`@guardsmith/cli`](https://www.npmjs.com/package/@guardsmith/cli)
> instead** — it is a thin wrapper around this package's `runCli()`.

## Use as a library

```ts
import { parsePolicy, runLint, formatConsole } from "@guardsmith/core";

const parsed = parsePolicy(yamlDocument);
if (parsed.ok) {
  const result = await runLint(parsed.policy, process.cwd());
  console.log(formatConsole(result));
}
```

Key exports: `parsePolicy` / `PolicyDocument` (strict zod schema), reusable schema parts
(`Rule`, `Exemption`, `Severity`), `runLint` / `formatConsole` / `toSarif`, and `loadPolicy`
(multi-level `extends` resolution across `preset:` / `file:` / `github:` refs). The package
ships `presets/baseline.yaml` and the `standards/` distribution master.

## Documentation

- Repository / getting started: https://github.com/novexar/Guardsmith

## License

Apache-2.0

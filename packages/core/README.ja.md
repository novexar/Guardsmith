<p align="center">
  <img src="https://raw.githubusercontent.com/novexar/Guardsmith/main/assets/logo.png" width="96" alt="GuardSmith logo">
</p>

<h1 align="center">@guardsmith/core</h1>

<p align="center">
  <a href="https://github.com/novexar/Guardsmith">GuardSmith</a> を支えるルールエンジン —
  ポリシー検証、9 種の check、タグ固定リモート解決、SARIF 出力。
</p>

<p align="center">
  <a href="https://github.com/novexar/Guardsmith/blob/main/packages/core/README.md">English</a> | 日本語
</p>

---

> **CLI をお探しですか?** 代わりに
> [`@guardsmith/cli`](https://www.npmjs.com/package/@guardsmith/cli) をインストールしてください —
> 本パッケージの薄いラッパーです。`@guardsmith/core` を直接インストールするのは、
> エンジンを自作ツールに組み込みたい場合のみです。

## 提供するもの

- **ポリシースキーマ** — `guard.policy.yaml` / preset YAML の厳格な zod 検証
  (未知のキーは拒否。typo はエラーになる)
- **9 種の check** — file-exists / file-absent / content-match / max-lines / import-budget /
  frontmatter / json-path / drift / secret-scan。`import-budget` は `CLAUDE.md` と
  `@path` インポート先を合わせた常駐量を測る(トークン数は `chars / 4` の粗い目安。
  詳細は [メイン README](https://github.com/novexar/Guardsmith/blob/main/README.ja.md))
- **リモート解決** — `extends: github:owner/repo[//path]@tag`。タグ固定必須、
  ローカルキャッシュ、多段合成、循環検出、パストラバーサル対策
- **走査範囲** — 既定で `.gitignore`(入れ子も)に追従し `.git/` を常に除外するため、
  対象は「コミットされうるファイル」に限られる。ポリシーのトップレベル `ignore`(glob)で
  さらに除外でき、除外対象は結果フィルタではなく走査の時点で枝刈りされる
- **レポート** — コンソールフォーマッタと SARIF 2.1.0 出力
- 標準ルールセット(`presets/baseline.yaml`、`presets/frontend.yaml`)と
  `guard new` が使う標準マスター(`standards/`)を同梱

## ライブラリとして使う

```ts
import { parsePolicy, runLint, formatConsole } from "@guardsmith/core";
import { parse } from "yaml";
import { readFileSync } from "node:fs";

const parsed = parsePolicy(parse(readFileSync("guard.policy.yaml", "utf8")));
if (parsed.ok) {
  // 第4引数 { gitignore: false } で全走査に戻せる(= CLI の --no-gitignore)
  const result = await runLint(parsed.policy, process.cwd());
  console.log(formatConsole(result));
  process.exitCode = result.ok ? 0 : 1;
}
```

主なエクスポート: `parsePolicy` / `PolicyDocument`、独自のポリシードキュメントを組み立てる
ための再利用可能なスキーマ部品(`Rule`、`Exemption`、`Severity`)、`runLint` /
`formatConsole` / `toSarif`、`loadPolicy`(`preset:` / `file:` / `github:` 参照をまたぐ
多段 `extends` 解決)、`createGlobScope` / `globFiles`(`ignore` と `.gitignore` を適用する
共通のファイル走査)。

## ドキュメント

- はじめに・コンセプト: https://github.com/novexar/Guardsmith
- 3層ポリシー設計: https://github.com/novexar/Guardsmith/blob/main/docs/LAYERING.ja.md

## ライセンス

Apache-2.0

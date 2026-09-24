<p align="center">
  <img src="https://raw.githubusercontent.com/novexar/Guardsmith/main/assets/logo.png" width="96" alt="GuardSmith logo">
</p>

<h1 align="center">@guardsmith/core</h1>

<p align="center">
  <a href="https://github.com/novexar/Guardsmith">GuardSmith</a> を支えるルールエンジン —
  ポリシー検証、10 種の check、タグ固定リモート解決、標準の 3-way マージ、SARIF 出力。
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
- **10 種の check** — file-exists / file-absent / content-match / max-lines / import-budget /
  frontmatter / json-path / drift / drift3 / secret-scan。`import-budget` は `CLAUDE.md` と
  `@path` インポート先を合わせた常駐量を測る(トークン数は `chars / 4` の粗い目安。
  詳細は [メイン README](https://github.com/novexar/Guardsmith/blob/main/README.ja.md))。
  `drift3`(`with: { source, paths }`)は PJ の現行タグと `source` のタグの間の標準変更のうち、
  まだ取り込まれていないものを報告する
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
ための再利用可能なスキーマ部品(`Rule`、`Exemption`、`Severity`)、
`runLint(policy, root, now?, { gitignore })` / `formatConsole` / `toSarif`、
`planSync(policy, root, { gitignore })`、`loadPolicy`(`preset:` / `file:` / `github:` 参照を
またぐ多段 `extends` 解決。`rules` は id をキーに後勝ちでマージし、`exemptions` と
トップレベルの `ignore` は連結)、`createGlobScope` / `globFiles`(`ignore` と `.gitignore` を
適用する共通のファイル走査)。

`gitignore` の既定はどちらも `true` です。`{ gitignore: false }` を渡すと全走査に戻ります
(CLI の `--no-gitignore` 相当)。`runLint` の第3引数は exemption の期限判定に使う時刻なので、
再現性が必要な場合は明示的に渡してください。

### 標準の 3-way マージ

`guard sync` / `guard bump` の内部機構もエクスポートしています:

| エクスポート                                        | 概要                                                                                                                                                                                 |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `loadVars(rootDir): VarsDocument \| null`           | PJ の `guardsmith.vars.yaml`(`{ version, standards, vars }`)を読んで検証する。ファイルが無ければ `null`、壊れていれば throw                                                          |
| `normalizeMaster(text, { vars, stamp? })`           | マスターテンプレート 1 件を「初期化済み PJ の状態」へ正規化する。CRLF→LF、`gen:` コメントと未初期化警告の除去、スタンプ書き換え、プレースホルダ描画。戻り値は `{ text, unresolved }` |
| `merge3(ours, base, theirs, { markers?, labels? })` | 行単位の 3-way マージ。戻り値は `{ merged?, conflicts, eol, changed }`。衝突があり `markers` 未指定なら `merged` は無し。入力の EOL は復元される                                     |
| `planSync3(sources, rootDir, vars, options?)`       | `Sync3Plan` を組み立てる(`merge` / `create` / `conflict` / `skip-deleted` / `removed` / `unchanged` の `actions` と、`localOnly`・`conflicted`・`baseTag`・`nextTag`)                |
| `applySync3(plan, rootDir, vars)`                   | 計画を書き出し、`guardsmith.vars.yaml` と `CLAUDE.md` スタンプを `nextTag` へ進める。衝突がある計画では `conflictMarkers` 指定時を除き**何も書かない**                               |
| `formatSync3Plan(plan, write)`                      | 計画をコンソール向けに整形する(dry-run と適用後で同じフォーマッタ)                                                                                                                   |

`planSync3` には `drift3` ルール 1 本につき 1 件の `Drift3Source`
(`{ ruleId, paths, baseRoot, headRoot, baseTag, headTag }`)を渡します。
2 つのマスターのルートはローカルディレクトリに解決済みである必要があり、
取得方法は呼び出し側が決めます。

## ドキュメント

- はじめに・コンセプト: https://github.com/novexar/Guardsmith
- 3層ポリシー設計: https://github.com/novexar/Guardsmith/blob/main/docs/LAYERING.ja.md

## ライセンス

Apache-2.0

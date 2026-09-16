<p align="center">
  <img src="https://raw.githubusercontent.com/novexar/Guardsmith/main/assets/logo.png" width="96" alt="GuardSmith logo">
</p>

<h1 align="center">@guardsmith/cli</h1>

<p align="center">
  すべてのリポジトリに同じ AI 開発標準を配り、守られているかを<b>機械検証</b>する。<br>
  <a href="https://github.com/novexar/Guardsmith">GuardSmith</a> の <code>guard</code> コマンド。
</p>

<p align="center">
  <a href="https://github.com/novexar/Guardsmith/blob/main/packages/cli/README.md">English</a> | 日本語
</p>

---

GuardSmith は AI 開発標準(`CLAUDE.md`・agents・skills)を、ESLint がコードスタイルを
扱うのと同じ方法——**配布できる config + linter**——で扱います。本パッケージはその CLI です。

Node.js 20+ が必要です。

## インストール

```bash
npx @guardsmith/cli <command>      # 単発実行
# または
pnpm add -D @guardsmith/cli        # PJ ごとに導入。以後: pnpm guard <command>
```

## クイックスタート

```bash
# 新規プロジェクト — 標準マスターから展開
# (CLAUDE.md・agents・skills・docs・Docker ローカル CI・デザイン仕様)
npx @guardsmith/cli new my-project

# 既存プロジェクト — ポリシーファイルのみ生成
npx @guardsmith/cli init

# 検証 (exit 1 = 違反あり: 未初期化テンプレ、
# 契約見出しの破壊、資格情報の混入、drift など)
npx @guardsmith/cli lint

# 標準マスターからの乖離(drift)を表示し、復元する
npx @guardsmith/cli sync           # dry-run
npx @guardsmith/cli sync --write   # 復元(PJ 固有セクションは保全)

# ルールの説明 / バージョン表示
npx @guardsmith/cli explain claude-md/thin-diff
npx @guardsmith/cli version
```

`guard new` の後は Claude Code でプロジェクトを開いてください — 同梱の `init-project`
スキルがインタビューを行い、テンプレートを具体化します。初期化が本当に完了すると
`guard lint` が PASS します。

## ポリシーの要点

```yaml
# guard.policy.yaml
version: 1
target: claude-code
extends:
  - github:novexar/guardsmith//presets/baseline.yaml@v0.5.1 # tag pinning is mandatory
  # Projects with a frontend also add:
  # - github:novexar/guardsmith//presets/frontend.yaml@v0.5.1
rules: [] # add or override (redefining an id overrides it)
exemptions: [] # time-boxed waivers: reason + approved_by + expires required
```

`extends` は OSS baseline → private 組織 overlay → PJ ごとのポリシー、と合成されます。
private リポジトリは `GITHUB_TOKEN` 環境変数で取得されるため、組織固有ルールが
GitHub の外に出ることはありません。期限切れの例外(exemption)は error として表面化します
— 黙って永久に免除されることはありません。

## CI での強制

[GuardSmith Lint Action](https://github.com/marketplace/actions/guardsmith-lint) を
workflow に 1 行追加:

```yaml
- uses: novexar/Guardsmith@v0.5.1
```

違反した PR はサマリコメントと SARIF レポート付きで失敗します。閉域網などの環境では
[GitHub Releases](https://github.com/novexar/Guardsmith/releases) に添付された
自己完結バンドルのみで実行できます(`source: release` / `node guard.mjs`)—
npm レジストリへのアクセスは不要です。

## ドキュメント

- はじめに・コンセプト: https://github.com/novexar/Guardsmith
- 3層ポリシー設計: https://github.com/novexar/Guardsmith/blob/main/docs/LAYERING.ja.md
- 標準更新への追随(リリースごとのチェックリスト): https://github.com/novexar/Guardsmith/tree/main/docs/migration

## ライセンス

Apache-2.0

サードパーティライセンス: 依存パッケージは npm 経由で各自のライセンスに従います。
オフライン用リリースバンドルには `THIRD-PARTY-NOTICES.md` を同梱しています。

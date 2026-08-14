# @guardsmith/cli

**AI開発標準の配布と統制を1つにしたガバナンスツールキット GuardSmith の CLI(`guard` コマンド)。**
標準(CLAUDE.md / agents / skills のテンプレート)を配り、守られているかを機械検証します —
「ESLint + 公式config」の関係を AI コーディング標準に対して提供します。

_English follows Japanese._

## インストール

```bash
npx @guardsmith/cli <command>      # 都度実行
# または
pnpm add -D @guardsmith/cli        # プロジェクトに導入して pnpm guard <command>
```

Node.js 20 以上が必要です。

## クイックスタート

```bash
# 新規プロジェクト: 標準雛形(CLAUDE.md / agents / skills / docs)から展開
npx @guardsmith/cli new my-project

# 既存プロジェクト: 検証ポリシーだけ生成
npx @guardsmith/cli init

# 検証(プレースホルダ残置・契約見出し欠落・資格情報混入などを検出。exit 1 = error)
npx @guardsmith/cli lint

# 配布ファイルのマスター乖離(drift)を確認 → 復元
npx @guardsmith/cli sync           # dry-run
npx @guardsmith/cli sync --write   # 適用

# ルールの意図を表示
npx @guardsmith/cli explain claude-md/thin-diff
```

## ポリシー(guard.policy.yaml)

```yaml
version: 1
target: claude-code
extends:
  - github:novexar/guardsmith//presets/baseline.yaml@v0.2.1 # タグ固定必須
rules: [] # 追加・上書き(同idで再定義=上書き)
exemptions: [] # 期限付き例外(expires + approved_by 必須。期限切れは error)
```

`extends: github:owner/repo[//path]@tag` により OSS baseline → 組織 private overlay → 各プロジェクト
の3層合成ができます。private リポジトリは `GITHUB_TOKEN` 環境変数で取得します。

## CI(GitHub Action)

```yaml
# .github/workflows/guard.yml
name: GuardSmith
on: [pull_request]
permissions:
  contents: read
  pull-requests: write
jobs:
  guard:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: novexar/Guardsmith@v0.4.0
```

違反があるとジョブが失敗し、レポートが Job Summary と PR コメントに載ります(SARIF 出力対応)。

## ドキュメント

- リポジトリ / 導入ガイド: https://github.com/novexar/Guardsmith
- 3層 overlay 設計: https://github.com/novexar/Guardsmith/blob/main/docs/LAYERING.md

---

# English

**CLI (`guard`) for GuardSmith — a governance toolkit that unifies distribution and
enforcement of AI development standards.** It distributes standards (templates for
`CLAUDE.md` / agents / skills) and machine-verifies that projects follow them — the
"ESLint + official config" relationship, applied to AI coding standards.

## Install

```bash
npx @guardsmith/cli <command>      # one-off
# or
pnpm add -D @guardsmith/cli        # per project, then: pnpm guard <command>
```

Requires Node.js 20+.

## Quick start

```bash
npx @guardsmith/cli new my-project   # scaffold a new project from the standards master
npx @guardsmith/cli init             # existing project: generate guard.policy.yaml only
npx @guardsmith/cli lint             # verify (exit 1 = errors found)
npx @guardsmith/cli sync             # show drift against the master (dry-run)
npx @guardsmith/cli sync --write     # repair drift
npx @guardsmith/cli explain <rule>   # explain a rule
```

## Policy (guard.policy.yaml)

`extends: github:owner/repo[//path]@tag` chains OSS baseline → private org overlay →
per-project policy (remote refs must pin a tag; private repos are fetched with the
`GITHUB_TOKEN` environment variable). Exemptions require `expires` + `approved_by`,
and expired exemptions surface as errors.

## CI enforcement

Use the GitHub Action `novexar/Guardsmith@v0.4.0` — on violations the job fails, the
report lands in the Job Summary and a PR comment, and a SARIF report is produced.

## Documentation

- Repository / getting started: https://github.com/novexar/Guardsmith
- 3-layer overlay design: https://github.com/novexar/Guardsmith/blob/main/docs/LAYERING.md

## License

Apache-2.0

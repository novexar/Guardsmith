# Contributing to GuardSmith

GuardSmith への貢献に興味を持っていただきありがとうございます。

## 開発環境

- Node.js >= 20 / pnpm >= 10

```bash
pnpm install
pnpm test              # vitest
pnpm test:coverage     # カバレッジ (80% ゲート)
pnpm typecheck         # tsc strict
pnpm lint              # eslint + prettier --check
pnpm guard lint        # セルフ検査 (dogfooding)
```

## 変更の流れ

1. Issue を立てて方針を合意する(小さな修正は PR 直行で可)
2. `develop` 起点で `feature/<topic>` または `fix/<topic>` ブランチを作成(`feature/*` → `develop` → `main`)
3. テストを先に書く(TDD)。カバレッジ 80% 以上を維持
4. Conventional Commits 形式でコミット(`feat:` / `fix:` / `docs:` / `test:` / `chore:` など)
5. PR を作成。CI(lint / typecheck / test / guard lint)が全て GREEN であること

## CI(ハイブリッド方式 — docs/decisions/0001-hybrid-ci.md)

- **PR 前に `make ci`(Docker ローカル CI)の通過が必須**。lint / typecheck / test:coverage /
  guard lint を Docker コンテナ内で一括実行し、結果 JSON を `.guardsmith/ci-results/` に出力する
  (前提: GNU make + bash + Docker。Windows は Git Bash / WSL から実行)
- **外部コントリビュータ(fork からの PR)** は GitHub Actions(External PR CI)が同じ検証を
  自動実行するため、Docker 環境が無くても PR を送れる(ローカルで `pnpm lint` などを
  個別実行しての事前確認は推奨)
- メンテナ自身(同一リポジトリのブランチ)の PR では GitHub Actions は実行されない

## ルール追加・変更時の注意

- `presets/baseline.yaml` のルールを変更する場合、対応する `standards/` テンプレートと
  テストフィクスチャを必ず同期させてください
- `standards/` は配布マスターです。`{{PLACEHOLDER}}` や `gen:` コメントは意図的なものです
- リモート参照(`github:`)はタグ固定が必須です。この制約を緩める変更は受け付けません

## ライセンス

貢献されたコードは [Apache-2.0](LICENSE) の下でライセンスされます。

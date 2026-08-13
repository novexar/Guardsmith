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
2. `feature/<topic>` または `fix/<topic>` ブランチを作成
3. テストを先に書く(TDD)。カバレッジ 80% 以上を維持
4. Conventional Commits 形式でコミット(`feat:` / `fix:` / `docs:` / `test:` / `chore:` など)
5. PR を作成。CI(lint / typecheck / test / guard lint)が全て GREEN であること

## ルール追加・変更時の注意

- `presets/baseline.yaml` のルールを変更する場合、対応する `standards/` テンプレートと
  テストフィクスチャを必ず同期させてください
- `standards/` は配布マスターです。`{{PLACEHOLDER}}` や `gen:` コメントは意図的なものです
- リモート参照(`github:`)はタグ固定が必須です。この制約を緩める変更は受け付けません

## ライセンス

貢献されたコードは [Apache-2.0](LICENSE) の下でライセンスされます。

# CLAUDE.md — GuardSmith

> AI開発標準の配布と統制を1つにしたガバナンスツールキット(OSS)。
> 本リポジトリ自身も `guard lint`(presets/self.yaml)でセルフ検査する(dogfooding)。

## プロジェクト概要

- **オーナー**: Novexar
- **リポジトリ**: novexar/Guardsmith(単一システム・pnpm workspace)
- **目的**: AIコーディング標準(CLAUDE.md / agents / skills)の配布と機械検証。「ESLint + 公式config」の関係をAI開発標準に対して提供する
- **ドキュメント言語**: 原則 日本語(技術用語・コード・識別子は英語のまま)

## 技術スタック

| 層              | 採用技術                                      |
| --------------- | --------------------------------------------- |
| 言語/ランタイム | TypeScript (strict) / Node.js >= 20           |
| パッケージ管理  | pnpm workspace                                |
| スキーマ検証    | zod                                           |
| テスト          | vitest + @vitest/coverage-v8(80%ゲート)       |
| Lint/Format     | eslint (flat config) + prettier               |
| CI              | GitHub Actions(lint/typecheck/test/self-lint) |

## よく使うコマンド

| 目的       | コマンド           |
| ---------- | ------------------ |
| 依存導入   | pnpm install       |
| テスト     | pnpm test          |
| カバレッジ | pnpm test:coverage |
| 型チェック | pnpm typecheck     |
| Lint       | pnpm lint          |
| 整形       | pnpm format        |
| セルフ検査 | pnpm guard lint    |

## ブランチ戦略

```
main                     ← リリースライン。タグ vX.Y.Z で配布(リモート参照はタグ固定)。
└── feature/<topic>      ← 機能開発。PR で main へ。
└── fix/<topic>          ← バグ修正。PR で main へ。
```

- PR は CI(lint / typecheck / test+coverage / guard lint)全GREENでのみマージ。

## PJ固有ルール

- **standards/ は配布マスター**: プレースホルダ(二重波括弧)や `gen:` コメントを含むのが正。整形・検査の対象外(.prettierignore / eslint ignores / self.yaml の設計を壊さない)
- **baseline.yaml とテンプレートの同期**: presets/baseline.yaml のルール変更時は standards/ テンプレートとテストフィクスチャを必ず同期させる
- **タグ固定必須**: リモート参照(`github:`)はタグ固定(@vX.Y.Z)。この制約を緩めない
- **セキュリティ**: tarball展開等のリモート取得コードはパストラバーサル対策テストを必須とする
- **exemptions は期限必須**: 期限切れ例外が error として表面化する設計を壊さない
- **迷う仕様判断**: docs/decisions-needed.md に選択肢+推奨を記録して人間に確認する

## 詳細ドキュメント

- 3層overlay設計: @docs/LAYERING.md

<!-- standards: novexar/guardsmith v0.2.1 -->

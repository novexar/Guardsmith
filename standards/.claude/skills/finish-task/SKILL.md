---
name: finish-task
description: 実装完了後に品質ゲートを通し PR を作成する。Lint/Test/Build 検証 → コミット → feature/bug → 起点ブランチへの PR 作成(Closes #<issue>)までを標準手順で行う。
---

# finish-task — PR 作成ワークフロー

Novexar 標準の PR 手順。最上位ルールは `/CLAUDE.md`。

## 手順

1. **セルフ品質ゲート(PR 前必須)**
   - 実行コマンドは **CLAUDE.md「よく使うコマンド」表に従う**(Lint / 型チェック / テスト / ビルド)。
   - 失敗があれば修正してから次へ。テストカバレッジ 80%+ を確認。

2. **コミット**
   - 規約: `<type>: <要約>`(type: feat | fix | refactor | docs | test | chore | perf | ci)、本文に `Refs: #<issue>`。
   - デバッグ出力・秘密情報が残っていないか確認。

3. **プッシュ**
   ```
   git push -u origin <branch>
   ```

4. **PR 作成(担当エンジニアが作成)**
   - ベース: CLAUDE.md「ブランチ戦略」の起点ブランチ / 比較: `feature-<issue>` or `bug-<issue>`。
   - テンプレ(`.github/PULL_REQUEST_TEMPLATE.md`)に沿って変更概要・テスト計画を記載。
   - 本文に `Closes #<issue番号>` を含める。
   - `gh pr create --base <起点ブランチ> --fill`

5. **レビュー依頼**
   - PM へレビュー依頼。CRITICAL/HIGH 指摘は修正必須、差戻し対応。

## 昇格 PR(PM が実施)
- 起点ブランチ → 統合ブランチ、統合ブランチ → `main` の PR は PM が作成。
  `main` へのマージはオーナー確認後に行う。

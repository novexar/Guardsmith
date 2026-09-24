---
name: finish-task
description: 実装完了後に品質ゲートを通し PR を作成する。Lint/Test/Build 検証 → コミット → feature/bug → 起点ブランチへの PR 作成(Closes #<issue>)までを標準手順で行う。
---

# finish-task — PR 作成ワークフロー

Novexar 標準の PR 手順。最上位ルールは `/CLAUDE.md`。

## 手順

1. **過剰設計チェック(品質ゲート前)**
   - `/ponytail-review` で差分の過剰設計(不要な抽象化・自作コード・先回り実装)を確認する。
   - 指摘があれば修正してから次へ進む。テスト・境界検証・セキュリティ・a11y は削減対象外。

2. **セルフ品質ゲート(PR 前必須)**
   - `make ci`(Docker ローカル CI)を実行する。**失敗したらタスク完了扱いにせず**、修正して再実行する。
   - 結果 JSON が `.guardsmith/ci-results/`(latest.json)に出力されることを確認する(詳細: docs/CI_CD.md)。
   - 個別コマンドの内訳は CLAUDE.md「よく使うコマンド」表を参照(Docker CI が正)。テストカバレッジ 80%+ を確認。

3. **作業状態の更新**
   - `.guardsmith/state/<issue番号>.md` を**現在の状態に上書き更新**する(日誌として追記しない)。
   - 記録項目と運用は `docs/DEVELOPMENT_WORKFLOW.md`「文脈管理 — 作業状態の最小記録」に従う。
   - `.guardsmith/` は `.gitignore` 済み。コミットしない。

4. **コミット**
   - 規約: `<type>: <要約>`(type: feat | fix | refactor | docs | test | chore | perf | ci)、本文に `Refs: #<issue>`。
   - デバッグ出力・秘密情報が残っていないか確認。
   - `git status` で `.guardsmith/` と `.claude/settings.local.json` がステージに含まれていないことを確認する
     (CI 結果 JSON はリポジトリ名・SHA 等の PJ 固有情報を含むためコミット禁止。含まれていたら .gitignore を確認)。

5. **プッシュ**
   ```
   git push -u origin <branch>
   ```

6. **PR 作成(担当エンジニアが作成)**
   - ベース: CLAUDE.md「ブランチ戦略」の起点ブランチ / 比較: `<type>/<issue番号>-<slug>`(`start-task` スキルの命名)。
   - テンプレ(`.github/PULL_REQUEST_TEMPLATE.md`)に沿って変更概要・テスト計画を記載。
   - 本文に `Closes #<issue番号>` を含める。
   - `gh pr create --base <起点ブランチ> --fill`

7. **QA レビュー依頼**
   - **PM 経由で `qa-engineer`(実装者から独立した QA)へ依頼する**。コードレビューと動作・受入検証の両方を受ける。
   - 報告形式は `.claude/agents/qa-engineer.md` の定義に従う(対象コミット・確認項目・実行コマンドと結果・未実施・未解決指摘・合否)。
   - **CRITICAL/HIGH 指摘は修正必須**。修正後は**同じ QA が指摘と影響範囲を再確認**する。
   - 受入条件を満たした後に見つかった追加改善は、この PR に足さず別 Issue にする。

## 昇格 PR(PM が実施)
- 起点ブランチ → 統合ブランチ、統合ブランチ → `main` の PR は PM が作成。
  `main` へのマージはオーナー確認後に行う。

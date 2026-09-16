---
name: start-task
description: GitHub Issue から作業を着手する。`start-task #<issue番号>` で呼び出し、Issue 確認 → 開発ブランチ最新化 → <type>/<issue番号>-<slug> ブランチ作成までを標準手順で行う。新機能・バグ修正・chore の着手時に使用。
---

# start-task — Issue 着手ワークフロー

Novexar 標準の着手手順。最上位ルールは `/CLAUDE.md`(特に「ブランチ戦略」)。

## 入力

`start-task #<issue番号>`(例: `start-task #142`)。Issue 番号は必須。
番号なしで呼ばれた場合は対象 Issue を確認してから進める(Issue 無しの着手は禁止)。

## 手順

1. **Issue 確認**
   - `gh issue view <番号>` で取得し、type ラベル(type:feature / type:bug / type:chore)と
     本文の「背景 / 受入基準 / スコープ外」(`.github/ISSUE_TEMPLATE/` の固定構造)を確認。
   - Issue が無ければ着手禁止。先に `.github/ISSUE_TEMPLATE/` で起票する。

2. **起点ブランチの最新化**
   - 起点ブランチは CLAUDE.md「ブランチ戦略」の定義に従う
     (モノレポなら `develop-<system-slug>`、単一システムなら `develop`)。
   ```
   git fetch origin
   git switch <起点ブランチ>
   git pull origin <起点ブランチ>
   ```
   - モノレポで `develop-<system-slug>` が無い場合は `new-system` スキルで作成する。

3. **作業ブランチ作成**
   - 命名: **`<type>/<issue番号>-<slug>`**(例: `feature/142-preset-loader`)
     - `<type>`: Issue の type ラベルから決定(type:feature → `feature`、type:bug → `bug`、type:chore → `chore`)。
     - `<slug>`: Issue タイトルの英数ケバブケース(小文字英数字と `-` のみ。日本語タイトルは内容を表す短い英語へ意訳)。
   - `git switch -c <type>/<issue番号>-<slug>`
   - この命名は外部ツール(ccdash 等)がブランチ名から Issue 番号を逆引きする契約。
     `<type>/` 直後は必ず Issue 番号にする(形式を崩さない)。

4. **着手宣言**
   - Issue を In Progress(担当アサイン)にし、必要なら `.claude/agents/` の関連 Agent へ委任。

## 完了後

実装は TDD(カバレッジ 80%+)。完了したら `finish-task` スキルで PR を作成する。

---
name: new-system
description: モノレポに新システムを追加する。フォルダ scaffold → develop-<system> ブランチ作成 → システム固有 CLAUDE.md 生成 → ラベル追加までを標準手順で行う。モノレポ構成のプロジェクトでのみ使用。
---

# new-system — 新システム追加ワークフロー(モノレポ用)

最上位ルールは `/CLAUDE.md`。本スキルは CLAUDE.md がモノレポ構成を宣言している場合のみ使用する。

## 手順

1. **slug 決定**
   - ケバブケース小文字(例: `Table-Reservation` → `table-reservation`)。

2. **フォルダ scaffold**
   - 構成・スタック・初期化コマンドは **CLAUDE.md「技術スタック」に従う**。標準形:
   ```
   <System>/
   ├── CLAUDE.md        ← root を継承、システム固有差分のみ
   ├── frontend/
   ├── backend/
   ├── middleend/       ← 任意(BFF が必要な場合のみ)
   └── docs/
   ```

3. **開発ブランチ作成**
   ```
   git fetch origin
   git switch develop
   git pull origin develop
   git switch -c develop-<slug>
   git push -u origin develop-<slug>
   ```

4. **システム固有 CLAUDE.md 作成**
   - `.claude/templates/CLAUDE.system.md` を元に生成する(生成規約はテンプレ内コメント参照)。
   - 冒頭で「root `/CLAUDE.md` を継承」と明記し、固有のコマンド・DB・特記事項のみ記載。

5. **GitHub 整備**
   - ラベル追加: `system:<slug>`。
   - 必要に応じてマイルストーン・プロジェクトボードを設定。

## 完了後
最初の機能は Issue 起票 → `start-task` で着手する。

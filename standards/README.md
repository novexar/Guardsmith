# 開発標準雛形 — GuardSmith standards

このリポジトリは [GuardSmith](https://github.com/novexar/Guardsmith) の `guard new` で
標準雛形から展開されています。まだ初期化が済んでいない場合は、以下の手順で初期化してください。

## 初期化手順

1. **Claude Code を起動**: `claude`
   - CLAUDE.md 冒頭の未初期化警告(「`{{` が残っている間は実装禁止」)により、
     Claude が `init-project` スキルの初期化フローに入る。入らなければ「init-project を実行して」と伝える
   - インタビューに回答すると CLAUDE.md / docs / .claude/agents が具体化され、不要エージェントは削除される
2. **機械検証**: `npx @guardsmith/cli lint`
   - プレースホルダ残置・契約見出しの欠落・資格情報の混入などが検出される。PASS するまでが初期化
3. **コミット**: `git add -A && git commit -m "chore: init-projectによるPJ初期化"`
4. 本 README はプロジェクト自身の README に書き換えてよい(標準の説明は GuardSmith リポジトリを参照)

以降の通常運用: Issue 起票 → `start-task` → TDD 実装 → `finish-task`。

## 構成

```
├── CLAUDE.md                  ← 雛形(未初期化警告つき。init-project が具体化)
├── guard.policy.yaml          ← 検証ポリシー(baseline をタグ固定で extends)
├── .claude/
│   ├── agents/                ← エンジニア Agent 雛形(frontend/backend/db/qa)
│   ├── skills/                ← init-project / start-task / finish-task / new-system
│   └── templates/             ← モノレポ用システム別 CLAUDE.md 雛形
├── docs/                      ← REQUIREMENTS / ARCHITECTURE / CODING_STANDARDS / DEVELOPMENT_WORKFLOW 雛形
└── .github/                   ← Issue(feature/bug/task)/ PR テンプレ
```

## 標準更新への追随

1. `guard.policy.yaml` の extends タグを新しい GuardSmith リリースへ上げる
2. `npx @guardsmith/cli lint` — 標準 skills の乖離が drift として警告される
3. `npx @guardsmith/cli sync` で差分確認(dry-run)→ `sync --write` でマスター内容へ復元。
   `## PJ固有手順` セクションの追記は保全される

## 設計原則(雛形を編集する際の約束)

- **gen: コメント方式**: 各雛形に生成規約(`<!-- gen: ... -->`)を同梱。どのセッションの Claude でも同じ品質で初期化できる。完成版からコメントは削除する
- **契約見出し**: CLAUDE.md の「技術スタック」「よく使うコマンド」「ブランチ戦略」「PJ固有ルール」は agents/skills が参照する。改名・削除禁止(`guard lint` が検証)
- **標準節の固定**: エージェント雛形の「作業フロー」「共通規約」「原則」は共通標準。初期化時の削除・緩和禁止(追記は可)
- **バージョン追跡**: CLAUDE.md 末尾の `<!-- standards: novexar/guardsmith vX.Y.Z -->` を維持し、標準更新時の追随判断に使う

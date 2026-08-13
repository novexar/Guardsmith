# GuardSmith

**AI開発標準の配布と統制を1つにしたガバナンスツールキット。**
標準(テンプレート)を配り、守られているかを機械検証する — 「ESLint + 公式config」の関係を
AIコーディング標準(CLAUDE.md / agents / skills)に対して提供する。

- **配布**: `guard new` で標準雛形(CLAUDE.md / agents / skills / docs)から新規PJを展開
- **検証**: `guard lint` がポリシー(YAML)に基づき 8 種の check で機械検証(exit 1 = error)
- **追随**: `guard sync` が配布ファイルのマスター乖離(drift)を検出・復元
- **CI**: GitHub Action が PR ごとに検証し、SARIF + PR コメントで可視化
- **多層運用**: `extends: github:owner/repo[//path]@tag` で OSS baseline → 組織 overlay → 各PJ の3層を合成(docs/LAYERING.md)

## インストール

```bash
npx @guardsmith/cli <command>      # 都度実行
# または
pnpm add -D @guardsmith/cli        # PJ に導入して pnpm guard <command>
```

このリポジトリのチェックアウトから実行する場合は `pnpm install` 後に `pnpm guard <command>`。

## 導入手順

### A. 新規プロジェクト

```bash
# 1. 標準雛形から展開(タグ固定の guard.policy.yaml も生成される)
npx @guardsmith/cli new my-project
cd my-project && git init && git add -A && git commit -m "chore: guard new による雛形展開"

# 2. Claude Code で初期化
claude
```

CLAUDE.md 冒頭の未初期化警告により、Claude が `init-project` スキルで初期化フローに入る
(入らなければ「init-project を実行して」と伝える)。インタビューに回答すると
CLAUDE.md / docs / .claude/agents が具体化される。

```bash
# 3. 初期化完了を機械検証してコミット
npx @guardsmith/cli lint
git add -A && git commit -m "chore: init-projectによるPJ初期化"
```

`guard lint` はプレースホルダ残置・契約見出しの欠落・資格情報の混入などを検出する。
PASS するまでが初期化。

### B. 既存プロジェクト

```bash
npx @guardsmith/cli init   # guard.policy.yaml のみ生成(雛形は展開しない)
npx @guardsmith/cli lint
```

検出のうちすぐ直せない違反は `exemptions` に**期限付き**(`expires` + `approved_by` 必須)で
登録する。期限切れは error として表面化する。標準 skills の乖離は `guard sync` で復元できる。

### C. CI に組み込む(GitHub Action)

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
      - uses: novexar/Guardsmith/packages/action@v0.2.1
```

入出力の詳細(SARIF アップロード、private リポジトリでのトークン指定など)は
[packages/action/README.md](packages/action/README.md) を参照。

### D. 標準の更新に追随する

1. マスター(standards/ / presets/)を改訂し、新タグ vX.Y.Z を発行
2. 各PJの `guard.policy.yaml` の extends タグを上げる(リモート参照はタグ固定が必須)
3. `guard lint` が標準 skills の乖離を drift として警告
4. `guard sync` で差分を確認(既定 dry-run)→ `guard sync --write` でマスター内容へ復元。
   `allow_sections`(例: `## PJ固有手順`)に列挙されたセクションのローカル編集は保全される

## コマンド一覧

| コマンド             | 説明                                                                                              |
| -------------------- | ------------------------------------------------------------------------------------------------- |
| `guard new <dir>`    | standards/ 一式から新規PJ雛形を展開                                                               |
| `guard init`         | カレントに guard.policy.yaml を生成(extends preset:baseline)                                      |
| `guard lint`         | ポリシーに基づく検査。`--format sarif --out <file>`、`--no-cache`(リモート再取得)、`--root <dir>` |
| `guard sync`         | drift ファイルのマスター復元。既定 dry-run、`--write` で適用                                      |
| `guard explain <id>` | ルールの説明を表示                                                                                |

## リポジトリ構成

```
guardsmith/
├── packages/core/        # @guardsmith/core — ルールエンジン + CLI 本体
├── packages/cli/         # @guardsmith/cli — guard バイナリ
├── packages/action/      # GuardSmith Lint GitHub Action(SARIF + PRコメント)
├── presets/
│   ├── baseline.yaml     # 生成PJ向け標準ルールセット
│   └── self.yaml         # 本リポジトリ自身のセルフ検査用(dogfooding)
├── standards/            # 開発標準マスター(CLAUDE.md / agents / skills / docs 雛形)
└── docs/LAYERING.md      # 3層overlay(OSS → private → PJ)の運用設計
```

## 開発(コントリビュータ向け)

```bash
pnpm install
pnpm test              # vitest
pnpm test:coverage     # カバレッジ (80%ゲート)
pnpm typecheck         # tsc strict
pnpm lint              # eslint + prettier --check
pnpm guard lint        # セルフ検査 (dogfooding, presets/self.yaml)
```

## License

[Apache-2.0](LICENSE)

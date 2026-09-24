<p align="center">
  <img src="https://raw.githubusercontent.com/novexar/Guardsmith/main/assets/logo.png" width="120" alt="GuardSmith ロゴ">
</p>

<h1 align="center">GuardSmith</h1>

<p align="center">
  すべてのリポジトリに同じ AI 開発標準を配り、守られているかを<b>機械検証</b>する。
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@guardsmith/cli"><img src="https://img.shields.io/npm/v/%40guardsmith%2Fcli?label=%40guardsmith%2Fcli" alt="npm"></a>
  <a href="https://github.com/marketplace/actions/guardsmith-lint"><img src="https://img.shields.io/badge/GitHub%20Action-GuardSmith%20Lint-6f42c1" alt="GitHub Action"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue" alt="License"></a>
</p>

<p align="center">
  <a href="README.md">English</a> | <b>日本語</b>
</p>

---

## なぜ GuardSmith か

Claude Code のような AI コーディングツールをチームに導入すると、必ず同じ問題が起きます。
`CLAUDE.md` がリポジトリごとにバラバラになり、良い agent/skill 構成は個人のプロジェクトに閉じ、
配った規約は静かに風化していく——。

GuardSmith は AI 開発標準を、ESLint がコードスタイルを扱うのと同じ方法
——**配布できる config + linter**——で扱います:

- **配布** — `guard new` が標準マスターから新規プロジェクトを展開
  (`CLAUDE.md`・agents・skills・docs・CI 設定・デザイン仕様)
- **検証** — `guard lint` がポリシー(YAML)に基づき検査
  (9 種の check。未初期化テンプレ、契約見出しの破壊、資格情報の混入、マスターからの乖離、CLAUDE.md の常駐量など)
- **復元** — `guard sync` がマスターからの乖離(drift)を検出し、
  各プロジェクトが編集してよいセクションは保全したまま復元
- **CI で強制** — [GuardSmith Lint Action](https://github.com/marketplace/actions/guardsmith-lint) が
  違反 PR を落とし、サマリをコメントし、SARIF を出力
- **多層化** — `extends: github:owner/repo[//path]@tag` で OSS baseline →
  組織 private overlay → 各プロジェクトを合成。**社外秘のルールは GitHub の外に出ません**

## クイックスタート

Node.js 20 以上が必要です。

### 新規プロジェクト

```bash
npx @guardsmith/cli new my-project
cd my-project && git init && git add -A && git commit -m "chore: guard new による雛形展開"
```

Claude Code でプロジェクトを開くと、`CLAUDE.md` 冒頭の未初期化警告により同梱の
`init-project` スキルが起動し、インタビューを通じて `CLAUDE.md`・agents・docs・
Docker ローカル CI が具体化されます。仕上げに検証:

```bash
npx @guardsmith/cli lint   # 初期化が完了するまでは error が出ます(それが正常です)
```

### 既存プロジェクト

```bash
npx @guardsmith/cli init   # guard.policy.yaml のみ生成(雛形は展開しない)
npx @guardsmith/cli lint
```

すぐに直せない違反は `exemptions` に登録します——理由・承認者・**期限**が必須で、
期限切れの例外は error として表面化します。黙認の恒久化は仕組みで防がれます。

### CI は1行

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
      - uses: novexar/Guardsmith@v0.5.2
```

| input              | 既定値                    | 説明                                                                                                  |
| ------------------ | ------------------------- | ----------------------------------------------------------------------------------------------------- |
| `cli-version`      | `0.4.0`                   | 実行する CLI の npm バージョン                                                                        |
| `root` / `policy`  | `.` / `guard.policy.yaml` | 検査対象 / ポリシーファイル                                                                           |
| `upload-sarif`     | `true`                    | Code Scanning への SARIF アップロード(GHAS の無い private では `"false"`。SARIF は artifact にも残る) |
| `pr-comment`       | `true`                    | 失敗時の PR コメント                                                                                  |
| `guardsmith-token` | `github.token`            | `github:` リモート参照用(private overlay を使う場合のみ PAT)                                          |
| `source`           | `npm`                     | `release` にすると npm レジストリ不要(GitHub Releases のバンドルを使用。`release-tag` で固定)         |

## 閉域網・egress 制限環境で使う

依存をすべて同梱したバンドルを各 [GitHub Release](https://github.com/novexar/Guardsmith/releases) に
添付しています。必要なのは GitHub への到達と Node.js 20+ のみで、npm レジストリには一切接続しません:

```bash
gh release download v0.5.2 --repo novexar/Guardsmith --pattern 'guardsmith-cli-*.tar.gz'
tar -xzf guardsmith-cli-*.tar.gz
node guardsmith-cli/guard.mjs lint
```

ポリシー・標準の取得(`extends` / drift / sync)は設計上 GitHub のみで完結します。

## ポリシー

プロジェクトのポリシーは、タグ固定のリモート参照を持つ数行の YAML です:

```yaml
# guard.policy.yaml
version: 1
target: claude-code
extends:
  - github:novexar/guardsmith//presets/baseline.yaml@v0.5.2
  # フロントエンドを持つプロジェクトはさらに:
  # - github:novexar/guardsmith//presets/frontend.yaml@v0.5.2
ignore: [] # 全走査から除外する glob(extends 間で連結される)
rules: [] # 追加・上書き(同じ id の再定義=上書き)
exemptions: [] # 期限付き例外(reason + approved_by + expires 必須)
```

- **`preset:baseline`** — 全プロジェクト共通の標準: 初期化完了、契約見出し、agent/skill の
  frontmatter、シークレット検査、マスターとの乖離、日付付き model ID の禁止、
  GitHub Actions にテスト系ワークフローを置かない(CI はローカル Docker)
- **`preset:frontend`** — UI を持つプロジェクト向け: `DESIGN.md` の存在と具体化、
  shadcn/ui 設定、競合 UI ライブラリの混在検知
- リモート参照は**タグ固定が必須** — 標準が知らないうちに変わることはありません。
  自分のタイミングでタグを上げ、`guard lint` で乖離を確認し、`guard sync --write` で復元します
- 3層モデル(OSS baseline → 組織 private overlay → プロジェクト)の設計は
  [docs/LAYERING.md](docs/LAYERING.md) を参照

### CLAUDE.md の常駐量(import budget)

`CLAUDE.md` は `@path` インポートで他ファイルを**起動時に丸ごと**コンテキストへ展開します。
60 行の `CLAUDE.md` でも 5 文書をインポートしていれば「薄い `CLAUDE.md`」ではありません。
行数だけを見る `claude-md/thin-diff` ではこれを検知できないため、`import-budget` は
起点ファイルと `@` インポートで到達する全ファイルの**常駐合計量**を測ります。

```yaml
- id: claude-md/import-budget
  severity: warn
  check: import-budget
  with:
    path: CLAUDE.md # glob 可。マッチした起点ファイルごとに1件報告
    max_chars: 32000 # 任意。超過すると rule の severity で報告
    max_depth: 4 # 任意。インポートを追う深さ(既定 4)
```

起点ファイルごとに必ず `info` を1件出します —
`resident context: N files, X chars (≈Y tokens, rough estimate)` と、ファイル別内訳
(大きい順。上位 10 件 + `others` 行)。**トークン数は `chars / 4` の粗い目安であり実測では
ありません**。桁を掴む用途にのみ使ってください。
常駐量に寄与しないインポートも `info` で示します: `unresolved import:`(解決できない参照)、
`import cycle detected:`(循環)、`import depth limit exceeded`(深さ上限超過)、
`import outside root, not measured`(`..`・絶対パス・`~/` で走査ルート外を指す参照。
**読みに行かず**報告だけします)。

インポートの意味論は
[Claude Code の memory ドキュメント](https://code.claude.com/docs/en/memory)(2026-09-24 確認)
に従います: `@path` はファイル中のどこでも有効、相対パスはそのファイルのディレクトリ基準、
再帰は 4 hops まで、コードスパン・フェンスドコードブロック内の `@` はインポートではありません
(取り込まずにパスを書きたいときはバッククォートで囲みます)。

### 走査の対象

各 check は「**コミットされうるファイル**」を対象にします:

- 既定で `.gitignore`(入れ子の `.gitignore` も)に追従し、`.git/` は常に除外します
- さらにポリシーのトップレベル `ignore`(glob)を除外します。`rules` と違い extends 間で
  **連結**されるため、組織 overlay 側の除外が各 PJ に届きます
- 除外対象は**走査の時点で枝刈り**します(結果フィルタではありません)。エージェント worktree や
  `node_modules`、virtualenv を抱えるリポジトリでも実行時間が伸びません
- `--no-gitignore` で全走査に戻せます(除外されたファイルの中身を点検したいとき)

9 種の check のうち 8 種は glob でファイルを列挙するため `.gitignore` に追従します。
`json-path` だけは単一の固定パスを直接読むため非追従です:

| check           | `.gitignore` 追従 | `.gitignore` 対象パスの扱い                                                                                               |
| --------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `file-exists`   | する              | **存在しない**扱い → ルールが違反を報告(リポジトリに入らないため)                                                         |
| `file-absent`   | する              | **無い**扱い → ディスク上にあっても無検出                                                                                 |
| `content-match` | する              | 走査対象外(対象0件は `info` として表示)                                                                                   |
| `max-lines`     | する              | 走査対象外                                                                                                                |
| `import-budget` | 起点のみ          | 起点として列挙されない。`@` インポートで明示参照された場合は計測対象                                                      |
| `frontmatter`   | する              | 走査対象外                                                                                                                |
| `drift`         | する              | マスターとの比較対象外                                                                                                    |
| `secret-scan`   | する              | 走査対象外 — `.claude/settings.local.json` 等から検出されない                                                             |
| `json-path`     | **しない**        | 直読みのため従来どおり発火(`.claude/settings.json` を gitignore している PJ でも `security/dangerous-permissions` は効く) |

驚きやすいのは 2 つです。`.env` を `.gitignore` に入れている PJ では `file-absent` の
`hygiene/no-env-file` が無検出になります — このルールは「`.env` をコミットさせない」ためのもので、
`.gitignore` 対象ならコミットされ得ないため妥当な結果です。`json-path` を非追従にしているのは、
`.claude/settings.json` をローカル管理している PJ でも設定監査を効かせ続けるためです。
すべての check に除外ファイルも見せたい場合は `--no-gitignore` を使ってください。

## コマンド一覧

| コマンド                  | 説明                                                                                         |
| ------------------------- | -------------------------------------------------------------------------------------------- |
| `guard new <dir>`         | 標準マスターから新規プロジェクトを展開                                                       |
| `guard init`              | カレントに `guard.policy.yaml` を生成                                                        |
| `guard lint`              | 検査。`--format sarif\|json`、`--out <file>`、`--no-cache`、`--no-gitignore`、`--root <dir>` |
| `guard sync`              | 乖離の表示(dry-run)。`--write` で復元、`--no-gitignore` で全走査                             |
| `guard explain <rule-id>` | ルールの意図を表示                                                                           |
| `guard version`           | CLI と標準のバージョンを表示                                                                 |

## 標準のアップグレード

既存プロジェクトはタグ固定のため、何もしなくても壊れません。新しい標準リリースへ追随する
際は [docs/migration/v0.5.2.ja.md](docs/migration/v0.5.2.ja.md) のチェックリストに従ってください
——各項目は任意・独立で、段階適用できます。

## 謝辞・クレジット

- [awesome-design-md-jp](https://github.com/kzhrknt/awesome-design-md-jp)(MIT)—
  standards/DESIGN.md テンプレートのベース
- [ponytail](https://github.com/DietrichGebert/ponytail)(MIT)— 標準に組み込んでいる
  過剰実装抑制プラグイン
- 標準スタックとして参照・推奨しているエコシステムへの敬意: shadcn/ui、Tremor、
  TanStack(Router/Query/Table)、Tailwind CSS、cmdk — コードの同梱はなく、
  各 PJ が各自のライセンスで導入します
- 主要ランタイム依存: zod、yaml、fast-glob、micromatch、ignore、jsonpath-plus、node-tar — 各パッケージの
  ライセンスに基づき利用(オフラインバンドルには `THIRD-PARTY-NOTICES.md` を同梱)

## ライセンス・コントリビュート

[Apache-2.0](LICENSE)。Issue・PR を歓迎します。開発フローは
[CONTRIBUTING.ja.md](CONTRIBUTING.ja.md) を参照してください。

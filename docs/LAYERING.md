# GuardSmith レイヤリング設計 — overlay / extends の仕組み

「組織・クライアント固有の内容をprivateリポジトリのoverlayとしてextendsで被せる」の詳細説明。

## 一言でいうと

**ポリシーとテンプレートを「公開してよい層」と「公開できない層」に分け、
下の層を上の層が extends(継承+上書き)する3層構造**にする。CSSのカスケードと同じ発想。

```
[Layer 1] guardsmith (OSS・public)
    │  誰でも使える汎用ルール + 汎用テンプレート(標準の"本体")
    │  例: baseline.yaml, standards/CLAUDE.md雛形, 汎用agents/skills
    ▼ extends
[Layer 2] guardsmith-private (novexar・private)
    │  Novexar/クライアント固有の追加ルール・上書き・固有テンプレート
    │  例: 特定クライアントの命名規則、社内リポジトリ名の規約、NDA案件の禁止事項
    ▼ extends
[Layer 3] 各プロジェクトリポジトリ (guard.policy.yaml)
       そのPJ固有の微調整と期限付き例外(exemption)だけを書く
```

## 具体例で理解する

### Layer 1 (OSS) — presets/baseline.yaml

```yaml
rules:
  - id: claude-md/thin-diff
    severity: warn
    check: max-lines
    with: { path: CLAUDE.md, limit: 120 }
```

### Layer 2 (private) — novexar-overlay.yaml

```yaml
version: 1
target: claude-code
extends:
  - github:novexar/guardsmith//presets/baseline.yaml@v0.2.1 # ← Layer 1を継承
rules:
  # 上書き: 社内では違反をerror扱いに格上げ (同じidで再定義=上書き)
  - id: claude-md/thin-diff
    severity: error
    check: max-lines
    with: { path: CLAUDE.md, limit: 120 }
  # 追加: クライアントA案件の固有ルール (これは絶対に公開できない情報)
  - id: client-a/forbidden-terms
    severity: error
    check: content-match
    with:
      path: "docs/**/*.md"
      must_not: ["(社外秘プロジェクトコード名の正規表現)"]
```

### Layer 3 (各PJ) — guard.policy.yaml

```yaml
version: 1
target: claude-code
extends:
  - github:novexar/guardsmith-private//novexar-overlay.yaml@v3
rules: [] # 通常は空。PJ固有の追加があればここに
exemptions:
  - rule: claude-md/thin-diff
    reason: レガシー移行中のため手順併記が必要
    expires: 2026-12-31
    approved_by: tech-lead
```

## マージの規則 (resolver実装済みの挙動)

1. extends を宣言順に読み込み、rules を **id をキーに** マージする
2. 同じ id が再定義されたら **後勝ち**(Layer 3 > Layer 2 > Layer 1)
3. exemptions は上書きではなく **連結**(どの層の例外も有効。ただし期限必須)
4. リモート参照は **タグ固定必須**(@vX.Y.Z)。「標準が知らぬ間に変わった」を防ぐ

## なぜこの分割なのか

| 分け方            | 何が起きるか                                                                          |
| ----------------- | ------------------------------------------------------------------------------------- |
| 全部OSSに置く     | クライアント固有ルール(=案件情報)の公開事故。他社ユーザーにはノイズ                   |
| 全部privateに置く | OSSとして公開・共有できず、コミュニティの改善も取り込めない                           |
| **3層に分ける**   | OSSは誰でも使える汎用品として育ち、固有情報は一切公開されず、各PJは数行のYAMLだけ持つ |

## テンプレート(standards/)も同じ構造

ルールだけでなくテンプレートも同様:

- Layer 1: `standards/` の汎用雛形(CLAUDE.md、agents、skills) — 今回claude-standardsから移植したもの
- Layer 2: private側に固有テンプレート(例: クライアントA向けagent)を置き、`guard sync` の
  取得元を private に向ける(privateのstandardsはLayer 1をコピーして固有部分を追記した形で維持)
- Layer 3: 各PJは `guard sync` で配布を受け、`## PJ固有手順` セクションだけ編集(drift検知の許可範囲)

## 運用フロー

1. 標準を改訂 → Layer 1(または2)にコミットし、新タグを打つ(例: v0.3.0)
2. 各PJの guard.policy.yaml の extends タグを上げるPRを作る(将来: `guard bump` で自動化)
3. CIの `guard lint` が新標準への適合を検証。適合できない箇所は期限付きexemptionで猶予管理

## リモート取得の仕様

- `extends: github:owner/repo[//path]@tag` / drift `source: github:owner/repo[//path]@tag` が動作する
  - `//path` 省略時: extends はリポジトリルートの `guard.policy.yaml`、drift はリポジトリルートを参照
  - drift の `//path` はマスターがサブディレクトリの場合に指定(例: `github:novexar/guardsmith//standards@v0.2.1`)
- 取得方式: codeload.github.com の tarball(タグ固定)。private リポジトリは `GITHUB_TOKEN` 環境変数で認証
- キャッシュ: `~/.guardsmith/cache/<owner>/<repo>/<tag>/`。タグは不変前提で再取得しない。
  `guard lint --no-cache` で強制再取得
- extends は**多段解決**される(Layer 3 → Layer 2 → Layer 1 のチェーンが1コマンドで効く)。循環はエラー
- セキュリティ: tarball 展開時にパストラバーサル(`..`・絶対パス)とリンク系エントリを拒否。
  `//path` のキャッシュ外参照も遮断

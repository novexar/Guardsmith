> **⚠️ 未初期化テンプレート**
> 本ファイルに `{{` プレースホルダが残っている間、このリポジトリは未初期化です。
> 実装・Issue作業を始める前に、必ず `.claude/skills/init-project` の手順で初期化してください。
> (この警告ブロックは初期化完了時に削除する)

<!-- ============================================================
  gen: 生成規約(init-project 実行時に必読):
  1. {{PLACEHOLDER}} を全てオーナーへのインタビュー結果で置換する。不明な項目は
     勝手に埋めず、オーナーに質問してから確定する。
  2. `<!-- gen: ... -->` コメントは生成指示。指示に従って本文を書いたら、
     コメント自体は完成版から必ず削除する。
  3. 「技術スタック」「よく使うコマンド」「ブランチ戦略」「PJ固有ルール」の
     見出し名は .claude/agents・.claude/skills が参照する契約(コントラクト)。改名・削除禁止。
  4. 本ファイルと `@` で参照した文書は、毎セッション起動時に丸ごと読み込まれる(常駐)。
     `@` は常時必要な短い共通規約(docs/CODING_STANDARDS.md)のみに使う。
     要件・設計・CI 詳細などは通常のパスで記載し、「いつ読むか」を添える。
     本体は 120 行以内を目安とするが、行数だけで軽量とは判断しない
     (常駐量は `guard lint` の検査で確認する)。
  5. 末尾の standards バージョンコメントは削除せず維持する。
     このタグは `guardsmith.vars.yaml` の `standards` と同じタグを指す(`guard bump` が両方を更新する)。
============================================================ -->
# CLAUDE.md — {{PROJECT_NAME}}

> 開発標準(Agent体制・ワークフロー・規約)は本リポジトリ同梱の `.claude/`(agents / skills)および `docs/` に従う。
> 品質確認は実装者から独立した QA(`qa-engineer`)が担う。
> ここに書かれた指示は既定動作より優先される。

## プロジェクト概要
<!-- gen: オーナー・目的・リポジトリを各1行で。モノレポなら「1システム=1トップレベルフォルダ、システム間import禁止」を明記 -->
- **オーナー**: {{OWNER}}
- **リポジトリ**: {{ORG/REPO}}({{単一システム | モノレポ}})
- **目的**: {{PURPOSE_ONE_LINE}}
- **ドキュメント言語**: 原則 日本語(技術用語・コード・識別子は英語のまま)。

## 技術スタック
<!-- gen: 採用しない層は行ごと削除。バージョンは固定が必要なもののみ明記 -->
| 層 | 採用技術 |
|---|---|
| フロントエンド | {{FE_STACK}} |
| バックエンド | {{BE_STACK}} |
| DB | {{DB}} |
| 認証 | {{AUTH}} |
| インフラ | {{INFRA_SUMMARY}}(詳細: `docs/INFRA.md`) |

## よく使うコマンド
<!-- gen: agents/skills はこの表を品質ゲートとして実行する。scaffold 後に実際に動くコマンドを記載し、動作確認してから確定する -->
| 目的 | {{FE_DIR}}/ | {{BE_DIR}}/ |
|---|---|---|
| 依存導入 | {{FE_INSTALL}} | {{BE_INSTALL}} |
| 開発起動 | {{FE_DEV}} | {{BE_DEV}} |
| Lint | {{FE_LINT}} | {{BE_LINT}} |
| テスト | {{FE_TEST}} | {{BE_TEST}} |
| ビルド | {{FE_BUILD}} | — |
| CI(Docker) | `make ci`(ルートで実行。詳細: `docs/CI_CD.md`) | 同左 |

## ブランチ戦略
<!-- gen: モノレポなら develop-<system> 階層を含む標準形、単一システムなら main/develop/feature の3層。詳細は docs/BRANCHING_STRATEGY.md に生成し、ここには図と昇格ルールのみ -->
```
main                     ← 本番。直接 push 禁止。
└── develop              ← 統合ブランチ。
    └── {{BRANCH_TREE}}
```
- 作業ブランチは `<type>/<issue番号>-<slug>`(type: feature | bug | chore。例: `feature/142-preset-loader`)。外部ツールがブランチ名から Issue 番号を逆引きする契約。
- Issue は `.github/ISSUE_TEMPLATE` の構造(背景 / 受入基準 / スコープ外)に従って起票する。
- 作業ブランチ → 起点ブランチの PR は担当エンジニア Agent が作成。昇格 PR は PM のみ。`main` へのマージはオーナー確認後。

## PJ固有ルール
<!-- gen: デザインシステム、外部API制約、コンプライアンス要件など、このPJだけの制約を箇条書き。無ければ「特記事項なし」 -->
- {{PROJECT_SPECIFIC_RULES}}

## 詳細ドキュメント
<!-- gen: init-project で生成した docs のみ残す。`@` を付けてよいのは CODING_STANDARDS のみ(常駐する)。他は通常パス+「読む条件」 -->
| 文書 | 読む条件 |
|---|---|
| @docs/CODING_STANDARDS.md | 常駐(コードを書く前提の共通規約) |
| `docs/REQUIREMENTS.md` | Issue 起票時・受入条件の確認時 |
| `docs/ARCHITECTURE.md` | 構成変更・新コンポーネント追加時 |
| `docs/DEVELOPMENT_WORKFLOW.md` | 着手時・PR 作成時・委任時 |
| `docs/CI_CD.md` | `make ci` 失敗時・CI 構成変更時 |
| `docs/SETUP.md` | 初回セットアップ時 |

<!-- standards: novexar/claude-standards v0.1.0 -->

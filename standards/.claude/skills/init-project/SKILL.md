---
name: init-project
description: マスターテンプレートからコピーされた本リポジトリを PJ 用に初期化する。オーナーへのインタビュー → CLAUDE.md / docs / .claude/agents をその場で具体化 → 不要ファイル削除 → 自己検証までを行う。CLAUDE.md に {{ が残っている未初期化状態で必ず最初に実行する。
---

# init-project — プロジェクト初期化ワークフロー

本リポジトリは novexar/claude-standards マスターのコピーである。
**PJ 固有の内容はすべて本スキルの手順で Claude がその場で編集・生成する。**

## 手順

### 1. インタビュー
以下をオーナーに確認する。**推測で埋めない**。既存コードがある場合は先に調査し、確認事項を「質問」ではなく「調査結果の承認」に減らす。

- プロジェクト名 / オーナー / リポジトリ(org/repo)/ 単一システムかモノレポか
- 技術スタック(FE / BE / DB / 認証 / インフラ)。未定なら要件を聞いて提案し承認を得る
- 必要なエージェント構成(既定: frontend / backend / db / qa。**BE サーバー不在なら backend-engineer を削除**、DB を扱わないなら db-engineer を削除、など構成に合わせて取捨選択)
- PJ 固有の制約(デザインシステム、外部 API、コンプライアンス、コスト上限)
- 要件の概要(REQUIREMENTS.md 生成に必要な範囲)

### 2. その場編集(テンプレの具体化)
以下のファイルを **直接編集** して具体化する。各ファイル冒頭・文中の `gen:` コメントが生成規約。必ず従うこと。

| 対象 | 作業 |
|---|---|
| `/CLAUDE.md` | プレースホルダ置換、未初期化警告ブロック削除。**末尾の standards バージョンコメントは維持** |
| `docs/*.md` | 各雛形を具体化(REQUIREMENTS / ARCHITECTURE / CODING_STANDARDS / DEVELOPMENT_WORKFLOW / SETUP) |
| `.claude/agents/*.md` | 手順1で決めた構成のみ残して具体化。**不要なエージェントはファイルごと削除** |
| `.github/` | Issue / PR テンプレのラベル・項目を PJ に合わせ微調整(原則そのまま)。workflows/deploy.yml はデプロイ先確定まで no-op のまま(**テスト系ワークフローを追加しない**) |
| `docker/ci/*` / `docker-compose.ci.yml` / `Makefile` | ローカル CI 構成を PJ のスタックへ具体化(FE / BE の片方しか無い PJ は不要なサービス・Dockerfile・ターゲットを削除)。具体化後に `make ci` が通ることを確認する |

- エージェントの「作業フロー」「共通規約」「原則」など Novexar 標準と明記された節は**削除・緩和・改変禁止**(PJ 固有の追記は可)。
- モノレポの場合、`.claude/templates/CLAUDE.system.md` は `new-system` スキルが使うため残す。単一システムなら削除してよい。

#### フロントエンド関連(FE の有無で分岐)
- **FE がある PJ**:
  - `/DESIGN.md` を PJ の性質に合わせて具体化する。**参考にする design-md(既存サービスや類似ダッシュボード)を PM がオーナーに確認してから**編集する。`docs/FRONTEND_STANDARDS.md` の標準(ダークモード既定・アクセント1色・ステータス3色)を反映する。
  - **frontend 検証プリセットを追加する**。`guard.policy.yaml` の `extends` に frontend プリセットを足す
    (baseline には FE ルールを含めない。BE のみの PJ が誤警告を受けないための分離)。

    ```yaml
    version: 1
    target: claude-code
    extends:
      - github:novexar/guardsmith//presets/baseline.yaml@vX.Y.Z
      - github:novexar/guardsmith//presets/frontend.yaml@vX.Y.Z # ← FE を持つ PJ のみ追加
    ```

    - リモート参照はタグ固定(`@vX.Y.Z`)必須。実例: `github:novexar/guardsmith//presets/frontend.yaml@v0.6.0`
    - ローカル開発(guardsmith リポジトリ内や CLI 同梱プリセット)では `preset:frontend` と書ける。
    - 検査内容: `DESIGN.md` の存在(`frontend/design-md`)/ shadcn 設定 `components.json` の存在
      (`frontend/shadcn-config`)/ 競合 UI ライブラリ不在(`frontend/no-competing-ui-libs`)/
      DESIGN.md の具体化完了(`frontend/design-md-initialized`)。
- **FE が無い PJ**: `/DESIGN.md` と `.claude/templates/frontend/` をフォルダごと削除する(frontend-engineer.md の削除と同時に行う)。

### 3. 自己検証(Definition of Done)
初期化完了の宣言前に、以下を **すべて機械的に確認** する:

- [ ] `grep -rn '{{' CLAUDE.md docs/ .claude/` がヒット 0 件(プレースホルダ残置なし。※ .claude/templates/ は除外可)
- [ ] `grep -rn 'gen:' CLAUDE.md docs/ .claude/agents/` がヒット 0 件(生成指示コメント削除済み)
- [ ] CLAUDE.md の未初期化警告ブロックが削除され、末尾に `standards: novexar/claude-standards v` コメントが残っている
- [ ] CLAUDE.md に契約見出し「技術スタック」「よく使うコマンド」「ブランチ戦略」「PJ固有ルール」が全て存在する
- [ ] 「よく使うコマンド」表のコマンドを実際に実行し、全てエラーなく動作する(scaffold 済みの場合)
- [ ] `make ci` が全ジョブ成功で完走し、`.guardsmith/ci-results/latest.json` が生成される(scaffold 済みの場合)
- [ ] CLAUDE.md 本体が 120 行以内。**`@` インポートは `docs/CODING_STANDARDS.md` のみ**(他の文書は通常パス + 「読む条件」を添えて記載)。常駐量は `guard lint` で確認する
- [ ] 各エージェントの Novexar 標準節が雛形から緩和されていない(目視確認)
- [ ] 不要エージェント・不要テンプレが削除されている

1 つでも未達なら修正してから再検証。検証結果はチェックリスト形式でオーナーに報告する。

## マスター更新への追随
マスター側の標準が更新された場合、CLAUDE.md 末尾のバージョンコメントと novexar/claude-standards の差分を確認し、
標準節(共通規約・スキル手順)のみを取り込む。**PJ 固有の記述は上書きしない。**

## 完了後
最初の機能開発は Issue 起票 → `start-task` で着手する。モノレポの場合、システム追加は `new-system` を使用。

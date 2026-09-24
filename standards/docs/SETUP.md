<!-- gen: 初回セットアップ手順の雛形。PJ で使わない節(ponytail / hooks)は節ごと削除してよい。完成後 gen: コメントと {{ を全削除。 -->
# 初回セットアップ — {{PROJECT_NAME}}

> **対象**: リポジトリを初めて開く人・環境を管理する人。
> 日常の開発規則は `docs/DEVELOPMENT_WORKFLOW.md` を参照する(本書を毎回読む必要はない)。

## ponytail プラグイン(過剰実装の抑制)

役割とコマンドは `docs/DEVELOPMENT_WORKFLOW.md`「過剰実装の抑制(ponytail)」を参照。ここでは導入だけを扱う。

- 本リポジトリの `.claude/settings.json` により、ponytail マーケットプレイスはフォルダを開いた時点で
  自動登録される(初回はフォルダ trust の確認プロンプトが出る)。
- ただしプラグイン本体は個別インストールが必要な場合がある。有効にならないときは
  `/plugin marketplace add DietrichGebert/ponytail` → `/plugin install ponytail@ponytail` を実行する。
- Node.js が非対話シェルの PATH に必要。
- 既定強度の変更は環境変数 `PONYTAIL_DEFAULT_MODE`(lite / full / ultra)。
- 仕様確認の根拠(確認日 2026-09-16):
  [settings-reference](https://code.claude.com/docs/en/settings-reference) /
  [discover-plugins](https://code.claude.com/docs/en/discover-plugins)

## 外部ツール連携(hooks)

外部ツール(ccdash 等)は Claude Code の **HTTP hooks** でセッション/タスクのイベントを受け取れる。
ローカル CI の結果 JSON(`.guardsmith/ci-results/`、詳細: `docs/CI_CD.md`)と合わせて、
開発状況を可視化する外部ツールの受け口になる。

1. `.claude/settings.local.json.example` を `.claude/settings.local.json` にコピーする。
2. 受信側の URL・トークン(環境変数名)を自分の環境に合わせて編集する。
3. トークン・URL は `settings.local.json` 側にのみ置き、コミットしない
   (`.claude/settings.local.json` は `.gitignore` 済み。共有の `.claude/settings.json` には書かない)。

- 仕様確認の根拠(確認日 2026-09-16): [hooks](https://code.claude.com/docs/en/hooks)

## 作業状態ディレクトリ

`.guardsmith/` は GuardSmith のランタイム成果物(CI 結果 JSON、`state/<issue番号>.md` の作業状態)を置く場所で、
`.gitignore` 済み。**コミット/プッシュ禁止**(リポジトリ名・SHA 等の PJ 固有情報を含む)。
手動で作る必要はなく、初回利用時に作成される。

## PJ 固有のセットアップ
<!-- gen: 環境変数・ローカル DB・外部サービスのアカウント等。無ければ「特記事項なし」 -->
- {{SETUP_PROJECT_SPECIFIC}}

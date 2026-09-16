<!-- gen: 開発ワークフローの雛形。体制(PM主導 Agent オーケストレーション)は原則維持。完成後 gen: コメントと {{ を全削除。 -->
# 開発ワークフロー — {{PROJECT_NAME}}

## 基本フロー
1. **Issue 起票**(テンプレ必須。Issue 無しの作業着手は禁止)
2. **ブランチ作成**(`start-task` スキル)
3. **調査・再利用検討**(既存実装 / ライブラリ優先)
4. **TDD 実装**(RED→GREEN→REFACTOR、カバレッジ 80%+)
5. **PR 作成**(`finish-task` スキル)
6. **PM コードレビュー**(CRITICAL/HIGH はマージ前修正必須)
7. **マージ** → 8. **Issue クローズ**

## Agent オーケストレーション(PM 主導体制)
> **原則(厳守): PM はコードを直接編集してはならない。**
> すべての実装コードは `.claude/agents/` の各エンジニア Agent へ委任する。
> PM 自身が Write/Edit で実装コードを書き換えることは禁止。**例外なし**(軽微な一行修正・緊急対応も委任)。

- PM の作業範囲: 計画・タスク分解・Issue 起票・委任・コードレビュー・PR 昇格・統制文書維持・デプロイ等オーケストレーション・オーナー連携。
- 各 Agent のモデル/effort ポリシーは `docs/AGENTS.md` に従う。
- 独立タスクは並列で委任。完了ごとに PM がレビューし、問題があれば差戻し。
- セキュリティ要素(認証・入力処理・DB クエリ・外部 API・決済)の変更時はセキュリティ観点レビューを必ず実施。
- オーナーへの確認は「方針判断が必要な場面のみ」。それ以外は継続的に開発を進行する。

## 過剰実装の抑制(ponytail)
[ponytail](https://github.com/DietrichGebert/ponytail) プラグイン(MIT)が SessionStart hook でスキルを注入し、
実装判断に**はしご原則**を適用する: **作らない → 再利用 → 標準ライブラリ → 最小実装**。
上の段で解決できるなら下の段に降りない。迷ったら作らない側を選ぶ。

- 既定強度は **full**。変更は環境変数 `PONYTAIL_DEFAULT_MODE`(lite / full / ultra)。
- コマンド: `/ponytail-review`(差分の過剰設計指摘。`finish-task` の品質ゲート前に実行)、`/ponytail-audit`、`/ponytail-debt`。

**TDD/カバレッジ 80% との両立**: はしごが削るのはプロダクションコードの過剰な抽象化・自作・先回り実装であり、
テストコード・境界での入力検証・セキュリティ実装・アクセシビリティ(a11y)は削減対象外。
「最小実装」とは検証やテストを省くことではなく、要求を満たす最小の設計を選ぶことを指す。

### 初回セットアップ
- 本リポジトリの `.claude/settings.json` により、ponytail マーケットプレイスはフォルダを開いた時点で
  自動登録される(初回はフォルダ trust の確認プロンプトが出る)。
- ただしプラグイン本体は個別インストールが必要な場合がある。有効にならないときは
  `/plugin marketplace add DietrichGebert/ponytail` → `/plugin install ponytail@ponytail` を実行する。
- Node.js が非対話シェルの PATH に必要。
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

## PJ 固有の運用差分
<!-- gen: 無ければ「特記事項なし」 -->
- {{WORKFLOW_DIFFS}}

# Agent モデル/effort ポリシー

各 Agent が使用するモデルと effort(思考量)の標準ポリシー。
`.claude/agents/*.md` の frontmatter(`model` / `effort`)は本ポリシーに従って設定する。

## ポリシー表

| Agent | モデル | effort | 理由 |
|---|---|---|---|
| pm(メインセッション) | Claude Fable 5.1(最新版) | High | オーケストレーション・要件分解・判断の質が全体を決める。**最上位モデルはメインセッションのみ** |
| qa-engineer | opus(最新版) | high | 実装から独立した唯一の品質ゲート。競合・冪等性・データ整合性の見落としが本番障害に直結する |
| backend-engineer | opus(最新版) | 既定(セッション継承) | 並行実行・データ整合性・非機能(N+1、入力上限)の見落としが実績として多い層 |
| db-engineer | opus(最新版) | 既定(セッション継承) | 同上。スキーマ・権限の誤りは後戻りコストが最も高い |
| frontend-engineer | sonnet(最新版) | 既定(セッション継承) | 仕様が具体的な画面実装はコスト優先。複雑な部品(グラフ・ドラッグ&ドロップ・リアルタイム更新)は**委任時に PM が個別に `opus` を指定**する |

## 原則

- 各モデルは**その時点の最新版**を使う。frontmatter にはエイリアス(`sonnet` / `opus` / `fable` 等)を書き、最新版への解決はエイリアスに任せる。
- **日付付き model ID(例: `claude-xxx-20260101`)を agent 定義に直書きしない**。baseline の警告ルール(`agents/no-pinned-model`)で検査される。
- PM はサブエージェントではなくメインセッションのため frontmatter を持たない。モデルは実行者が `/model` 等で選択する。
- モデルを上げるのは「見落としが高くつく層」に限る。効果とコストは実測(`docs/DEVELOPMENT_WORKFLOW.md` の運用記録)で見直す。

## 根拠

本ポリシーは cctower PJ(26 PR)の運用実績に基づく。

- 実装側のセルフ品質ゲート通過後も、独立レビューの **HIGH 指摘による差戻しが 26 件中 13 件**発生した。
- 独立 QA が、実装側のテストをすり抜けたバグを **6 件**発見した。
- 欠陥は次の 4 型に集中した:
  1. **競合・冪等性**(worker と手動実行の同時起動、再実行による二重処理)
  2. **データ整合性**(同期カーソルの取りこぼし、部分失敗後の外部リソース二重作成)
  3. **非機能**(N+1 クエリ、入力上限の欠如)
  4. **a11y・失敗表示不足**(キーボード到達不可、失敗経路の未実装)
- 1〜3 は FE 実装より BE / DB 層の判断で作り込まれる比率が高かったため、BE / DB を上位モデルに置き、FE はコスト優先とした。

出典(`novexar/cctower`):

- `docs/decisions/0003-engineer-model-policy.md`
- `docs/qa/phase1-acceptance.md`

## モデル更新時のチェックリスト

- [ ] エイリアスの解決先(最新版がどのモデルか)を確認した
- [ ] **エイリアスが実際に解決したモデルを、サブエージェントの実行ログで確認した**(frontmatter の値だけを証拠にしない)
- [ ] コスト影響(単価・想定トークン量)を確認した
- [ ] agent frontmatter に日付付き model ID が混入していないか確認した

## 仕様の根拠

エイリアス(`sonnet` / `opus` / `haiku` / `fable` / `inherit`)と effort(`low` / `medium` / `high` / `xhigh` / `max`)は
Claude Code 公式ドキュメント https://code.claude.com/docs/en/sub-agents で確認(確認日: 2026-09-16)。

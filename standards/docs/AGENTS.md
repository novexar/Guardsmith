# Agent モデル/effort ポリシー

各 Agent が使用するモデルと effort(思考量)の標準ポリシー。
`.claude/agents/*.md` の frontmatter(`model` / `effort`)は本ポリシーに従って設定する。

## ポリシー表

| Agent | モデル | effort | 理由 |
|---|---|---|---|
| pm(メインセッション) | Claude Fable 5.1(最新版) | High | オーケストレーション・要件分解・判断の質が全体を決める |
| qa-engineer | fable(最新版) | high | レビュー精度と網羅性を優先 |
| backend-engineer / frontend-engineer / db-engineer | sonnet(最新版) | 既定(セッション継承) | 仕様確定後の実装はコスト/速度優先 |

## 原則

- 各モデルは**その時点の最新版**を使う。frontmatter にはエイリアス(`sonnet` / `fable` 等)を書き、最新版への解決はエイリアスに任せる。
- **日付付き model ID(例: `claude-xxx-20260101`)を agent 定義に直書きしない**。baseline の警告ルール(`agents/no-pinned-model`)で検査される。
- PM はサブエージェントではなくメインセッションのため frontmatter を持たない。モデルは実行者が `/model` 等で選択する。

## モデル更新時のチェックリスト

- [ ] エイリアスの解決先(最新版がどのモデルか)を確認した
- [ ] コスト影響(単価・想定トークン量)を確認した
- [ ] agent frontmatter に日付付き model ID が混入していないか確認した

## 仕様の根拠

エイリアス(`sonnet` / `opus` / `haiku` / `fable` / `inherit`)と effort(`low` / `medium` / `high` / `xhigh` / `max`)は
Claude Code 公式ドキュメント https://code.claude.com/docs/en/sub-agents で確認(確認日: 2026-09-16)。

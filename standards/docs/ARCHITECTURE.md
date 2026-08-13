<!-- gen: アーキテクチャ設計書の雛形。CLAUDE.md「技術スタック」と矛盾しないこと。構成図は Mermaid で描く。完成後 gen: コメントと {{ を全削除。 -->
# アーキテクチャ設計 — {{PROJECT_NAME}}

## 1. 全体構成
```mermaid
{{ARCHITECTURE_DIAGRAM}}
```

## 2. コンポーネント
| コンポーネント | 役割 | 技術 |
|---|---|---|
| {{COMPONENT}} | {{ROLE}} | {{TECH}} |

## 3. データフロー
{{DATA_FLOW}}

## 4. 認証・認可
{{AUTH_DESIGN}}

## 5. デプロイ構成
<!-- gen: 環境(DEV/PRD)ごとの差分・コスト方針を表で -->
{{DEPLOYMENT}}

## 6. 設計判断の記録(ADR 要約)
<!-- gen: 「なぜこの技術/構成にしたか」を1判断1行で。詳細ADRが必要になったら docs/adr/ に切り出す -->
| # | 判断 | 理由 | 代替案 |
|---|---|---|---|
| 1 | {{DECISION}} | {{REASON}} | {{ALTERNATIVES}} |

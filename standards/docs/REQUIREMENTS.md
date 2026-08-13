<!-- gen: 要件定義書の雛形。オーナーインタビュー結果で全節を埋める。推測で書かず、未確定は「TBD(確認先: オーナー)」と明記。完成後 gen: コメントと {{ を全削除。 -->
# 要件定義 — {{PROJECT_NAME}}

## 1. 背景・目的
{{BACKGROUND}}

## 2. スコープ
### 対象(In Scope)
- {{IN_SCOPE}}
### 対象外(Out of Scope)
- {{OUT_OF_SCOPE}}

## 3. ユーザー・ロール
| ロール | 説明 | 主な操作 |
|---|---|---|
| {{ROLE}} | {{DESC}} | {{OPERATIONS}} |

## 4. 機能要件
<!-- gen: 「FR-<連番>: <要件名>」で採番。各要件に受け入れ条件を必ず付ける(Issue起票時にそのまま使う) -->
### FR-001: {{FEATURE_NAME}}
- 概要: {{SUMMARY}}
- 受け入れ条件:
  - [ ] {{ACCEPTANCE_CRITERIA}}

## 5. 非機能要件
| 項目 | 要件 |
|---|---|
| 性能 | {{PERFORMANCE}} |
| セキュリティ | {{SECURITY}} |
| 可用性 | {{AVAILABILITY}} |
| コスト | {{COST}} |

## 6. 制約・前提
- {{CONSTRAINTS}}

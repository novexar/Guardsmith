# ADR 0002: フロントエンド検証ルールは baseline ではなく presets/frontend.yaml に分離する

- **日付**: 2026-09-16
- **ステータス**: 採択
- **決定者**: オーナー承認

## 背景

ダッシュボード系 UI の標準スタック(`standards/docs/FRONTEND_STANDARDS.md`)と DESIGN.md 運用の導入に伴い、
FE 系の機械検証ルール(DESIGN.md の存在・具体化完了、shadcn 設定、競合 UI ライブラリ検知)を
どのプリセットに置くかを決める必要があった。

## 決定

FE 系ルールは `presets/baseline.yaml` に追加せず、新規プリセット `presets/frontend.yaml` に分離する。
FE を持つ PJ のみが `guard.policy.yaml` の `extends` に baseline と併せて frontend プリセットを追加する。

```yaml
extends:
  - github:novexar/guardsmith//presets/baseline.yaml@vX.Y.Z
  - github:novexar/guardsmith//presets/frontend.yaml@vX.Y.Z # FE を持つ PJ のみ
```

## 理由

1. **BE のみ PJ の誤警告回避**: 現行の lint エンジンには「FE が存在する場合のみ適用する」といった
   条件付きルールの仕組みが無い。baseline に FE ルールを入れると、バックエンドのみの PJ で
   DESIGN.md / components.json 欠落が常に警告され、ノイズが exemption 運用を汚染する。
2. **3層 overlay 設計との整合**: resolver は extends の多段マージ(後勝ち)を既に実装済みであり、
   「必要な PJ だけがプリセットを重ねる」構成は docs/LAYERING.md の設計思想そのもの。
   条件分岐をエンジンに追加するより、プリセットの合成で表現する方が小さい(ponytail)。
3. **配布の一貫性**: baseline / frontend とも同一リポジトリからタグ固定で配布でき、
   `preset:frontend`(ローカル・CLI 同梱)と `github:...//presets/frontend.yaml@vX.Y.Z`(リモート)の
   両参照が既存機構のまま動く。

## 代替案

| 案                                             | 不採用の理由                                                           |
| ---------------------------------------------- | ---------------------------------------------------------------------- |
| baseline に FE ルールを追加                    | BE のみ PJ が誤警告を受ける。exemption での握りつぶし運用が常態化する  |
| エンジンに条件付きルール(if 節)を実装する      | エンジンの複雑化。プリセット合成で十分表現できるため過剰実装(ponytail) |
| FE ルールを各 PJ の guard.policy.yaml に直書き | 標準の一元管理が崩れ、改訂がタグ更新で波及しない                       |

## 影響

- `init-project` スキルに「FE がある PJ は extends に frontend プリセットを追加する」手順を追加。
- FE の無い PJ は DESIGN.md / `.claude/templates/frontend/` を削除するだけでよく、検証への影響なし。
- 将来 FE ルールを増やす場合も frontend.yaml に追加する(baseline には入れない)。

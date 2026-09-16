<!-- ============================================================
  gen: デザイン仕様書の雛形。init-project 実行時にこのファイルを直接編集して具体化する。
  1. 参考にする design-md(既存サービスのトーン・類似ダッシュボード等)を PM が
     オーナーに確認し、その回答をもとに {{PLACEHOLDER}} を具体化する。
  2. 「Novexar ダッシュボード標準」と明記された既定値(ダークモード既定・hairline border・
     アクセント1色・ステータス3色)は原則維持する。変更にはオーナー承認が必要。
  3. FE が存在しない PJ では本ファイルごと削除する。
  4. 完成後、gen: コメントを削除し、{{ が残っていないことを検証する
     (frontend プリセットの frontend/design-md-initialized が機械検査する)。
============================================================ -->

# DESIGN.md — {{PROJECT_NAME}}

このファイルは AI エージェントが正確な日本語 UI を生成するためのデザイン仕様書です。
UI 実装前に必読。逸脱が必要な場合は PM に確認する(`docs/FRONTEND_STANDARDS.md` も参照)。

## 1. Visual Theme & Atmosphere

<!-- gen: PJ の性質(業務ダッシュボード/監視ツール/管理画面 等)に合わせて 2〜3 行で具体化 -->

- {{VISUAL_THEME_DESCRIPTION}}
- **ダークモード既定**(Novexar ダッシュボード標準)。ライトモードは要件がある場合のみ追加。
- 高情報密度・実用重視。装飾より状況把握のしやすさを優先する。

## 2. Color Palette & Roles

### Primary(アクセントカラー)

<!-- gen: アクセントは 1 色のみ。ブランドカラーが無ければオーナーに確認して決定 -->

| 用途 | 値 |
| --- | --- |
| Accent(主要アクション・選択状態・フォーカス) | {{ACCENT_COLOR}} |

### Semantic(ステータス色)

意味を持つ色はステータス 3 色のみ。それ以外の色に意味を持たせない。

| ロール | 用途 | 値 |
| --- | --- | --- |
| success | 正常・完了 | {{SUCCESS_COLOR}} |
| warning | 注意・保留 | {{WARNING_COLOR}} |
| danger | 異常・失敗・破壊的操作 | {{DANGER_COLOR}} |

### Neutral(ニュートラル)

<!-- gen: shadcn/ui のテーマトークン(background / foreground / muted / border)に対応させる -->

| ロール | 用途 | 値 |
| --- | --- | --- |
| background / surface | 画面・カード背景(ダーク基調) | {{NEUTRAL_BG}} |
| foreground / muted | 本文・補助テキスト | {{NEUTRAL_FG}} |
| border | hairline border(1px・低コントラスト) | {{NEUTRAL_BORDER}} |

## 3. Typography Rules

### 3.1 font-family 指定

```css
/* 本文・UI(欧文/数字を Inter で、和文グリフを Noto Sans JP でフォールバック) */
font-family: "Inter", "Noto Sans JP", system-ui, sans-serif;
/* 等幅(ID・ログ・数値カラム) */
font-family: "JetBrains Mono", ui-monospace, monospace;
```

<!-- gen: フォント指定を変更する場合のみ書き換える。和文フォールバックは必ず残す -->

### 3.2 文字サイズ・ウェイト階層

| Role | Size | Weight | Line Height |
| --- | --- | --- | --- |
| Display(KPI 数値) | {{DISPLAY_SIZE}} | 600 | 1.2 |
| Heading | {{HEADING_SIZE}} | 600 | 1.4 |
| Body | {{BODY_SIZE}} | 400 | 1.6 |
| Caption / Label | {{CAPTION_SIZE}} | 400–500 | 1.5 |

### 3.3 行間・字間(日本語 UI 仕様)

- 日本語本文の行間は `line-height: 1.5` 以上(1.5〜2.0 の範囲。表・高密度 UI は 1.5 寄り)。
- 見出し・ラベルの字間は `letter-spacing: 0.04em〜0.1em` の範囲で調整(本文は 0 でよい)。
- 数値カラムは `font-variant-numeric: tabular-nums` で桁を揃える。

### 3.4 禁則処理・改行ルール

- `overflow-wrap: anywhere` を既定とし、日本語の不自然な折り返しは `word-break: keep-all` +
  `line-break: strict` で制御する(見出し・ラベル)。
- 約物のぶら下がり・行頭禁則はブラウザ既定(`line-break: strict`)に従う。

### 3.5 OpenType 機能

- 和文プロポーショナル詰め: `font-feature-settings: "palt"`(見出し・ラベルに適用。表・本文は非適用)。
- カーニング: `font-kerning: normal`(`"kern"` 有効)。

## 4. Component Stylings

<!-- gen: shadcn/ui のデフォルトからの差分だけを書く。差分が無い項目は「shadcn 既定」と書く -->

### Buttons

- {{BUTTON_STYLE}}(primary はアクセント色。destructive は danger 色。それ以外は ghost/outline 基調)

### Inputs

- {{INPUT_STYLE}}(hairline border。フォーカスリングはアクセント色)

### Cards

- {{CARD_STYLE}}(hairline border + 余白で区切る。装飾的シャドウは使わない)

## 5. Layout Principles

- Spacing Scale: Tailwind 既定スケール(4px 基準)を使用。任意値の乱用禁止。
- Container: {{CONTAINER_RULE}}(ダッシュボードは全幅基調。中央寄せ固定幅は設定画面等のみ)
- Grid: KPI カード列 → チャート/テーブルの順。1画面で状況把握できる密度を維持する。

## 6. Depth & Elevation

- 階層は背景色の濃淡と hairline border で表現する。
- 装飾的シャドウ・多色グラデーション禁止(Novexar ダッシュボード標準)。
  例外はオーバーレイ系(Dialog / Popover / DropdownMenu)の shadcn 既定シャドウのみ。

## 7. Do's and Don'ts

### Do(推奨)

- loading・empty・error の3状態を必ず設計する(skeleton / 空状態の案内文 / 再試行導線)。
- ステータスは色+アイコン/テキストの併用(色覚多様性への配慮)。
- 区切りは余白と hairline border。情報密度を保つ。

### Don't(禁止)

- アクセント色の複数使用、意味のない色分け。
- 装飾的シャドウ・多色グラデーション。
- @mui / antd / @chakra-ui 等の競合 UI ライブラリ混在(frontend プリセットが警告)。

## 8. Responsive Behavior

<!-- gen: 主対象デバイスをオーナーに確認して具体化。内製ダッシュボードはデスクトップ優先が既定 -->

- Breakpoints: {{BREAKPOINTS}}(既定: デスクトップ優先。モバイルは閲覧のみ保証等、範囲を明記)
- タッチターゲット: 最小 44×44px(モバイル対応する場合)。
- フォントサイズ: ズーム・OS 設定拡大を妨げない(px 固定の `user-select` 阻害等をしない)。

## 9. Agent Prompt Guide

### クイックリファレンス

```
Theme: dark (default)
Accent Color: {{ACCENT_COLOR}}
Status Colors: success {{SUCCESS_COLOR}} / warning {{WARNING_COLOR}} / danger {{DANGER_COLOR}}
Font: "Inter", "Noto Sans JP", system-ui, sans-serif
Body Size: {{BODY_SIZE}} / line-height 1.6 / tabular-nums for numbers
Border: hairline (1px, low-contrast) / no decorative shadows
```

### プロンプト例

「この DESIGN.md と docs/FRONTEND_STANDARDS.md に従って、○○一覧の DataTable 画面
(loading / empty / error 状態を含む)を作成してください。」

<!--
  出典: 本雛形の構成は awesome-design-md-jp (https://github.com/kzhrknt/awesome-design-md-jp,
  MIT License) の template/DESIGN.md を基に、Novexar ダッシュボード標準を反映して編集したもの。
-->

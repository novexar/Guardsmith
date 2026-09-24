# フロントエンド UI 基盤標準 — React SPA / ダッシュボード

> 内製ツール・ダッシュボード系 UI を構築する PJ の標準スタックと設計原則。
> UI 実装前に本書と `/DESIGN.md` を必読すること(frontend-engineer の作業前提)。

## 標準スタック

| レイヤー | 採用 | 備考 |
| --- | --- | --- |
| ビルド/ルーティング | Vite + TanStack Router | SSR 不要な内製ツール前提。Next.js は SEO/SSR 等の要件がある場合のみ |
| データ取得 | TanStack Query | `refetchInterval` と SSE の併用パターンを標準化 |
| コンポーネント基盤 | shadcn/ui + Tailwind CSS | コードを自リポジトリに保持(コピペ方式)。Base UI / Radix はどちらでも可、PJ 内で統一 |
| ダッシュボード部品 | Tremor(KPIカード・スパークライン・Tracker・BarList・AreaChart) | shadcn と同じコピペ方式で取り込む |
| チャート | shadcn Chart(Recharts)基本、リアルタイム/高密度は Tremor | 1画面1系統(二重採用しない) |
| テーブル | TanStack Table + shadcn DataTable | ソート/フィルタ/ページングの標準実装を `.claude/templates/frontend/` に置く |
| ナビゲーション | shadcn Sidebar(折りたたみ)+ cmdk コマンドパレット(Cmd/Ctrl+K) | パレットに作成系アクション・検索・画面遷移を集約 |
| テーマ | ダークモード既定・アクセント1色・ステータス色(success/warning/danger)のみ意味を持つ | 装飾的シャドウ・多色グラデーション禁止 |
| 型共有 | openapi-typescript(FastAPI の OpenAPI から生成) | Pydantic を正とする(手書きの重複型定義を作らない) |

- **参照実装**: [satnaing/shadcn-admin](https://github.com/satnaing/shadcn-admin) — 構造・ディレクトリ命名の参考にする。コードのコピーはしない。

## ダッシュボード UI 4原則

1. **密度**: 高情報密度を恐れない。1画面で状況が把握できることを優先し、スクロールやページ遷移で情報を分散させない。
2. **色**: 意味を持つのはステータス色(success / warning / danger)のみ。アクセントは1色。その他はニュートラルの濃淡で表現する。
3. **余白**: 区切りは hairline border(1px・低コントラスト)と余白で表現し、線や枠を増やさない。
4. **状態表現**: loading・empty・error の3状態を必ず設計する。データが無い/取れない画面を「白紙」にしない。

## 禁止事項

- **競合 UI ライブラリの混在禁止**: `@mui/*`(Material UI)/ `antd` / `@chakra-ui/*` を標準スタックと併用しない。
  frontend プリセット(`frontend/no-competing-ui-libs`)が package.json を検査し警告する。
- チャートライブラリの二重採用禁止(1画面1系統。前掲表を参照)。
- 装飾的シャドウ・多色グラデーションの使用禁止(`/DESIGN.md` の Do's and Don'ts を参照)。

## 関連ドキュメント

- 検証プリセット(frontend)の追加手順: `.claude/skills/init-project/SKILL.md`(初回セットアップ時に実施)
- デザイン仕様: `/DESIGN.md`(PJ ごとに init-project で具体化)
- 構成テンプレート: `.claude/templates/frontend/`(構成と命名の参照。実 PJ は scaffold ツールで生成)
- コーディング規約: `docs/CODING_STANDARDS.md`

<!-- ============================================================
  gen: フロントエンド構成テンプレート(参照用)。実行可能なアプリではない。
  - FE が存在しない PJ では init-project がこのフォルダごと削除する。
  - FE がある PJ でも、実アプリはこのフォルダをコピーせず scaffold ツールで生成し、
    本テンプレの「構成・命名」に合わせる(下記手順)。生成後もフォルダは参照用に残してよい。
============================================================ -->

# frontend テンプレート — 構成と命名の参照

`docs/FRONTEND_STANDARDS.md` の標準スタック(Vite + TanStack Router/Query/Table +
shadcn/ui + Tailwind + Tremor + cmdk)における**ディレクトリ構成・命名・最小実装の形**を示す。

## 使い方

1. 実 PJ では次で生成する(このフォルダのコピーではない):
   - `pnpm create vite <app> --template react-ts`
   - `pnpm dlx shadcn@latest init`(components.json が生成される)
   - `pnpm dlx shadcn@latest add sidebar table chart` 等、必要なコンポーネントを追加
2. 生成後、本テンプレの構成・命名(`src/routes/` / `src/components/` / ファイル名)に合わせる。
3. 構造の参考: [satnaing/shadcn-admin](https://github.com/satnaing/shadcn-admin)(コピーはしない)。

## 構成

```
├── package.json          ← 依存の目安(メジャーバージョンのみ)
├── components.json       ← shadcn/ui 設定例
├── vite.config.ts        ← Vite + TanStack Router プラグイン
├── src/
│   ├── styles/globals.css        ← Tailwind v4 CSS-first 設定 + テーマトークン
│   ├── routes/__root.tsx         ← Sidebar レイアウト(全画面共通)
│   └── components/
│       ├── app-sidebar.tsx       ← shadcn Sidebar(折りたたみ)
│       ├── command-palette.tsx   ← cmdk(Cmd/Ctrl+K)
│       ├── data-table.tsx        ← TanStack Table 最小
│       └── kpi-card.tsx          ← KPI カード(Tremor 風)
```

## 削除条件

- FE の無い PJ: init-project が本フォルダを削除する(DESIGN.md も同時に削除)。

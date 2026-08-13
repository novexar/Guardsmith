# Changelog

## v0.2.1 (2026-08-13)

### Changed

- README を導入ガイドとして刷新(新規PJ / 既存PJ / CI / 標準更新への追随の一連手順)。
  standards/README.md も「guard new で生成されたPJ」視点に刷新(旧 Template repository 方式の記述を廃止)
- 公開準備: 内部開発ドキュメント(引き継ぎ書・検証記録)を削除し、公開向けに文言整理。
  リモート参照タグを v0.2.1 に更新
- リポジトリ履歴を公開用に初期化(旧タグ v0.1.0 / v0.2.0 は削除。以下の記録は参考)

## v0.2.0 (2026-08-12)

### Added

- `github:` リモートresolver: extends / drift source のタグ固定取得、
  `~/.guardsmith/cache` キャッシュ、`--no-cache`、`GITHUB_TOKEN` による private 対応、
  パストラバーサル対策、extends の多段解決(3層 overlay)と循環検出
- `guard sync`: drift ファイルのマスター復元(dry-run 既定 / `--write`、
  `allow_sections` 保全、欠落ファイル作成)
- `guard new <dir>`: standards/ 一式の新規PJ展開(D-001: A案で配布を一本化)
- GuardSmith Lint GitHub Action(`packages/action`): SARIF + Job Summary + PRコメント
- npm 公開可能なパッケージング: `@guardsmith/core`(dist + presets/standards 同梱)、
  `@guardsmith/cli`(`guard` bin)
- README.en.md、SECURITY.md、Issue テンプレート

### Changed

- drift / sync の比較を EOL 正規化(CRLF/LF 差を drift とみなさない)
- vitest 移行(カバレッジ80%ゲート)、pnpm workspace 化、eslint + prettier、CI、
  セルフ適用(presets/self.yaml)

### Fixed

- `guard init` が存在しない `preset:novexar-baseline` を参照していた問題
  (`preset:baseline` に修正)

## v0.1.0 (2026-08-12)

- 初回統合リリース: 旧 novexar/claude-standards(標準テンプレート)と
  aidev-guard(検証エンジン)を統合。8 check 種別の lint エンジン + CLI
  (init / lint / explain)+ presets/baseline.yaml + standards/ マスター

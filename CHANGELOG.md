# Changelog

## @guardsmith/core 0.2.3 (2026-08-14)

### Fixed

- `guard new` で展開したプロジェクトに `.gitignore` が含まれない問題(#1)。
  npm pack が `.gitignore` をパッケージから常に除外する仕様が原因。prepack で
  ドットなし(`standards/gitignore`)にして同梱し、`guard new` の展開時に復元する。
  GitHub Releases バンドル経由は従来から影響なし

## v0.4.0 (2026-08-14)

### Added

- **GitHub Releases での単一バンドル配布**: 依存をすべて同梱した `guard.mjs` + presets/standards の
  tar.gz をリリースに添付。npm レジストリへ到達できない環境(閉域網・egress制限)でも
  GitHub のみで CLI を利用可能に(`node guard.mjs lint`)
- **Action の取得元選択**: `source: npm | release` 入力を追加(既定 npm)。`release` は
  GitHub Releases のバンドルを使用し、npm レジストリ不要で実行(`release-tag` でタグ固定)
- npm パッケージに日英併記の README を同梱(`@guardsmith/core` / `@guardsmith/cli` 0.2.2 —
  これまで npmjs.com 上で説明が表示されていなかった問題の解消)

### Changed

- `guard new` の参照タグを npm バージョンから分離(`STANDARDS_TAG`)。標準の内容が変わった
  リリースでのみ参照タグを上げる運用に(現在 v0.2.1)

## v0.3.0 (2026-08-13)

### Changed

- GitHub Action をリポジトリルート(`action.yml`)へ移設し、Marketplace 公開可能な構成に。
  利用側は `uses: novexar/Guardsmith@v0.3.0` に変更(旧 `packages/action` は削除)
- Action の CLI 取得を「リポジトリ checkout + pnpm install」から npm 公開版の
  `npx @guardsmith/cli`(`cli-version` 入力でバージョン固定)へ変更 — セットアップが不要になり高速化。
  `guardsmith-ref` 入力は廃止(`cli-version` に置換)

npm パッケージ(@guardsmith/core / cli)は 0.2.1 のまま(CLI 本体に変更なし)。

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

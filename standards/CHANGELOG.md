# Changelog

## v0.6.0
- コードレビューを PM から独立 QA(`qa-engineer`)へ移管。QA がコードレビューと受入検証の両方を持つ
- エンジニアのモデル方針を刷新(backend / db は `opus`、frontend は `sonnet`、qa は `opus` + `effort: high`)
- CLAUDE.md の `@` インポートを常駐が必要な 1 文書(`docs/CODING_STANDARDS.md`)のみに限定。
  他の文書は通常パス + 「読む条件」で記載する
- 行数規則(50 / 800 / 4)を閾値ではなく目安に変更
- 初回セットアップを `docs/SETUP.md` へ分離(`docs/DEVELOPMENT_WORKFLOW.md` は日常運用のみ)
- Issue ごとの作業状態を `.guardsmith/state/<issue番号>.md` に現在状態として上書き記録
- init-project の frontend プリセット例を `@v0.6.0` に更新

## v0.1.0
- 初版: CLAUDE.md 雛形 / agents 4種 / skills 4種 / docs 雛形 / GitHub テンプレ

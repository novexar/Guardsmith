# Changelog

[English](CHANGELOG.md) | **日本語**

## v0.6.0 (2026-09-24)

「**どれだけ文脈を常駐させるか**」と「**誰が品質を確認するか**」を整理するリリース。
`guard lint` に `import-budget` を追加し、`CLAUDE.md` 本体と `@path` インポート先を
合わせた常駐量を測れるようにした(60 行の `CLAUDE.md` でも 5 文書をインポートしていれば
軽量ではなく、行数だけでは見えなかった)。標準側はコードレビューを独立 QA へ移す。
既存 PJ の追随手順は docs/migration/v0.6.0.ja.md を参照。

### Added

- 新 check `import-budget`: 起点ファイルと `@` インポートで到達する全ファイルの常駐合計量を
  測る。常に `info` を 1 件出し
  (`resident context: N files, X chars (≈Y tokens, rough estimate)` + ファイル別内訳)、
  `max_chars` 超過時は rule の severity で報告する。
  `with: { path, max_chars?, max_depth? }`。`max_depth` の既定は公式仕様の上限 4 hops
- インポートの意味論は Claude Code の memory ドキュメントに準拠: `@path` はファイル中の
  どこでも有効、相対パスはそのファイルのディレクトリ基準、コードスパン・フェンスドコード
  ブロックは読み飛ばす。循環・未解決・深さ上限はいずれも `info`。走査ルート外を指す参照
  (`..`・絶対パス・`~/`・バックスラッシュ・外を指すシンボリックリンク)は**読みに行かず**
  報告のみ
- baseline: `claude-md/thin-diff` の直後に `claude-md/import-budget`
  (warn、`max_chars: 32000`)
- 標準 v0.6.0: コードレビューを PM から独立 QA(`qa-engineer`)へ移し、QA がレビューと
  受入検証の両方を持つ / エンジニアのモデル方針を刷新(BE・DB は `opus`、FE は `sonnet`、
  QA は `opus`)/ `CLAUDE.md` の `@` インポートを常駐が必要な 1 文書のみに絞る /
  初回セットアップを `docs/SETUP.md` へ分離 / Issue ごとの作業状態を `.guardsmith/state/` に記録

### Changed

- 標準: `@docs/...` は**インポート**であることを明記した。docs/ へ移して `@` 参照にしても
  文脈量は減らない。`@` を付けるのは `docs/CODING_STANDARDS.md` のみとし、他は通常パス +
  「読む条件」で記載する
- 標準: 行数規則(50 / 800 / 4)を閾値ではなく**目安**に変更
- baseline `claude-md/thin-diff`: description を「本体行数のみ。常駐量は
  `claude-md/import-budget`」に補足
- リモート参照タグ・生成物のスタンプを v0.6.0 に更新(baseline の drift source /
  `guard new` の policy 生成 / docs 例示 / Action の `release-tag` 既定)
- npm: `@guardsmith/core` / `@guardsmith/cli` 0.5.0(Action の `cli-version` 既定も 0.5.0)

### Breaking

- **ポリシースキーマが再び厳格になった**。`with` の未知キーとルール直下の未知キーが
  **parse エラー**になり、該当パス付きで報告される
  (`rules.0.with: Unrecognized key: "limt"`)。従来は黙って捨てられていた
  (`Rule` を `discriminatedUnion(...).and(RuleBase)` で合成しており、intersection を通ると
  ブランチ側の strict 判定が失われていたため)。typo を含むポリシーは読み込めなくなるが、
  これが文書どおりの挙動(「未知のキーは拒否。typo はエラーになる」)
- **baseline v0.6.0 は `@guardsmith/cli` 0.5.0 以上が必要**。`import-budget` check を含み、
  旧 CLI は strict スキーマで未知の check として拒否する。extends タグを上げる前に CLI を
  上げること
- **`CLAUDE.md` 内のパッケージ名はバッククォートで囲む必要がある**。`@` はファイル中の
  どこでも有効(日本語では文中に `@` が現れるため必須)なので、`@scope/pkg` を裸で書くと
  Claude Code もインポートとして読みに行き、`import-budget` は `unresolved import` の info を
  出す。公式仕様どおりバッククォートで囲むこと

## v0.5.2 (2026-09-24)

`guard lint` / `guard sync` の走査対象を「**コミットされうるファイル**」に絞るリリース。
リポジトリ直下に巨大な除外済みツリー(各自 `.venv` / `node_modules` を持つエージェント
worktree 等)を抱える PJ で毎回その走査コストを払わなくなり、`secret-scan` が
リポジトリに入らないファイルを報告しなくなる。既存 PJ の追随手順は docs/migration/v0.5.2.ja.md を参照。

### Added

- ポリシー: トップレベル `ignore` キー(glob 配列)。全走査から除外する。`rules` と違い
  extends 間で**連結**される(重複は除去)ため、組織 overlay の除外が各 PJ に届く
- `guard lint` / `guard sync`: `--no-gitignore` で全走査に戻す(`--no-cache` と同じ扱い)。
  ポリシーの `ignore` と `.git/` の除外は引き続き効く
- `@guardsmith/core`: `runLint(policy, root, now?, { gitignore })` /
  `planSync(policy, root, { gitignore })`。新設の `glob` モジュールを公開

### Changed

- 全てのファイル走査が既定で `.gitignore`(入れ子の `.gitignore` も)に追従し、`.git/` を
  常に除外するようになった。`secret-scan` は `.claude/settings.local.json` 等を走査せず、
  `file-exists` は `.gitignore` 対象のパスを「存在しない」と扱う
- 除外対象は**走査の時点で枝刈り**する(結果フィルタではない)。5,000 ファイルの疑似 `.venv`
  を含む fixture で `.claude/**` の走査は 8.6ms → 0.7ms
- baseline `security/no-secrets-in-context`: `paths` に `!.claude/worktrees/**` を追加
  (presets/self.yaml と同じ)。旧 CLI でもエージェント worktree が除外される。
  baseline には `ignore:` キーを**入れない** — CLI 0.3.0 の strict スキーマが未知キーを拒否するため
- リモート参照タグ・生成物のスタンプを v0.5.2 に更新(baseline の drift source /
  `guard new` の policy 生成 / docs 例示 / Action の `release-tag` 既定)
- npm: `@guardsmith/core` / `@guardsmith/cli` 0.4.0(Action の `cli-version` 既定も 0.4.0)。
  **0.4.0 は npm に未公開** — 同日リリースの v0.6.0 に同梱された 0.5.0 に置き換わった。
  0.5.0 以上を使うこと

## v0.5.1 (2026-09-16)

GuardSmith ランタイム成果物(`.guardsmith/` の CI 結果 JSON、`.claude/settings.local.json`)の
commit/push 防止を仕組み化するリリース。既存 PJ の追随手順は docs/migration/v0.5.1.ja.md を参照。

### Added

- baseline 新ルール: `hygiene/guardsmith-artifacts-ignored`(warn で開始)。
  `.gitignore` に `.guardsmith/` と `.claude/settings.local.json` の除外行があることを検査
  (CI 結果 JSON はリポジトリ名・ブランチ名・SHA 等の PJ 固有情報、settings.local.json は
  hooks の URL/トークンを含むため)
- `finish-task` スキル: コミット前チェックに「`.guardsmith/` / `.claude/settings.local.json` が
  ステージに含まれていないことの確認」を追加

### Changed

- standards/docs/CI_CD.md: CI 結果 JSON の「リポジトリへのコミット/プッシュ禁止」を明文化
- リモート参照タグ・生成物のスタンプを v0.5.1 に更新(baseline の drift source /
  `guard new` の policy 生成 / docs 例示 / Action の `release-tag` 既定)
- npm: `@guardsmith/core` / `@guardsmith/cli` は 0.3.0 に同梱(0.3.0 は未公開だったため据え置き)

## v0.5.0 (2026-09-16)

標準の大規模刷新リリース(PR #3〜#7 を集約)。標準参照タグ(`STANDARDS_TAG`)を v0.5.0 に更新。
既存 PJ の追随手順は docs/migration/v0.5.0.ja.md を参照(タグ固定のため放置しても壊れない。追随は任意・段階適用可)。

### Added

- **A: フロントエンド UI 基盤標準**: shadcn/ui + Tailwind + TanStack を標準スタックとして採用。
  `presets/frontend.yaml` を新設(FE を持つ PJ のみ `extends` に追加。baseline には含めず
  BE のみの PJ への誤警告を回避)。詳細: standards/docs/FRONTEND_STANDARDS.md
- **C: ponytail 導入**(過剰実装抑制): `.claude/settings.json` でマーケットプレイスを自動登録、
  `finish-task` の品質ゲート前に `/ponytail-review` を実行。テスト・入力検証・セキュリティ・a11y は
  削減対象外と明記
- **D: DESIGN.md 運用**: awesome-design-md-jp ベースのデザイン仕様テンプレート(日本語 UI 仕様込み)を
  標準に追加。init-project で PJ ごとに具体化
- **F: Issue テンプレート標準化と外部連携の受け口**: feature / bug / chore の3種・固定見出し
  (旧 task.md は廃止)。`start-task` のブランチ命名を `<type>/<issue番号>-<slug>` に統一
  (外部ツールがブランチ名から Issue 番号を逆引きする契約)。HTTP hooks サンプル
  (`.claude/settings.local.json.example`)を同梱
- baseline 新ルール: `agents/no-pinned-model` / `ci/no-remote-test-workflows`(いずれも warn で開始)

### Changed

- **B: CI/CD 方針変更**: 日常 CI は Docker ローカル(`make ci`)に移行し、GitHub Actions は
  main push の deploy のみに。CI 結果 JSON を `.guardsmith/ci-results/` に出力し外部ツールの
  受け口とする。GuardSmith 自身は fork PR 限定の External PR CI を維持
- **E: agents の model/effort ポリシー**: qa は fable / effort high、実装系は sonnet を標準に
  (docs/AGENTS.md)。日付付き model ID のハードコードは baseline(`agents/no-pinned-model`)が警告
- リモート参照タグ・生成物のスタンプを v0.5.0 に更新(baseline の drift source /
  `guard new` の policy 生成 / docs 例示)
- npm: `@guardsmith/core` 0.3.0 / `@guardsmith/cli` 0.3.0(Action の `cli-version` 既定も 0.3.0)

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

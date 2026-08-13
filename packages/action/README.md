# GuardSmith Lint Action

PR 時に `guard lint` を実行し、AI開発標準(CLAUDE.md / agents / skills)への準拠を機械検証する
composite action。違反があると:

- ジョブが失敗し、コンソールレポートが Job Summary に載る
- SARIF を Code Scanning にアップロード(公開リポジトリ or GHAS が必要。無い場合は artifact のみ)
- PR に検出サマリをコメント

## 使い方

```yaml
# .github/workflows/guard.yml
name: GuardSmith
on: [pull_request]

permissions:
  contents: read
  pull-requests: write # PRコメント用
  security-events: write # SARIFアップロード用 (upload-sarif: true の場合)

jobs:
  guard:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: novexar/Guardsmith/packages/action@v0.2.1
        with:
          # GuardSmith が private の間は、novexar/Guardsmith を読める PAT を渡す
          guardsmith-token: ${{ secrets.GUARDSMITH_TOKEN }}
          # private リポジトリで GHAS が無い場合は false(SARIFはartifactに残る)
          upload-sarif: "false"
```

## Inputs

| name               | default             | 説明                                                                              |
| ------------------ | ------------------- | --------------------------------------------------------------------------------- |
| `guardsmith-ref`   | `v0.2.1`            | guard CLI として checkout する novexar/Guardsmith のタグ                          |
| `guardsmith-token` | `github.token`      | Guardsmith 本体と `github:` リモート参照の取得用トークン(private の間は PAT 必須) |
| `github-token`     | `github.token`      | PR コメント投稿用                                                                 |
| `root`             | `.`                 | 検査対象ディレクトリ                                                              |
| `policy`           | `guard.policy.yaml` | ポリシーファイル(root からの相対)                                                 |
| `upload-sarif`     | `true`              | Code Scanning への SARIF アップロード                                             |
| `pr-comment`       | `true`              | 失敗時の PR コメント                                                              |

## Outputs

| name         | 説明                                              |
| ------------ | ------------------------------------------------- |
| `exit-code`  | guard lint の exit code(0 = pass / 1 = error検出) |
| `sarif-file` | 生成された SARIF のワークスペース内パス           |

## 既知の制約

- 同一 PR に push を重ねると失敗コメントが都度追加される(既存コメント更新は今後対応)
- GitHub Marketplace 公開には action.yml をリポジトリルートに置く(またはミラーリポジトリ)必要がある

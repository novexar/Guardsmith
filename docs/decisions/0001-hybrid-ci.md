# ADR-0001: GuardSmith 自身はハイブリッド CI(ローカル Docker + fork PR 限定の GitHub CI)

- **状態**: 採用
- **決定者**: オーナー
- **日付**: 2026-09-16

## 背景

Novexar の CI/CD 方針変更により、standards/ から生成されるプロジェクトの日常 CI は
GitHub Actions からローカル Docker 実行(`make ci`)へ移行した。private プロジェクトで
GitHub Actions の分数を消費しないためである。引き継ぎ書には GuardSmith 自身も含めた
完全移行が指示されていた。

一方で GuardSmith は public OSS であり、外部コントリビュータの fork からの PR を受ける。
外部 PR に対して「手元で `make ci` を通してください」だけでは検証の抜けが生じやすく、
メンテナが手動で検証する負担も大きい。また public リポジトリの GitHub Actions は
分数無料のため、生成プロジェクト(private)で問題だった分数消費の懸念が当てはまらない。

## 決定

GuardSmith 自身は**ハイブリッド CI** とする:

1. **メンテナの日常 CI はローカル Docker**: `make ci` が Docker コンテナ内で
   `pnpm install --frozen-lockfile` → `pnpm lint` → `pnpm typecheck` → `pnpm test:coverage` →
   `pnpm guard lint` を実行し、結果 JSON を `.guardsmith/ci-results/` に出力する
   (スキーマは standards/docs/CI_CD.md と同一)
2. **GitHub Actions は fork からの外部 PR のみ実行**: `.github/workflows/ci.yml`
   (External PR CI)は `pull_request` トリガーのみとし、
   `github.event.pull_request.head.repo.full_name != github.repository` の条件で
   同一リポジトリのブランチからの PR ではスキップする。`push: main` トリガーは廃止

## 生成プロジェクト標準との対比

|                | 生成 PJ(standards/ 配布物)                           | GuardSmith 自身                                        |
| -------------- | ---------------------------------------------------- | ------------------------------------------------------ |
| 日常 CI        | ローカル Docker(`make ci`)のみ                       | ローカル Docker(`make ci`)                             |
| GitHub Actions | main push 時の deploy のみ(テスト系ワークフロー禁止) | fork からの外部 PR 検証のみ                            |
| 理由           | private リポジトリの Actions 分数を消費しない        | public OSS のため外部 PR 検証が必要。public は分数無料 |

生成プロジェクト側の「テスト系ワークフローを置かない」原則は
`presets/baseline.yaml` の `ci/no-remote-test-workflows`(warn)で機械検証される。
GuardSmith 自身のセルフ検査は `presets/self.yaml` を使うため、この対比が矛盾なく共存する。

## 影響

- メンテナは PR 前に `make ci` を通す(CONTRIBUTING.md 参照)。GitHub 上の
  required status checks には依存しない
- 外部コントリビュータは Docker 環境が無くても、fork PR で従来どおり自動検証される
- CI ツールチェーンの変更は `docker/ci/Dockerfile` と External PR CI の両方を更新する

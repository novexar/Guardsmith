# CI/CD 運用 — {{PROJECT_NAME}}

<!-- gen: 本ファイルは Novexar 標準の CI/CD 方針。init-project で {{PROJECT_NAME}} を置換し、
     「PJ 固有の運用差分」節のみ PJ に合わせて追記する。方針そのものの緩和・削除は禁止。 -->

## 方針(Novexar 標準)

**日常の CI はローカル Docker で実行し、GitHub Actions にテスト系ワークフローを置かない。**
GitHub Actions は `main` への push 時の deploy のみに使う(private リポジトリの Actions 分数を消費しないため)。

## ブランチ × CI 対応表

| ブランチ | CI | 実行方法 |
|---|---|---|
| feature / bug | ローカル Docker | `make ci`(finish-task スキルの品質ゲート) |
| develop(統合) | ローカル Docker | マージ前に PR 作成者が `make ci` を通す |
| main | CI なし(deploy のみ) | `.github/workflows/deploy.yml`(push 時) |

## main で CI をしない理由と前提条件

`main` へ入るコードは、develop 上で **同一コンテナ・同一コマンド**(`make ci`)を通過済みである。
Docker イメージでツールチェーンが固定されているため、「別環境では通らない」リスクが小さく、
main で再実行しても分数を消費するだけで新しい情報が得られない。

この前提が成り立つ条件(崩す運用をしない):

- `main` へのマージは **develop からの PR のみ**(feature から直接 main へ入れない)
- develop へのマージ前に必ず `make ci` を通す(finish-task スキルの品質ゲート)
- CI のツールチェーンを変えるときは Dockerfile(docker/ci/)を更新し、同一 PR で `make ci` を通す

## ブランチ保護の推奨設定

- `main`: 直接 push 禁止 / PR 必須(develop からのみ)/ レビュー 1 名以上
- `develop`: 直接 push 禁止 / PR 必須
- GitHub の required status checks は使わない(リモート CI が無いため)。
  代わりに PR テンプレートのチェックリストで `make ci` 通過を宣言する

## 使い方

```bash
make ci           # 全ジョブ(backend-ci → frontend-ci)+ 結果 JSON 出力
make ci-backend   # バックエンドのみ
make ci-frontend  # フロントエンドのみ
```

- 前提: GNU make + bash + Docker。**Windows は Git Bash または WSL から実行する**(PowerShell / cmd 不可)
- 実体は `docker/ci/run-ci.sh` が `docker compose -f docker-compose.ci.yml` の各サービスを実行する
- 失敗したジョブがあると exit 1(以降のジョブは実行されない)

## CI 結果 JSON

`make ci` は結果を `.guardsmith/ci-results/<UTCタイムスタンプ>.json` に出力し、
同内容を `.guardsmith/ci-results/latest.json` にも書く(外部ツールは latest.json を読む)。
`.guardsmith/` は `.gitignore` 済みでコミットしない。

スキーマ:

```json
{
  "provider": "docker_local",
  "repo": "owner/name",
  "ref": "feature/142-preset-loader",
  "commit_sha": "…",
  "status": "success",
  "started_at": "2026-09-16T10:00:00+09:00",
  "finished_at": "2026-09-16T10:03:12+09:00",
  "jobs": [{ "name": "backend-test", "status": "success", "duration_sec": 88 }]
}
```

- `repo`: `git remote get-url origin` から抽出した owner/name(取得不可なら `unknown`)
- `ref` / `commit_sha`: 実行時点の git ブランチ名 / コミット SHA
- `status` / `jobs[].status`: `success` | `failure`(全ジョブ成功のときのみ全体 success)
- `started_at` / `finished_at`: ISO 8601(実装は UTC の `Z` 表記で出力する)
- `jobs[].duration_sec`: ジョブ所要秒数(整数)

## PJ 固有の運用差分

<!-- gen: デプロイ先・環境(staging/prod)・リリース手順など PJ 固有の CI/CD 差分をここに記載。無ければ「特記事項なし」 -->
- {{CICD_DIFFS}}

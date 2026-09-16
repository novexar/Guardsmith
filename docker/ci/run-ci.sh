#!/usr/bin/env bash
# GuardSmith 標準 — ローカル CI ランナー(汎用。プレースホルダ無し、そのまま使用可)
#
# 使い方: run-ci.sh "<ジョブ名>=<コマンド>" ["<ジョブ名>=<コマンド>" ...]
#   ジョブは Makefile から渡す(例: "backend-ci=docker compose -f docker-compose.ci.yml run --rm --build backend-ci")
#
# 動作:
#   - 各ジョブを宣言順に実行し、成否と所要時間(秒)を計測する
#   - ジョブが失敗した時点で以降のジョブは実行しない(結果 JSON には実行分のみ記録)
#   - CI 結果 JSON を .guardsmith/ci-results/<UTCタイムスタンプ>.json と latest.json に出力する
#     (スキーマは docs/CI_CD.md を参照。外部ツールは latest.json を読む)
#   - 全ジョブ成功なら exit 0、失敗があれば exit 1
#
# 依存: bash / git / docker(jq には依存しない。JSON は printf で生成する)
set -u -o pipefail

if [ "$#" -eq 0 ]; then
  echo "usage: $0 \"<job-name>=<command>\" [\"<job-name>=<command>\" ...]" >&2
  exit 2
fi

RESULTS_DIR=".guardsmith/ci-results"
mkdir -p "$RESULTS_DIR"

# JSON 文字列値のエスケープ(バックスラッシュと二重引用符のみ。値に制御文字は想定しない)
json_escape() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'
}

# repo は origin の URL から owner/name を抽出(https / ssh 両対応)。取れなければ unknown
repo="unknown"
origin_url="$(git remote get-url origin 2>/dev/null || true)"
if [ -n "$origin_url" ]; then
  repo="$(printf '%s' "$origin_url" | sed -e 's/\.git$//' -e 's#^.*[:/]\([^/]\{1,\}/[^/]\{1,\}\)$#\1#')"
fi
ref="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
commit_sha="$(git rev-parse HEAD 2>/dev/null || echo unknown)"

started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"

overall="success"
jobs_json=""

for spec in "$@"; do
  name="${spec%%=*}"
  cmd="${spec#*=}"
  echo ""
  echo "=== CI job: ${name}"
  echo "    $ ${cmd}"
  t0="$(date +%s)"
  if bash -c "$cmd"; then
    job_status="success"
  else
    job_status="failure"
    overall="failure"
  fi
  t1="$(date +%s)"
  duration=$((t1 - t0))
  echo "=== CI job: ${name} -> ${job_status} (${duration}s)"

  entry="$(printf '{ "name": "%s", "status": "%s", "duration_sec": %d }' \
    "$(json_escape "$name")" "$job_status" "$duration")"
  if [ -n "$jobs_json" ]; then
    jobs_json="${jobs_json}, ${entry}"
  else
    jobs_json="${entry}"
  fi

  if [ "$job_status" = "failure" ]; then
    break
  fi
done

finished_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
result_file="${RESULTS_DIR}/${stamp}.json"

printf '{
  "provider": "docker_local",
  "repo": "%s",
  "ref": "%s",
  "commit_sha": "%s",
  "status": "%s",
  "started_at": "%s",
  "finished_at": "%s",
  "jobs": [%s]
}\n' \
  "$(json_escape "$repo")" \
  "$(json_escape "$ref")" \
  "$(json_escape "$commit_sha")" \
  "$overall" \
  "$started_at" \
  "$finished_at" \
  "$jobs_json" > "$result_file"

cp "$result_file" "${RESULTS_DIR}/latest.json"

echo ""
echo "=== CI result: ${overall} (${result_file})"
[ "$overall" = "success" ]

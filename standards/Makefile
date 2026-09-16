# gen: ローカル CI 実行用 Makefile(init-project で PJ のスタックへ具体化する)
# gen: FE / BE の片方しか無い PJ は、不要なターゲットを削除し、ci ターゲットから
#      該当ジョブを取り除く。ジョブ名は CI 結果 JSON の jobs[].name になる。
# 前提: GNU make + bash + Docker(Windows は Git Bash または WSL から実行する)
# 結果 JSON: .guardsmith/ci-results/<UTCタイムスタンプ>.json と latest.json(詳細: docs/CI_CD.md)

COMPOSE = docker compose -f docker-compose.ci.yml
RUN_CI = bash docker/ci/run-ci.sh

.PHONY: ci ci-backend ci-frontend

# 全ジョブ実行(BE → FE の順。失敗した時点で打ち切り、結果 JSON を出力)
ci:
	$(RUN_CI) \
		"backend-ci=$(COMPOSE) run --rm --build backend-ci" \
		"frontend-ci=$(COMPOSE) run --rm --build frontend-ci"

ci-backend:
	$(RUN_CI) "backend-ci=$(COMPOSE) run --rm --build backend-ci"

ci-frontend:
	$(RUN_CI) "frontend-ci=$(COMPOSE) run --rm --build frontend-ci"

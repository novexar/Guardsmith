# GuardSmith 自身のローカル CI(Docker)— CONTRIBUTING.md の CI 節を参照
# 前提: GNU make + bash + Docker(Windows は Git Bash または WSL から実行する)
# 結果 JSON: .guardsmith/ci-results/<UTCタイムスタンプ>.json と latest.json
# (スキーマは standards/docs/CI_CD.md と同一)

IMAGE = guardsmith-ci
RUN_CI = bash docker/ci/run-ci.sh

.PHONY: ci

ci:
	$(RUN_CI) \
		"build=docker build -f docker/ci/Dockerfile -t $(IMAGE) ." \
		"lint=docker run --rm $(IMAGE) pnpm lint" \
		"typecheck=docker run --rm $(IMAGE) pnpm typecheck" \
		"test-coverage=docker run --rm $(IMAGE) pnpm test:coverage" \
		"guard-lint=docker run --rm $(IMAGE) pnpm guard lint"

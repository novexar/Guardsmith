# GuardSmith 自身のローカル CI 用イメージ(Node 22 + pnpm 10)
# ビルド時に依存導入まで済ませ、各 CI ジョブ(lint / typecheck / test / guard lint)は
# `docker run` で実行する(Makefile の make ci が入口。docs/decisions/0001-hybrid-ci.md 参照)
FROM node:22-slim

# GitHub Actions(pnpm/action-setup version: 10)と同じく pnpm v10 系の最新を使う。
# corepack はバージョン完全固定が必要になるため npm の dist-tag 解決で v10 に追随する
RUN npm install -g pnpm@10

WORKDIR /repo

# 依存レイヤーをキャッシュ(lockfile が変わらない限り install を再利用)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json packages/core/
COPY packages/cli/package.json packages/cli/
RUN pnpm install --frozen-lockfile

# ソース一式(.dockerignore で node_modules / coverage / release 等は除外)
COPY . .

CMD ["pnpm", "test"]

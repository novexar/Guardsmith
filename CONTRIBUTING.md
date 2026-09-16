# Contributing to GuardSmith

**English** | [日本語](CONTRIBUTING.ja.md)

Thank you for your interest in contributing to GuardSmith.

## Development environment

- Node.js >= 20 / pnpm >= 10

```bash
pnpm install
pnpm test              # vitest
pnpm test:coverage     # coverage (80% gate)
pnpm typecheck         # tsc strict
pnpm lint              # eslint + prettier --check
pnpm guard lint        # self-check (dogfooding)
```

## Contribution flow

1. Open an issue to agree on the approach first (small fixes can go straight to a PR)
2. Branch off `develop` as `feature/<topic>` or `fix/<topic>` (`feature/*` → `develop` → `main`)
3. Write tests first (TDD) and keep coverage at 80% or higher
4. Commit in Conventional Commits format (`feat:` / `fix:` / `docs:` / `test:` / `chore:`, etc.)
5. Open a PR. CI (lint / typecheck / test / guard lint) must be all GREEN

## CI (hybrid model)

GuardSmith uses a hybrid CI setup: maintainers run CI locally in Docker (`make ci`), while
GitHub Actions runs only for external PRs from forks (PRs from branches in the same
repository are skipped). This reconciles the policy of not consuming Actions minutes for
day-to-day CI with the need, as public OSS, to keep automated verification of external PRs.

- **`make ci` (Docker-based local CI) must pass before opening a PR.** It runs lint /
  typecheck / test:coverage / guard lint in one go inside a Docker container and writes
  result JSON to `.guardsmith/ci-results/` (requires GNU make + bash + Docker; on Windows,
  run from Git Bash / WSL)
- **External contributors (PRs from forks)**: GitHub Actions (External PR CI) runs the same
  checks automatically, so you can submit a PR without a Docker environment (running
  `pnpm lint` and friends locally beforehand is still recommended)
- GitHub Actions does not run for maintainers' own PRs (branches within the same repository)

## Notes on adding or changing rules

- When changing rules in `presets/baseline.yaml`, always keep the corresponding `standards/`
  templates and test fixtures in sync
- `standards/` is the distribution master. `{{PLACEHOLDER}}` markers and `gen:` comments are
  intentional
- Remote references (`github:`) require tag pinning. Changes that loosen this constraint
  will not be accepted

## License

Contributed code is licensed under [Apache-2.0](LICENSE).

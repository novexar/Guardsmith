# GuardSmith

**A governance toolkit that unifies distribution and enforcement of AI development standards.**

GuardSmith distributes standards (templates for `CLAUDE.md` / agents / skills) and
machine-verifies that projects follow them — the "ESLint + official config" relationship,
applied to AI coding standards.

- **Distribute** — `guard new` scaffolds a new project from the standards master
- **Verify** — `guard lint` checks the project against a YAML policy (8 check types; exit 1 = errors)
- **Follow up** — `guard sync` detects and repairs drift between distributed files and the master
- **CI** — the GitHub Action runs on every PR, uploads SARIF, and comments findings
- **Layering** — `extends: github:owner/repo[//path]@tag` chains OSS baseline → private org
  overlay → per-project policy (see `docs/LAYERING.md`); remote refs must pin a tag

## Install

```bash
npx @guardsmith/cli <command>      # one-off
# or
pnpm add -D @guardsmith/cli        # per project, then: pnpm guard <command>
```

## Getting started

### A. New project

```bash
npx @guardsmith/cli new my-project
cd my-project && git init && git add -A && git commit -m "chore: scaffold via guard new"
claude    # the uninitialized-template warning in CLAUDE.md drives the init-project skill
npx @guardsmith/cli lint   # verify initialization is complete, then commit
```

### B. Existing project

```bash
npx @guardsmith/cli init   # generate guard.policy.yaml only (no scaffolding)
npx @guardsmith/cli lint
```

Violations you cannot fix immediately go into `exemptions` — `expires` and
`approved_by` are mandatory, and expired exemptions surface as errors. Drifted
standard skills can be restored with `guard sync`.

### C. CI enforcement

```yaml
# .github/workflows/guard.yml
name: GuardSmith
on: [pull_request]
permissions:
  contents: read
  pull-requests: write
jobs:
  guard:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: novexar/Guardsmith@v0.3.0
```

The action runs the published CLI via `npx @guardsmith/cli`. On violations the job fails,
the console report lands in the Job Summary, and a summary comment is posted on the PR.
Key inputs: `cli-version` (npm version of the CLI, default `0.2.1`), `root` / `policy`,
`upload-sarif` (set `"false"` on private repos without GHAS — the SARIF is still kept as
an artifact), `pr-comment`, and `guardsmith-token` (PAT only needed for private overlay
repositories referenced via `github:` refs).

### D. Following standards updates

1. Revise the master and issue a new tag
2. Bump the pinned tag in each project's `guard.policy.yaml`
3. `guard lint` reports drifted standard skills
4. `guard sync` shows the diff (dry-run by default); `guard sync --write` restores master
   content while preserving sections listed in `allow_sections`

## Commands

| Command              | Description                                                         |
| -------------------- | ------------------------------------------------------------------- |
| `guard new <dir>`    | Scaffold a new project from `standards/`                            |
| `guard init`         | Generate `guard.policy.yaml` (extends `preset:baseline`)            |
| `guard lint`         | Verify. `--format sarif --out <file>`, `--no-cache`, `--root <dir>` |
| `guard sync`         | Repair drift. Dry-run by default; `--write` applies                 |
| `guard explain <id>` | Explain a rule                                                      |

## Repository layout

```
guardsmith/
├── action.yml            # GuardSmith Lint GitHub Action (SARIF + PR comment)
├── packages/core/        # @guardsmith/core — rule engine + CLI core
├── packages/cli/         # @guardsmith/cli — the `guard` binary
├── presets/
│   ├── baseline.yaml     # standard ruleset for generated projects
│   └── self.yaml         # self-check ruleset for this repository (dogfooding)
├── standards/            # standards master (CLAUDE.md / agents / skills templates)
└── docs/LAYERING.md      # 3-layer overlay design (OSS → private → project)
```

## Development

```bash
pnpm install
pnpm test              # vitest
pnpm test:coverage     # coverage (80% gate)
pnpm typecheck         # tsc strict
pnpm lint              # eslint + prettier --check
pnpm guard lint        # self-check (dogfooding)
```

## License

[Apache-2.0](LICENSE)

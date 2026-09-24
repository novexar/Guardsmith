<p align="center">
  <img src="https://raw.githubusercontent.com/novexar/Guardsmith/main/assets/logo.png" width="96" alt="GuardSmith logo">
</p>

<h1 align="center">@guardsmith/cli</h1>

<p align="center">
  Ship the same AI coding standards to every repository — and <b>machine-verify</b> they are followed.<br>
  The <code>guard</code> command of <a href="https://github.com/novexar/Guardsmith">GuardSmith</a>.
</p>

<p align="center">
  English | <a href="https://github.com/novexar/Guardsmith/blob/main/packages/cli/README.ja.md">日本語</a>
</p>

---

GuardSmith treats AI development standards (`CLAUDE.md`, agents, skills) the way ESLint
treats code style: **a distributable config plus a linter**. This package provides the CLI.

Requires Node.js 20+.

## Install

```bash
npx @guardsmith/cli <command>      # one-off
# or
pnpm add -D @guardsmith/cli        # per project, then: pnpm guard <command>
```

## Quick start

```bash
# New project — scaffold from the standards master
# (CLAUDE.md, agents, skills, docs, Docker-based local CI, design spec)
npx @guardsmith/cli new my-project

# Existing project — generate the policy file only
npx @guardsmith/cli init

# Verify (exit 1 = violations found: uninitialized templates,
# broken contract headings, leaked credentials, drift, ...)
npx @guardsmith/cli lint

# Show drift against the standards master, then repair it
npx @guardsmith/cli sync           # dry-run
npx @guardsmith/cli sync --write   # restore (project-owned sections are preserved)

# Explain a rule / show versions
npx @guardsmith/cli explain claude-md/thin-diff
npx @guardsmith/cli version
```

| Command                   | Key flags                                                                                      |
| ------------------------- | ---------------------------------------------------------------------------------------------- |
| `guard new <dir>`         | —                                                                                              |
| `guard init`              | —                                                                                              |
| `guard lint`              | `--root`, `--policy`, `--format console\|sarif\|json`, `--out`, `--no-cache`, `--no-gitignore` |
| `guard sync`              | `--root`, `--policy`, `--write`, `--no-cache`, `--no-gitignore`                                |
| `guard explain <rule-id>` | —                                                                                              |
| `guard version`           | —                                                                                              |

Checks operate on **files that could be committed**: `.gitignore` (nested files included)
is honoured by default and `.git/` is always excluded, so `secret-scan` never reports a
value inside `.claude/settings.local.json`, and `file-exists` treats a `.gitignore`'d path
as missing. The policy's `ignore` globs are excluded on top of that, and excluded trees are
pruned during traversal rather than filtered afterwards. `--no-gitignore` restores the full
scan when you want to audit ignored files.

After `guard new`, open the project with Claude Code — the bundled `init-project` skill
interviews you and concretizes the templates. `guard lint` passes once initialization
is genuinely complete.

## Policy in a nutshell

```yaml
# guard.policy.yaml
version: 1
target: claude-code
extends:
  - github:novexar/guardsmith//presets/baseline.yaml@v0.5.2 # tag pinning is mandatory
  # Projects with a frontend also add:
  # - github:novexar/guardsmith//presets/frontend.yaml@v0.5.2
ignore: [] # globs excluded from every scan (concatenated across extends layers)
rules: [] # add or override (redefining an id overrides it)
exemptions: [] # time-boxed waivers: reason + approved_by + expires required
```

`extends` composes OSS baseline → private organization overlay → per-project policy.
Private repositories are fetched with the `GITHUB_TOKEN` environment variable, so
organization-specific rules never leave your GitHub. Expired exemptions surface as
errors — nothing is waived silently forever.

## CI enforcement

Add one line to your workflow using the
[GuardSmith Lint Action](https://github.com/marketplace/actions/guardsmith-lint):

```yaml
- uses: novexar/Guardsmith@v0.5.2
```

Violating PRs fail with a summary comment and a SARIF report. Air-gapped environments can
run entirely from the self-contained bundle attached to
[GitHub Releases](https://github.com/novexar/Guardsmith/releases) (`source: release` /
`node guard.mjs`) — no npm registry access required.

## Documentation

- Getting started & concepts: https://github.com/novexar/Guardsmith
- 3-layer policy design: https://github.com/novexar/Guardsmith/blob/main/docs/LAYERING.md
- Upgrading standards (per-release checklist): https://github.com/novexar/Guardsmith/tree/main/docs/migration

## License

Apache-2.0

Third-party licenses: dependencies carry their own licenses via npm; the offline release
bundle ships with a `THIRD-PARTY-NOTICES.md`.

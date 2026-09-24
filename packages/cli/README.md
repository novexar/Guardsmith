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

# Show what a standards update would change, then take it in
npx @guardsmith/cli sync                # dry-run (exit 1 = something conflicts)
npx @guardsmith/cli bump v0.7.0         # apply + move the extends tags and the vars file

# Existing project with no guardsmith.vars.yaml yet — generate it first
npx @guardsmith/cli sync --init-vars

# Explain a rule / show versions
npx @guardsmith/cli explain claude-md/thin-diff
npx @guardsmith/cli version
```

| Command                   | Key flags                                                                                            |
| ------------------------- | ---------------------------------------------------------------------------------------------------- |
| `guard new <dir>`         | —                                                                                                    |
| `guard init`              | —                                                                                                    |
| `guard lint`              | `--root`, `--policy`, `--format console\|sarif\|json`, `--out`, `--no-cache`, `--no-gitignore`       |
| `guard sync`              | `--root`, `--policy`, `--write`, `--no-cache`, `--no-gitignore`, `--conflict-markers`, `--init-vars` |
| `guard bump <tag>`        | `--root`, `--policy`, `--repo <owner>/<repo>`, `--no-cache`, `--no-gitignore`, `--conflict-markers`  |
| `guard explain <rule-id>` | —                                                                                                    |
| `guard version`           | —                                                                                                    |

`guard sync` and `guard bump` take a standards release in as a **three-way merge**: the
master at the tag the project sits on is the base, the master at the new tag is theirs, and
your repository is ours, so project-specific wording survives. A file where your edits and
the standards change overlap is reported as a **conflict** and left untouched
(`--conflict-markers` writes it out with `<<<<<<<` / `|||||||` / `=======` / `>>>>>>>`
markers instead). Both exit `0` with no conflicts, `1` when anything conflicts — `guard bump`
then writes nothing at all, not even the policy — and `2` on a run-time error.

The merge reads the project's placeholder substitutions from `guardsmith.vars.yaml`
(project root, committed, no secrets). `guard new` writes the skeleton; an existing project
generates one with `guard sync --init-vars`. A policy with no `drift3` rule keeps the old
section-level `guard sync --write` behaviour.

Checks operate on **files that could be committed**: `.gitignore` (nested files included)
is honoured by default and `.git/` is always excluded, so `secret-scan` never reports a
value inside `.claude/settings.local.json`, and `file-exists` treats a `.gitignore`'d path
as missing. The policy's `ignore` globs are excluded on top of that, and excluded trees are
pruned during traversal rather than filtered afterwards. `--no-gitignore` restores the full
scan when you want to audit ignored files.

`guard lint` also measures how much context a `CLAUDE.md` keeps resident: `import-budget`
adds up the entry file plus every file reached through its `@path` imports and always
reports one `info` (`resident context: N files, X chars (≈Y tokens, rough estimate)` plus a
per-file breakdown; the token figure is a rough `chars / 4` estimate). Nothing outside the
scan root is read. Write package names as `` `@scope/pkg` `` — `@` is an import anywhere in
the file, so a bare `@scope/pkg` is read as one and reported as `unresolved import`.

The policy schema is strict: unknown keys under `with` or on a rule are **parse errors**
naming the offending path, not silently dropped fields.

After `guard new`, open the project with Claude Code — the bundled `init-project` skill
interviews you and concretizes the templates. `guard lint` passes once initialization
is genuinely complete.

## Policy in a nutshell

```yaml
# guard.policy.yaml
version: 1
target: claude-code
extends:
  - github:novexar/guardsmith//presets/baseline.yaml@v0.7.0 # tag pinning is mandatory
  # Projects with a frontend also add:
  # - github:novexar/guardsmith//presets/frontend.yaml@v0.7.0
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
- uses: novexar/Guardsmith@v0.7.0
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

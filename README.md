<p align="center">
  <img src="https://raw.githubusercontent.com/novexar/Guardsmith/main/assets/logo.png" width="120" alt="GuardSmith logo">
</p>

<h1 align="center">GuardSmith</h1>

<p align="center">
  Ship the same AI coding standards to every repository — and <b>machine-verify</b> they are followed.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@guardsmith/cli"><img src="https://img.shields.io/npm/v/%40guardsmith%2Fcli?label=%40guardsmith%2Fcli" alt="npm"></a>
  <a href="https://github.com/marketplace/actions/guardsmith-lint"><img src="https://img.shields.io/badge/GitHub%20Action-GuardSmith%20Lint-6f42c1" alt="GitHub Action"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue" alt="License"></a>
</p>

<p align="center">
  <b>English</b> | <a href="README.ja.md">日本語</a>
</p>

---

## Why GuardSmith?

Once a team adopts AI coding tools like Claude Code, the same problems appear everywhere:
`CLAUDE.md` differs wildly between repositories, good agent/skill setups stay locked in one
person's project, and rules quietly erode after they are distributed.

GuardSmith treats AI development standards the way ESLint treats code style —
**a distributable config plus a linter**:

- **Distribute** — `guard new` scaffolds a new project from a standards master
  (`CLAUDE.md`, agents, skills, docs, CI setup, design spec)
- **Verify** — `guard lint` checks any project against a YAML policy
  (10 check types; uninitialized templates, broken contract headings, leaked credentials, drift, CLAUDE.md import budget, and more)
- **Repair** — `guard sync` detects drift from the master and restores it,
  while preserving the sections each project is allowed to customize
- **Keep up** — `guard bump <tag>` takes a new standards release in as a **three-way merge**:
  project-specific wording survives, and only a genuine collision is reported as a conflict
- **Enforce in CI** — the [GuardSmith Lint Action](https://github.com/marketplace/actions/guardsmith-lint)
  fails violating PRs, posts a summary comment, and emits SARIF
- **Layer** — `extends: github:owner/repo[//path]@tag` composes OSS baseline →
  private organization overlay → per-project policy. Private rules never leave your GitHub

## Quick start

Requires Node.js 20+.

### New project

```bash
npx @guardsmith/cli new my-project
cd my-project && git init && git add -A && git commit -m "chore: scaffold via guard new"
```

Open the project with Claude Code — the uninitialized-template warning in `CLAUDE.md`
drives the bundled `init-project` skill, which interviews you and concretizes
`CLAUDE.md`, agents, docs, and the Docker-based local CI. Then verify:

```bash
npx @guardsmith/cli lint   # errors until initialization is complete — that's the point
```

### Existing project

```bash
npx @guardsmith/cli init   # generates guard.policy.yaml only (no scaffolding)
npx @guardsmith/cli lint
```

Violations you cannot fix right away go into `exemptions` — a reason, an approver and an
expiry date are mandatory, and **expired exemptions surface as errors**. Nothing gets
waived silently forever.

### CI in one line

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
      - uses: novexar/Guardsmith@v0.6.0
```

| Input              | Default                   | Description                                                                                                         |
| ------------------ | ------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `cli-version`      | `0.5.0`                   | npm version of the CLI to run                                                                                       |
| `root` / `policy`  | `.` / `guard.policy.yaml` | Directory / policy file to lint                                                                                     |
| `upload-sarif`     | `true`                    | Upload SARIF to Code Scanning (set `"false"` on private repos without GHAS; the SARIF is still kept as an artifact) |
| `pr-comment`       | `true`                    | Post a summary comment when lint fails                                                                              |
| `guardsmith-token` | `github.token`            | Token for `github:` remote refs (a PAT is only needed for private overlay repos)                                    |
| `source`           | `npm`                     | Set to `release` to run from the GitHub Releases bundle — no npm registry access required (pin with `release-tag`)  |

## Air-gapped / restricted networks

A self-contained bundle (all dependencies included) is attached to every
[GitHub Release](https://github.com/novexar/Guardsmith/releases). Only GitHub access and
Node.js 20+ are required — the npm registry is never contacted:

```bash
gh release download v0.6.0 --repo novexar/Guardsmith --pattern 'guardsmith-cli-*.tar.gz'
tar -xzf guardsmith-cli-*.tar.gz
node guardsmith-cli/guard.mjs lint
```

Policy and standards fetching (`extends` / drift / sync) is GitHub-only by design.

## Policies

A project policy is a few lines of YAML with pinned remote references:

```yaml
# guard.policy.yaml
version: 1
target: claude-code
extends:
  - github:novexar/guardsmith//presets/baseline.yaml@v0.6.0
  # Projects with a frontend also add:
  # - github:novexar/guardsmith//presets/frontend.yaml@v0.6.0
ignore: [] # globs excluded from every scan (concatenated across extends layers)
rules: [] # add or override rules (redefining an id overrides it)
exemptions: [] # time-boxed waivers: reason + approved_by + expires required
```

- **`preset:baseline`** — standards for every generated project: initialization completeness,
  contract headings, agent/skill frontmatter, secret scanning, drift against the master,
  no dated model IDs, no test workflows on GitHub Actions (CI runs locally in Docker)
- **`preset:frontend`** — for projects with a UI: `DESIGN.md` present and concretized,
  shadcn/ui configuration, no competing UI libraries
- Remote refs **must pin a tag** — your standards never change underneath you.
  Bump the tag on your schedule: `guard sync` shows what a new release would change, and
  `guard bump <tag>` takes it in
- The 3-layer model (OSS baseline → private org overlay → project) is described in
  [docs/LAYERING.md](docs/LAYERING.md)

### Absorbing a standards update

A new standards release is taken in with two commands:

```bash
guard sync          # dry-run: what the new release would change, and where it collides
guard bump v0.7.0   # apply it, and move the extends tags along with it
```

The master at the tag the project currently sits on (`standards` in
`guardsmith.vars.yaml`) and the master at the new tag are both normalized — generation
comments stripped, placeholders rendered with your own substitutions — and the difference
between the two is applied to your files as a **three-way merge**: the old master is the
base, the new master is theirs, your repository is ours. Everything the project wrote for
itself survives. Only a place where a section _you_ rewrote and a section the _standards_
changed overlap becomes a **conflict**, and a conflicting file is listed and left
untouched — never silently overwritten. `guard sync` exits `0` when everything applies
cleanly, `1` when anything conflicts and `2` on a run-time error; `--conflict-markers`
writes the conflicting files out with `<<<<<<<` / `|||||||` / `=======` / `>>>>>>>`
markers instead of leaving them alone (the exit code stays `1`).

#### `guardsmith.vars.yaml`

The merge has to know what each template placeholder became in your project, so that
dictionary lives at the project root and is **committed**:

```yaml
# guardsmith.vars.yaml
version: 1
standards: v0.7.0 # the master tag this project currently sits on
vars:
  PROJECT_NAME: "BizCore"
  ORG/REPO: "novexar/bizcore"
  "単一システム | モノレポ": "モノレポ"
```

Keys are the text **inside** the `{{ }}` token, verbatim — including slashes
(`ORG/REPO`) and choice tokens. `guard new` writes the skeleton and the bundled
`init-project` skill fills it in; a project created before v0.7.0 generates one with
`guard sync --init-vars`, which infers the values by lining the project up against the
master at its current tag and then exits without syncing anything. **Never put a secret in
it** — the file is committed, and `--init-vars` deliberately drops any inferred value that
matches a secret pattern to `TODO`. `guard bump` moves `standards` to the new tag once the
merge succeeds.

#### `drift3`

The same comparison runs during `guard lint`, so CI reports a waiting standards release
without anyone running `sync`:

```yaml
- id: drift/standards-sync
  severity: warn
  check: drift3
  with:
    source: github:novexar/guardsmith//standards@v0.7.0 # new master (tag pinning is mandatory)
    paths: ["CLAUDE.md", "DESIGN.md", "docs/**/*.md", ".claude/agents/**/*.md"]
```

Standards changes that would apply cleanly are reported at the rule's severity (`warn` in
the baseline) together with the command to run; changes that would conflict are reported as
`info`, because they need a human either way. A project with no `guardsmith.vars.yaml`
cannot be compared this way, so the check falls back to the section-level comparison and
points at `guard sync --init-vars`. The older `drift` check (section-level,
`allow_sections`) is unchanged and still used for `.claude/skills/**`.

### CLAUDE.md import budget

`CLAUDE.md` pulls whole files into context at launch with `@path` imports, so a 60-line
`CLAUDE.md` that imports five documents is not a small `CLAUDE.md`. Line counts
(`claude-md/thin-diff`) cannot see that, so `import-budget` measures the **resident total**:
the entry file plus every file it reaches through `@` imports.

```yaml
- id: claude-md/import-budget
  severity: warn
  check: import-budget
  with:
    path: CLAUDE.md # glob allowed; one report per matched entry file
    max_chars: 32000 # optional: exceeding it reports at the rule's severity
    max_depth: 4 # optional: how many import hops to follow (default 4)
```

It always emits one `info` per entry file —
`resident context: N files, X chars (≈Y tokens, rough estimate)` followed by a per-file
breakdown (largest first, top 10 plus an `others` line). **The token figure is a rough
`chars / 4` estimate, not a measurement**; use it for orders of magnitude only.
Additional `info` findings flag imports that do not contribute: `unresolved import:`,
`import cycle detected:`, `import depth limit exceeded`, and `import outside root, not
measured`. Nothing outside the scan root is ever read: references using `..`, an absolute
path, `~/` or a backslash are rejected before any file access, and every file is checked
with `realpath` against the root before it is opened, so a symlink inside the root that
points outside is reported rather than measured.

Import semantics follow
[the Claude Code memory docs](https://code.claude.com/docs/en/memory) (checked 2026-09-24):
`@path` is recognized anywhere in the file, relative paths resolve against the directory of
the file containing them, recursion is capped at four hops, and `@` inside code spans or
fenced code blocks is not an import — wrap a path in backticks to mention it without
importing it.

> **Write package names in backticks.** Because `@` is recognized anywhere in the file —
> including mid-sentence, which Japanese prose requires — a bare `@scope/pkg` is read as an
> import by Claude Code as well, and `import-budget` reports it as `unresolved import`.
> Write `` `@scope/pkg` `` instead; that is the officially documented way to mention a path
> without importing it.

### Policy schema

The policy schema is **strict**: an unknown key under `with`, or an unknown top-level key
on a rule, is a **parse error** naming the offending path
(`rules.0.with: Unrecognized key: "limt"`) rather than a silently dropped field. A typo
therefore fails the run instead of quietly disabling a rule.

### What gets scanned

Checks operate on **files that could be committed**:

- `.gitignore` is honoured by default, nested `.gitignore` files included, and `.git/` is
  always excluded
- The policy's top-level `ignore` globs are excluded on top of that. Unlike `rules`, they
  are **concatenated** across `extends` layers, so an organization overlay's exclusions
  reach every project
- Excluded trees are **pruned during traversal**, not filtered afterwards — repositories
  carrying agent worktrees, `node_modules` or virtualenvs stay fast
- `--no-gitignore` restores the full scan, to audit what is sitting in ignored files

Most checks enumerate every file they inspect with globs and therefore follow
`.gitignore` completely. Three do not: `json-path` reads one fixed path directly;
`import-budget` follows `.gitignore` only when picking its entry files — the `@` imports it
then walks are explicit references and are read wherever they live; and `drift3` takes its
file list from the standards master, so `.gitignore` only decides which _extra_ project
files are listed as project-local:

| Check           | Follows `.gitignore`       | What it means for a `.gitignore`'d path                                                                              |
| --------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `file-exists`   | yes                        | Counts as **missing** → the rule reports it (it never reaches the repo)                                              |
| `file-absent`   | yes                        | Counts as **absent** → no finding, even if the file is on disk                                                       |
| `content-match` | yes                        | Not scanned (an empty match set is reported as `info`)                                                               |
| `max-lines`     | yes                        | Not scanned                                                                                                          |
| `import-budget` | entry files only           | Not used as an entry file; still measured when an `@` import points at it explicitly                                 |
| `frontmatter`   | yes                        | Not scanned                                                                                                          |
| `drift`         | yes                        | Not compared against the master                                                                                      |
| `drift3`        | project-local listing only | Still merged when the master owns the path; `.gitignore` only decides what is listed as project-local                |
| `secret-scan`   | yes                        | Not scanned — no finding from `.claude/settings.local.json` and friends                                              |
| `json-path`     | **no**                     | Read directly, so it still fires (e.g. `security/dangerous-permissions` on a `.gitignore`'d `.claude/settings.json`) |

The two surprising ones are worth spelling out. `file-absent` on `.env` finds nothing once
`.env` is in `.gitignore` — correct, because the rule exists to stop `.env` being committed,
and an ignored file cannot be. And `json-path` is deliberately exempt so that a settings
audit keeps working on projects that keep `.claude/settings.json` local. Use
`--no-gitignore` when you want every check to look at ignored files too.

## Commands

| Command                   | Description                                                                                                                                                                                                                                                       |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `guard new <dir>`         | Scaffold a new project from the standards master (writes a `guardsmith.vars.yaml` skeleton)                                                                                                                                                                       |
| `guard init`              | Generate `guard.policy.yaml` in the current directory                                                                                                                                                                                                             |
| `guard lint`              | Verify. `--format sarif\|json`, `--out <file>`, `--no-cache`, `--no-gitignore`, `--root <dir>`                                                                                                                                                                    |
| `guard sync`              | Dry-run of the standards update; `--write` applies it, `--conflict-markers` writes conflicts out, `--init-vars` generates `guardsmith.vars.yaml`, `--no-gitignore`. Exit `0` / `1` conflicts / `2` error. Section-level repair for policies with no `drift3` rule |
| `guard bump <tag>`        | Take a standards release in: rewrite the `extends` tags, merge, update `guardsmith.vars.yaml` and the `CLAUDE.md` stamp. `--repo <owner>/<repo>`, `--conflict-markers`. Exit `0` / `1` conflicts (nothing written) / `2` error                                    |
| `guard explain <rule-id>` | Explain a rule                                                                                                                                                                                                                                                    |
| `guard version`           | Show CLI and standards versions                                                                                                                                                                                                                                   |

## Upgrading standards

Existing projects are tag-pinned and keep working untouched. When you are ready to adopt a
new standards release, follow the step-by-step checklist in
[docs/migration/v0.7.0.md](docs/migration/v0.7.0.md) — from v0.7.0 catching up is two
commands (`guard sync`, then `guard bump v0.7.0`).
Coming from an older release? Apply [v0.5.0](docs/migration/v0.5.0.md),
[v0.5.1](docs/migration/v0.5.1.md), [v0.5.2](docs/migration/v0.5.2.md) and
[v0.6.0](docs/migration/v0.6.0.md) first; every release's checklist lives in
[docs/migration/](docs/migration/).

> **CLI version**: the v0.7.0 baseline needs `@guardsmith/cli` **0.6.0 or newer** (it
> carries the `drift3` check, which an older CLI rejects as unknown under its strict
> schema). Upgrade the CLI before bumping the `extends` tag. Note that `guard sync` now
> **exits 1 when there are conflicts**, where it always exited 0 up to v0.6.0 — check any
> CI job that runs it. `guard lint` exit codes are unchanged.

## Acknowledgements

- [awesome-design-md-jp](https://github.com/kzhrknt/awesome-design-md-jp) (MIT) — the base
  of the standards/DESIGN.md template
- [ponytail](https://github.com/DietrichGebert/ponytail) (MIT) — the over-implementation
  restraint plugin built into the standards
- With respect to the ecosystems the standards reference and recommend: shadcn/ui, Tremor,
  TanStack (Router/Query/Table), Tailwind CSS, cmdk — no code is bundled; each project
  adopts them under their own licenses
- Key runtime dependencies: zod, yaml, fast-glob, micromatch, ignore, jsonpath-plus, node-tar and
  [node-diff3](https://github.com/bhousel/node-diff3) (MIT — the three-way merge behind
  `guard sync` / `guard bump`) — used under each package's license (the offline bundle
  ships with a `THIRD-PARTY-NOTICES.md`)

## License & contributing

[Apache-2.0](LICENSE). Issues and PRs are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md)
for the development workflow.

# GuardSmith Layering Design — how overlay / extends works

**English** | [日本語](LAYERING.ja.md)

A detailed explanation of "overlay organization/client-specific content from a private
repository on top of the OSS baseline via extends".

## In one sentence

**Split policies and templates into a "publishable layer" and a "non-publishable layer",
and let each upper layer extend (inherit + override) the one below** — a three-layer
structure with the same idea as the CSS cascade.

```
[Layer 1] guardsmith (OSS, public)
    │  Generic rules + generic templates anyone can use (the "body" of the standards)
    │  e.g. baseline.yaml, the standards/CLAUDE.md skeleton, generic agents/skills
    ▼ extends
[Layer 2] guardsmith-private (novexar, private)
    │  Novexar/client-specific additional rules, overrides, and templates
    │  e.g. a client's naming conventions, internal repository naming rules, NDA prohibitions
    ▼ extends
[Layer 3] Each project repository (guard.policy.yaml)
       Holds only project-specific tweaks and time-boxed exemptions
```

## Understanding by example

### Layer 1 (OSS) — presets/baseline.yaml

```yaml
rules:
  - id: claude-md/thin-diff
    severity: warn
    check: max-lines
    with: { path: CLAUDE.md, limit: 120 }
```

### Layer 2 (private) — novexar-overlay.yaml

```yaml
version: 1
target: claude-code
extends:
  - github:novexar/guardsmith//presets/baseline.yaml@v0.6.0 # ← inherits Layer 1
rules:
  # Override: escalate the violation to error in-house (redefining the same id = override)
  - id: claude-md/thin-diff
    severity: error
    check: max-lines
    with: { path: CLAUDE.md, limit: 120 }
  # Addition: a rule specific to client A's project (information that must never be published)
  - id: client-a/forbidden-terms
    severity: error
    check: content-match
    with:
      path: "docs/**/*.md"
      must_not: ["(regex for the confidential project code name)"]
```

### Layer 3 (each project) — guard.policy.yaml

```yaml
version: 1
target: claude-code
extends:
  - github:novexar/guardsmith-private//novexar-overlay.yaml@v3
rules: [] # usually empty; add project-specific rules here if needed
exemptions:
  - rule: claude-md/thin-diff
    reason: legacy migration in progress, extra steps must stay documented
    expires: 2026-12-31
    approved_by: tech-lead
```

## Merge rules (behavior implemented in the resolver)

1. Load `extends` in declaration order and merge `rules` **keyed by id**
2. If the same id is redefined, **the later one wins** (Layer 3 > Layer 2 > Layer 1)
3. `exemptions` are **concatenated**, not overridden (exemptions from any layer apply,
   but an expiry date is mandatory)
4. The top-level `ignore` globs are **concatenated** as well, not overridden — declaration
   order is preserved and only duplicates are removed, so an organization overlay's
   exclusions reach every project and a project cannot silently drop them
5. Remote references **require tag pinning** (`@vX.Y.Z`) — prevents "the standards changed
   without anyone noticing"
6. `guardsmith.vars.yaml` belongs to each project's Layer 3 and is **never inherited** from
   an upper layer — the substitutions it records are specific to that one project

## Why this split

| Approach                | What happens                                                                                                                               |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Put everything in OSS   | Accidental publication of client-specific rules (= engagement information). Noise for other users                                          |
| Put everything private  | Cannot be published or shared as OSS; community improvements cannot flow in                                                                |
| **Split into 3 layers** | The OSS grows as a generic product anyone can use, private information is never published, and each project holds only a few lines of YAML |

## Templates (standards/) share the same structure

Not only rules — templates work the same way:

- Layer 1: the generic skeletons in `standards/` (CLAUDE.md, agents, skills) — ported
  from claude-standards
- Layer 2: place organization-specific templates (e.g. an agent for client A) on the
  private side and point `guard sync` at it (the private standards are maintained as a
  copy of Layer 1 with the specific parts appended)
- Layer 3: each project receives the distribution via `guard bump`, and its own sections
  survive the **three-way merge** — only a section the project rewrote _and_ the standards
  changed becomes a conflict, which is reported rather than overwritten

## Operational flow

1. Revise the standards → commit to Layer 1 (or 2) and cut a new tag (e.g. v0.3.0)
2. In each project run `guard bump <tag> --dry-run` to review the diff and the predicted
   conflicts, then `guard bump <tag>`: the `extends` tags in guard.policy.yaml, the
   standards files themselves and `guardsmith.vars.yaml` move to the new tag in one
   command. Open the result as a PR. (`guard sync` without `--write` is a dry-run against
   the tag the policy **currently** pins, so it does not preview the bump)
3. `guard lint` in CI verifies conformance to the new standards; places that cannot
   conform yet are grace-managed with time-boxed exemptions

## Remote fetch specification

- `extends: github:owner/repo[//path]@tag` and drift `source: github:owner/repo[//path]@tag` work
  - When `//path` is omitted: extends refers to `guard.policy.yaml` at the repository
    root, drift refers to the repository root
  - Specify drift's `//path` when the master lives in a subdirectory
    (e.g. `github:novexar/guardsmith//standards@v0.6.0`)
- Fetch method: tarball from codeload.github.com (tag-pinned). Private repositories
  authenticate via the `GITHUB_TOKEN` environment variable
- Cache: `~/.guardsmith/cache/<owner>/<repo>/<tag>/`. Tags are assumed immutable, so no
  re-fetch. Force a re-fetch with `guard lint --no-cache`
- `extends` resolves **multi-level** (the Layer 3 → Layer 2 → Layer 1 chain works in a
  single command). Cycles are an error
- Security: tarball extraction rejects path traversal (`..`, absolute paths) and link
  entries. `//path` references outside the cache are also blocked

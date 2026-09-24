<p align="center">
  <img src="https://raw.githubusercontent.com/novexar/Guardsmith/main/assets/logo.png" width="96" alt="GuardSmith logo">
</p>

<h1 align="center">@guardsmith/core</h1>

<p align="center">
  The rule engine behind <a href="https://github.com/novexar/Guardsmith">GuardSmith</a> —
  policy validation, 10 check types, tag-pinned remote resolution, three-way standards
  merge, and SARIF output.
</p>

<p align="center">
  English | <a href="https://github.com/novexar/Guardsmith/blob/main/packages/core/README.ja.md">日本語</a>
</p>

---

> **Looking for the CLI?** Install
> [`@guardsmith/cli`](https://www.npmjs.com/package/@guardsmith/cli) instead — it is a thin
> wrapper around this package. Install `@guardsmith/core` directly only if you want to embed
> the engine in your own tool.

## What it provides

- **Policy schema** — strict zod validation of `guard.policy.yaml` / preset YAML
  (unknown keys are rejected; typos become errors)
- **10 check types** — file-exists / file-absent / content-match / max-lines / import-budget /
  frontmatter / json-path / drift / drift3 / secret-scan. `import-budget` measures the resident
  context of a `CLAUDE.md` including everything its `@path` imports pull in (rough `chars / 4`
  token estimate; see the [main README](https://github.com/novexar/Guardsmith#claudemd-import-budget)).
  `drift3` (`with: { source, paths }`) reports the standards changes between the project's
  current tag and the `source` tag that have not been taken in yet
- **Remote resolution** — `extends: github:owner/repo[//path]@tag` with mandatory tag pinning,
  local caching, multi-level composition, cycle detection, and path-traversal hardening
- **Scan scope** — `.gitignore` (nested files included) is honoured by default and `.git/`
  is always excluded, so only files that could be committed are checked. The policy's
  top-level `ignore` globs add to that, and excluded trees are pruned during traversal
  rather than filtered afterwards
- **Reporting** — console formatter and SARIF 2.1.0 output
- Ships the standard rulesets (`presets/baseline.yaml`, `presets/frontend.yaml`) and the
  standards master (`standards/`) used by `guard new`

## Use as a library

```ts
import { parsePolicy, runLint, formatConsole } from "@guardsmith/core";
import { parse } from "yaml";
import { readFileSync } from "node:fs";

const parsed = parsePolicy(parse(readFileSync("guard.policy.yaml", "utf8")));
if (parsed.ok) {
  // 4th argument: { gitignore: false } restores the full scan (= CLI --no-gitignore)
  const result = await runLint(parsed.policy, process.cwd());
  console.log(formatConsole(result));
  process.exitCode = result.ok ? 0 : 1;
}
```

Key exports: `parsePolicy` / `PolicyDocument`, reusable schema parts (`Rule`, `Exemption`,
`Severity`) for composing your own policy documents,
`runLint(policy, root, now?, { gitignore })` / `formatConsole` / `toSarif`,
`planSync(policy, root, { gitignore })`, `loadPolicy` (multi-level `extends` resolution
across `preset:` / `file:` / `github:` refs — `rules` merge by id with the later layer
winning, while `exemptions` and the top-level `ignore` globs are concatenated), and
`createGlobScope` / `globFiles` (the shared file walker that applies `ignore` and
`.gitignore`).

`gitignore` defaults to `true` in both entry points; pass `{ gitignore: false }` for the
full scan (the CLI's `--no-gitignore`). `runLint`'s third argument is the clock used to
evaluate exemption expiry, so pass it explicitly when you need reproducible results.

### Three-way standards merge

The machinery behind `guard sync` / `guard bump` is exported as well:

| Export                                              | Summary                                                                                                                                                                                                                   |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `loadVars(rootDir): VarsDocument \| null`           | Reads and validates the project's `guardsmith.vars.yaml` (`{ version, standards, vars }`); `null` when the file is absent, throws when it is malformed                                                                    |
| `normalizeMaster(text, { vars, stamp? })`           | Renders one master template into the state an initialized project would have — CRLF→LF, `gen:` comments and the uninitialized warning stripped, stamp rewritten, placeholders substituted. Returns `{ text, unresolved }` |
| `merge3(ours, base, theirs, { markers?, labels? })` | Line-based three-way merge. Returns `{ merged?, conflicts, eol, changed }`; `merged` is absent when there is a conflict and `markers` is off, and the input EOL is restored                                               |
| `planSync3(sources, rootDir, vars, options?)`       | Builds the `Sync3Plan` (`actions` of kind `merge` / `create` / `conflict` / `skip-deleted` / `removed` / `unchanged`, plus `localOnly`, `conflicted`, `baseTag`, `nextTag`)                                               |
| `applySync3(plan, rootDir, vars)`                   | Writes the plan out, then moves `guardsmith.vars.yaml` and the `CLAUDE.md` stamp to `nextTag`. Writes **nothing** when the plan has conflicts, unless `conflictMarkers` was set                                           |
| `formatSync3Plan(plan, write)`                      | Renders the plan for the console (dry-run and applied share one formatter)                                                                                                                                                |

`planSync3` takes one `Drift3Source` per `drift3` rule
(`{ ruleId, paths, baseRoot, headRoot, baseTag, headTag }`), with both master roots already
resolved to local directories, so the caller decides how they are fetched.

## Documentation

- Getting started & concepts: https://github.com/novexar/Guardsmith
- 3-layer policy design: https://github.com/novexar/Guardsmith/blob/main/docs/LAYERING.md

## License

Apache-2.0

<p align="center">
  <img src="https://raw.githubusercontent.com/novexar/Guardsmith/main/assets/logo.png" width="96" alt="GuardSmith logo">
</p>

<h1 align="center">@guardsmith/core</h1>

<p align="center">
  The rule engine behind <a href="https://github.com/novexar/Guardsmith">GuardSmith</a> —
  policy validation, 9 check types, tag-pinned remote resolution, and SARIF output.
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
- **9 check types** — file-exists / file-absent / content-match / max-lines / import-budget /
  frontmatter / json-path / drift / secret-scan. `import-budget` measures the resident context
  of a `CLAUDE.md` including everything its `@path` imports pull in (rough `chars / 4` token
  estimate; see the [main README](https://github.com/novexar/Guardsmith#claudemd-import-budget))
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
`Severity`) for composing your own policy documents, `runLint` / `formatConsole` / `toSarif`,
`loadPolicy` (multi-level `extends` resolution across `preset:` / `file:` / `github:` refs),
and `createGlobScope` / `globFiles` (the shared file walker that applies `ignore` and
`.gitignore`).

## Documentation

- Getting started & concepts: https://github.com/novexar/Guardsmith
- 3-layer policy design: https://github.com/novexar/Guardsmith/blob/main/docs/LAYERING.md

## License

Apache-2.0

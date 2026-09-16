<p align="center">
  <img src="https://raw.githubusercontent.com/novexar/Guardsmith/main/assets/logo.png" width="96" alt="GuardSmith logo">
</p>

<h1 align="center">@guardsmith/core</h1>

<p align="center">
  The rule engine behind <a href="https://github.com/novexar/Guardsmith">GuardSmith</a> —
  policy validation, 8 check types, tag-pinned remote resolution, and SARIF output.
</p>

<p align="center">
  English | <a href="https://github.com/novexar/Guardsmith/blob/main/README.ja.md">日本語</a>
</p>

---

> **Looking for the CLI?** Install
> [`@guardsmith/cli`](https://www.npmjs.com/package/@guardsmith/cli) instead — it is a thin
> wrapper around this package. Install `@guardsmith/core` directly only if you want to embed
> the engine in your own tool.

## What it provides

- **Policy schema** — strict zod validation of `guard.policy.yaml` / preset YAML
  (unknown keys are rejected; typos become errors)
- **8 check types** — file-exists / file-absent / content-match / max-lines / frontmatter /
  json-path / drift / secret-scan
- **Remote resolution** — `extends: github:owner/repo[//path]@tag` with mandatory tag pinning,
  local caching, multi-level composition, cycle detection, and path-traversal hardening
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
  const result = await runLint(parsed.policy, process.cwd());
  console.log(formatConsole(result));
  process.exitCode = result.ok ? 0 : 1;
}
```

Key exports: `parsePolicy` / `PolicyDocument`, reusable schema parts (`Rule`, `Exemption`,
`Severity`) for composing your own policy documents, `runLint` / `formatConsole` / `toSarif`,
and `loadPolicy` (multi-level `extends` resolution across `preset:` / `file:` / `github:` refs).

## Documentation

- Getting started & concepts: https://github.com/novexar/Guardsmith
- 3-layer policy design: https://github.com/novexar/Guardsmith/blob/main/docs/LAYERING.md

## License

Apache-2.0

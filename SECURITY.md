# Security Policy

**English** | [日本語](SECURITY.ja.md)

## Supported Versions

| Version | Supported |
| ------- | --------- |
| 0.6.x   | ✅        |

## Reporting a Vulnerability

Please **do not** open a public issue for security vulnerabilities.

- Use GitHub's [Private vulnerability reporting](https://github.com/novexar/Guardsmith/security/advisories/new)
- We aim to acknowledge reports within 7 days

## Scope notes

GuardSmith downloads and extracts remote tarballs (`github:` refs). The extraction
path is guarded against path traversal (`..` / absolute paths) and link entries,
and `//path` sub-references are contained to the cache root. Reports on bypasses of
these protections are especially welcome.

The `import-budget` check follows `@path` imports out of a `CLAUDE.md`, but it **never
reads anything outside the scan root**. References that escape with `..`, an absolute
path, `~/` or a backslash are rejected before any file access, and every file is resolved
with `realpath` and checked against the root before it is opened, so a symlink inside the
root that points outside is reported rather than read. Such references are only ever
reported as `info` (`import outside root, not measured`).

File walking honours `.gitignore` (nested files included) by default and always excludes
`.git/`, which narrows `secret-scan` to **files that could be committed** — a value inside
an ignored file such as `.claude/settings.local.json` is not reported. This is a scope
decision, not a detection guarantee: run `guard lint --no-gitignore` to audit ignored
files as well.

GuardSmith's secret-scan check is a best-effort guard against committing credentials
into AI context files — it is not a replacement for dedicated secret scanning.

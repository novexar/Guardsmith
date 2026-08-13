# Security Policy

## Supported Versions

| Version | Supported |
| ------- | --------- |
| 0.1.x   | ✅        |

## Reporting a Vulnerability

Please **do not** open a public issue for security vulnerabilities.

- Use GitHub's [Private vulnerability reporting](https://github.com/novexar/Guardsmith/security/advisories/new)
- We aim to acknowledge reports within 7 days

## Scope notes

GuardSmith downloads and extracts remote tarballs (`github:` refs). The extraction
path is guarded against path traversal (`..` / absolute paths) and link entries,
and `//path` sub-references are contained to the cache root. Reports on bypasses of
these protections are especially welcome.

GuardSmith's secret-scan check is a best-effort guard against committing credentials
into AI context files — it is not a replacement for dedicated secret scanning.

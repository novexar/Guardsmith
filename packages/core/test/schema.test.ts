/** ポリシースキーマ検証(旧 validate.ts のアサーションを移行) */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { parsePolicy } from "../src/schema.js";
import { REPO_ROOT } from "./helpers.js";

const bad = (over: object) => parsePolicy({ version: 1, target: "claude-code", ...over });

describe("policy schema", () => {
  it("parses presets/baseline.yaml", () => {
    const doc = parse(readFileSync(resolve(REPO_ROOT, "presets/baseline.yaml"), "utf8"));
    const r = parsePolicy(doc);
    expect(r.ok, r.ok ? "" : r.errors.join("; ")).toBe(true);
    if (r.ok) expect(r.policy.rules.length).toBeGreaterThan(0);
  });

  it("rejects unknown check", () => {
    expect(bad({ rules: [{ id: "a/b", severity: "error", check: "nope", with: {} }] }).ok).toBe(
      false,
    );
  });

  it("rejects bad rule id", () => {
    expect(
      bad({
        rules: [
          { id: "BadId", severity: "error", check: "max-lines", with: { path: "x", limit: 1 } },
        ],
      }).ok,
    ).toBe(false);
  });

  it("rejects unpinned remote extends", () => {
    expect(bad({ extends: ["github:novexar/claude-standards"] }).ok).toBe(false);
  });

  it("rejects content-match without must/must_not", () => {
    expect(
      bad({
        rules: [{ id: "a/b", severity: "error", check: "content-match", with: { path: "x" } }],
      }).ok,
    ).toBe(false);
  });

  it("rejects exemption without expires", () => {
    expect(bad({ exemptions: [{ rule: "a/b", reason: "x", approved_by: "tech-lead" }] }).ok).toBe(
      false,
    );
  });

  it("rejects duplicate rule ids", () => {
    expect(
      bad({
        rules: [
          { id: "a/b", severity: "error", check: "max-lines", with: { path: "x", limit: 1 } },
          { id: "a/b", severity: "warn", check: "max-lines", with: { path: "y", limit: 2 } },
        ],
      }).ok,
    ).toBe(false);
  });

  it("rejects typo key (strict)", () => {
    expect(
      bad({
        rules: [
          { id: "a/b", severity: "error", check: "max-lines", with: { path: "x", limits: 1 } },
        ],
      }).ok,
    ).toBe(false);
  });

  it("accepts a top-level ignore array and defaults it to []", () => {
    const r = bad({ ignore: [".claude/worktrees/**", "vendor/**"] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.policy.ignore).toEqual([".claude/worktrees/**", "vendor/**"]);

    const d = bad({});
    expect(d.ok).toBe(true);
    if (d.ok) expect(d.policy.ignore).toEqual([]);
  });

  it("rejects a non-array ignore", () => {
    expect(bad({ ignore: ".claude/worktrees/**" }).ok).toBe(false);
    expect(bad({ ignore: [1] }).ok).toBe(false);
    expect(bad({ ignore: [""] }).ok).toBe(false);
  });

  it("parses presets/self.yaml and presets/frontend.yaml", () => {
    for (const preset of ["presets/self.yaml", "presets/frontend.yaml"]) {
      const r = parsePolicy(parse(readFileSync(resolve(REPO_ROOT, preset), "utf8")));
      expect(r.ok, r.ok ? "" : `${preset}: ${r.errors.join("; ")}`).toBe(true);
    }
  });

  it("accepts pinned github extends and file drift source", () => {
    const r = bad({
      extends: ["github:novexar/guardsmith//presets/baseline.yaml@v0.1.0"],
      rules: [
        {
          id: "a/b",
          severity: "warn",
          check: "drift",
          with: { source: "file:./master", paths: ["x/**"] },
        },
      ],
    });
    expect(r.ok).toBe(true);
  });
});

/**
 * 全 check で未知キーが parse エラーになること。
 * Rule は discriminatedUnion 1段(共通フィールドは各ブランチへ平坦化)で構成しており、
 * かつて `.and(RuleBase)` の intersection で失われていた strict 判定がここで守られる。
 */
describe("strict rejection of unknown keys (all checks)", () => {
  /** check ごとの正当な with */
  const VALID_WITH: Record<string, Record<string, unknown>> = {
    "file-exists": { paths: ["CLAUDE.md"] },
    "file-absent": { paths: [".env"] },
    "content-match": { path: "CLAUDE.md", must: ["^## 技術スタック"] },
    "max-lines": { path: "CLAUDE.md", limit: 120 },
    "import-budget": { path: "CLAUDE.md", max_chars: 32000 },
    frontmatter: { paths: [".claude/agents/*.md"], required: ["name"] },
    "json-path": { path: "x.json", assert: [{ query: "$.a", op: "exists" }] },
    drift: { source: "file:./master", paths: [".claude/skills/**"] },
    "secret-scan": { paths: ["CLAUDE.md"] },
  };

  const policyWith = (rule: Record<string, unknown>) =>
    parsePolicy({ version: 1, target: "claude-code", rules: [rule] });

  for (const [check, w] of Object.entries(VALID_WITH)) {
    const base = { id: "a/b", severity: "warn", check, with: w };

    it(`${check}: accepts the valid shape`, () => {
      const r = policyWith(base);
      expect(r.ok, r.ok ? "" : r.errors.join("; ")).toBe(true);
    });

    it(`${check}: rejects an unknown top-level key`, () => {
      const r = policyWith({ ...base, severty: "warn" });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        const joined = r.errors.join("; ");
        expect(joined).toContain("rules.0");
        expect(joined).toContain("severty");
      }
    });

    it(`${check}: rejects an unknown key inside with`, () => {
      const r = policyWith({ ...base, with: { ...w, limt: 1 } });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        const joined = r.errors.join("; ");
        expect(joined).toContain("rules.0.with");
        expect(joined).toContain("limt");
      }
    });
  }

  it("still accepts the optional description field", () => {
    const r = policyWith({
      id: "a/b",
      severity: "warn",
      description: "説明",
      check: "max-lines",
      with: { path: "CLAUDE.md", limit: 120 },
    });
    expect(r.ok, r.ok ? "" : r.errors.join("; ")).toBe(true);
  });

  it("accepts the guard init template policy", () => {
    const r = parsePolicy(
      parse(
        "version: 1\ntarget: claude-code\nextends:\n  - preset:baseline\nrules: []\nexemptions: []\noutput:\n  formats: [console]\n",
      ),
    );
    expect(r.ok, r.ok ? "" : r.errors.join("; ")).toBe(true);
  });
});

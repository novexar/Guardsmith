/** 個別check検証(旧 test-checks.ts のcheck部分を移行+境界ケース追加) */
import { rmSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { extractFrontmatter } from "../src/checks.js";
import { runLint, type Finding, type LintResult } from "../src/lint.js";
import { parsePolicy, type PolicyDocument } from "../src/schema.js";
import { makeFixtureDir, write } from "./helpers.js";

let R: string;
let MASTER: string;
let res: LintResult;

const of = (id: string): Finding[] => res.findings.filter((f) => f.ruleId === id && !f.suppressed);

beforeAll(async () => {
  R = makeFixtureDir("gs-checks");
  MASTER = makeFixtureDir("gs-master");

  // max-lines: 5行制限に対し6行
  write(R, "CLAUDE.md", "1\n2\n3\n4\n5\n6");
  // frontmatter: tools欠落 + name形式違反
  write(R, ".claude/agents/bad.md", "---\nname: Bad Name\ndescription: x\n---\nbody");
  // file-absent: 禁止ファイル
  write(R, ".env", "X=1");
  // json-path: 危険permission
  write(R, ".claude/settings.json", `{"permissions":{"allow":["npm test","rm -rf /"]}}`);
  // drift: マスターと比較。allowedセクションのみ編集=OK、他セクション編集=NG
  const masterSkill = "intro\n## 手順\nstep1\n## PJ固有手順\n(ここに追記)\n";
  write(MASTER, ".claude/skills/start-task/SKILL.md", masterSkill);
  write(MASTER, ".claude/skills/finish-task/SKILL.md", masterSkill);
  write(
    R,
    ".claude/skills/start-task/SKILL.md",
    "intro\n## 手順\nstep1\n## PJ固有手順\nPJ独自の追記\n",
  ); // 許可範囲のみ
  write(
    R,
    ".claude/skills/finish-task/SKILL.md",
    "intro\n## 手順\n改変してしまった\n## PJ固有手順\n(ここに追記)\n",
  ); // 違反

  const doc = parsePolicy({
    version: 1,
    target: "claude-code",
    rules: [
      { id: "t/max", severity: "warn", check: "max-lines", with: { path: "CLAUDE.md", limit: 5 } },
      {
        id: "t/fm",
        severity: "error",
        check: "frontmatter",
        with: {
          paths: [".claude/agents/*.md"],
          required: ["name", "description", "tools"],
          schema: { name: "^[a-z-]+$" },
        },
      },
      { id: "t/absent", severity: "error", check: "file-absent", with: { paths: [".env"] } },
      {
        id: "t/perm",
        severity: "error",
        check: "json-path",
        with: {
          path: ".claude/settings.json",
          assert: [{ query: "$.permissions.allow[*]", op: "not-matches", value: "rm -rf" }],
        },
      },
      {
        id: "t/drift",
        severity: "warn",
        check: "drift",
        with: {
          source: `file:${MASTER.replaceAll("\\", "/")}`,
          paths: [".claude/skills/**"],
          allow_sections: ["## PJ固有手順"],
        },
      },
    ],
  });
  if (!doc.ok) throw new Error(doc.errors.join("; "));
  res = await runLint(doc.policy as PolicyDocument, R);
});

afterAll(() => {
  rmSync(R, { recursive: true, force: true });
  rmSync(MASTER, { recursive: true, force: true });
});

describe("checks", () => {
  it("max-lines detects oversize", () => {
    expect(of("t/max")).toHaveLength(1);
    expect(of("t/max")[0].message).toContain("6 lines");
  });

  it("frontmatter detects missing key", () => {
    expect(of("t/fm").some((f) => f.message.includes("tools"))).toBe(true);
  });

  it("frontmatter detects schema violation", () => {
    expect(of("t/fm").some((f) => f.message.includes("name"))).toBe(true);
  });

  it("file-absent detects forbidden file", () => {
    expect(of("t/absent")).toHaveLength(1);
  });

  it("json-path detects dangerous permission", () => {
    expect(of("t/perm")).toHaveLength(1);
  });

  it("drift: allowed-section edit passes", () => {
    expect(of("t/drift").some((f) => f.file?.includes("start-task"))).toBe(false);
  });

  it("drift: non-allowed section edit fails", () => {
    expect(
      of("t/drift").some((f) => f.file?.includes("finish-task") && f.message.includes("## 手順")),
    ).toBe(true);
  });
});

describe("check edge cases", () => {
  it("extractFrontmatter returns null for invalid YAML / non-object", () => {
    expect(extractFrontmatter("---\n: {invalid\n---\n")).toBeNull();
    expect(extractFrontmatter("---\nplain string\n---\n")).toBeNull();
    expect(extractFrontmatter("no frontmatter")).toBeNull();
  });

  it("json-path: missing target file yields info skip", async () => {
    const doc = parsePolicy({
      version: 1,
      target: "claude-code",
      rules: [
        {
          id: "t/perm",
          severity: "error",
          check: "json-path",
          with: { path: "nope/settings.json", assert: [{ query: "$.x", op: "exists" }] },
        },
      ],
    });
    if (!doc.ok) throw new Error(doc.errors.join("; "));
    const r = await runLint(doc.policy as PolicyDocument, R);
    expect(r.ok).toBe(true);
    expect(r.findings[0].severity).toBe("info");
    expect(r.findings[0].message).toContain("skipped");
  });

  it("json-path: unparseable file yields error / eq+exists+absent semantics", async () => {
    const root = makeFixtureDir("gs-jp");
    write(root, "broken.json", "{not json");
    write(root, "conf.yaml", "a: 1\nlist: [x, y]\n");
    const doc = parsePolicy({
      version: 1,
      target: "claude-code",
      rules: [
        {
          id: "t/broken",
          severity: "error",
          check: "json-path",
          with: { path: "broken.json", assert: [{ query: "$.a", op: "exists" }] },
        },
        {
          id: "t/yaml",
          severity: "error",
          check: "json-path",
          with: {
            path: "conf.yaml",
            assert: [
              { query: "$.a", op: "eq", value: 1 },
              { query: "$.a", op: "ne", value: 2 },
              { query: "$.missing", op: "absent" },
              { query: "$.list[*]", op: "matches", value: "^[xy]$" },
            ],
          },
        },
      ],
    });
    if (!doc.ok) throw new Error(doc.errors.join("; "));
    const r = await runLint(doc.policy as PolicyDocument, root);
    const broken = r.findings.filter((f) => f.ruleId === "t/broken");
    expect(broken).toHaveLength(1);
    expect(broken[0].message).toContain("failed to parse");
    expect(r.findings.filter((f) => f.ruleId === "t/yaml")).toHaveLength(0);
    rmSync(root, { recursive: true, force: true });
  });

  it("secret-scan honors extra_patterns", async () => {
    const root = makeFixtureDir("gs-secret");
    write(root, "notes.md", "internal codename PROJECT-ATLANTIS here\n");
    const doc = parsePolicy({
      version: 1,
      target: "claude-code",
      rules: [
        {
          id: "t/secret",
          severity: "error",
          check: "secret-scan",
          with: { paths: ["**/*.md"], extra_patterns: ["PROJECT-[A-Z]+"] },
        },
      ],
    });
    if (!doc.ok) throw new Error(doc.errors.join("; "));
    const r = await runLint(doc.policy as PolicyDocument, root);
    expect(r.findings.some((f) => f.message.includes("custom"))).toBe(true);
    rmSync(root, { recursive: true, force: true });
  });

  it("drift: CRLF/LF differences are not reported as drift (Windows checkouts)", async () => {
    const root = makeFixtureDir("gs-drift-eol");
    const master = makeFixtureDir("gs-drift-eol-master");
    write(master, "skills/a/SKILL.md", "intro\n## 手順\nstep1\n");
    write(root, "skills/a/SKILL.md", "intro\r\n## 手順\r\nstep1\r\n"); // CRLFチェックアウト相当
    const doc = parsePolicy({
      version: 1,
      target: "claude-code",
      rules: [
        {
          id: "t/drift",
          severity: "warn",
          check: "drift",
          with: { source: `file:${master.replaceAll("\\", "/")}`, paths: ["skills/**"] },
        },
      ],
    });
    if (!doc.ok) throw new Error(doc.errors.join("; "));
    const r = await runLint(doc.policy as PolicyDocument, root);
    expect(r.findings.filter((f) => f.ruleId === "t/drift" && f.severity === "warn")).toHaveLength(
      0,
    );
    rmSync(root, { recursive: true, force: true });
    rmSync(master, { recursive: true, force: true });
  });

  it("drift: file missing in master yields info (project-local file)", async () => {
    const root = makeFixtureDir("gs-drift-local");
    const master = makeFixtureDir("gs-drift-master");
    write(root, "skills/local-only.md", "PJ独自スキル\n");
    write(master, "README.md", "master\n");
    const doc = parsePolicy({
      version: 1,
      target: "claude-code",
      rules: [
        {
          id: "t/drift",
          severity: "warn",
          check: "drift",
          with: { source: `file:${master.replaceAll("\\", "/")}`, paths: ["skills/**"] },
        },
      ],
    });
    if (!doc.ok) throw new Error(doc.errors.join("; "));
    const r = await runLint(doc.policy as PolicyDocument, root);
    expect(
      r.findings.some((f) => f.severity === "info" && f.message.includes("project-local")),
    ).toBe(true);
    rmSync(root, { recursive: true, force: true });
    rmSync(master, { recursive: true, force: true });
  });
});

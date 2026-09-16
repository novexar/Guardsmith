/** presets/frontend.yaml E2E: パース / preset:frontend 解決 / 正例=warnゼロ / 負例=各ルール検出 */
import { readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { runLint, type LintResult } from "../src/lint.js";
import { loadPolicy } from "../src/resolver.js";
import { parsePolicy, type PolicyDocument } from "../src/schema.js";
import { makeFixtureDir, REPO_ROOT, write } from "./helpers.js";

const policyDoc = parsePolicy(
  parse(readFileSync(resolve(REPO_ROOT, "presets/frontend.yaml"), "utf8")),
);
if (!policyDoc.ok) throw new Error(policyDoc.errors.join("; "));
const policy: PolicyDocument = policyDoc.policy;

const GOOD_DESIGN_MD = `# DESIGN.md — sample
## 1. Visual Theme & Atmosphere
ダークモード既定・高情報密度。
## 2. Color Palette & Roles
Accent: #6366f1 / success #22c55e / warning #f59e0b / danger #ef4444
`;

const GOOD_PACKAGE_JSON = JSON.stringify({
  name: "sample-fe",
  dependencies: {
    react: "^19",
    "@tanstack/react-router": "^1",
    "@tanstack/react-query": "^5",
    tailwindcss: "^4",
  },
});

/** 正例: DESIGN.md 具体化済み + components.json あり + 競合UIライブラリ無し */
function buildGood(root: string) {
  write(root, "DESIGN.md", GOOD_DESIGN_MD);
  write(root, "components.json", `{"$schema":"https://ui.shadcn.com/schema.json"}`);
  write(root, "package.json", GOOD_PACKAGE_JSON);
}

/** 負例A: DESIGN.md 欠落 + components.json 欠落 + @mui 依存 */
function buildBadMissing(root: string) {
  write(
    root,
    "package.json",
    JSON.stringify({ name: "bad-fe", dependencies: { "@mui/material": "^6" } }),
  );
}

/** 負例B: DESIGN.md が雛形のまま(プレースホルダ + gen: コメント残存) */
function buildBadUninitialized(root: string) {
  buildGood(root);
  write(
    root,
    "DESIGN.md",
    "<!-- gen: 具体化せよ -->\n# DESIGN.md — {{PROJECT_NAME}}\nAccent: {{ACCENT_COLOR}}\n",
  );
}

let goodRoot: string;
let badMissingRoot: string;
let badUninitRoot: string;
let good: LintResult;
let badMissing: LintResult;
let badUninit: LintResult;

beforeAll(async () => {
  goodRoot = makeFixtureDir("gs-fe-good");
  badMissingRoot = makeFixtureDir("gs-fe-bad-missing");
  badUninitRoot = makeFixtureDir("gs-fe-bad-uninit");
  buildGood(goodRoot);
  buildBadMissing(badMissingRoot);
  buildBadUninitialized(badUninitRoot);
  good = await runLint(policy, goodRoot);
  badMissing = await runLint(policy, badMissingRoot);
  badUninit = await runLint(policy, badUninitRoot);
});

afterAll(() => {
  rmSync(goodRoot, { recursive: true, force: true });
  rmSync(badMissingRoot, { recursive: true, force: true });
  rmSync(badUninitRoot, { recursive: true, force: true });
});

describe("frontend preset: policy file", () => {
  it("parses via parsePolicy (schema-valid)", () => {
    expect(policy.target).toBe("claude-code");
    expect(policy.rules.map((r) => r.id).sort()).toEqual([
      "frontend/design-md",
      "frontend/design-md-initialized",
      "frontend/no-competing-ui-libs",
      "frontend/shadcn-config",
    ]);
  });

  it("resolves as 'preset:frontend' through loadPolicy (extends merge)", async () => {
    const root = makeFixtureDir("gs-fe-policy");
    try {
      write(
        root,
        "guard.policy.yaml",
        "version: 1\ntarget: claude-code\nextends: [ 'preset:frontend' ]\nrules: []\n",
      );
      const merged = await loadPolicy(join(root, "guard.policy.yaml"));
      expect(merged.rules.some((r) => r.id === "frontend/design-md")).toBe(true);
      expect(merged.rules.some((r) => r.id === "frontend/no-competing-ui-libs")).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("frontend preset: good fixture", () => {
  it("passes with zero warn", () => {
    expect(good.ok).toBe(true);
    expect(good.stats.warn).toBe(0);
  });

  it("has no frontend/* findings at all", () => {
    expect(good.findings.filter((f) => f.severity !== "info")).toEqual([]);
  });
});

describe("frontend preset: bad fixture (missing files + @mui)", () => {
  const ids = () => badMissing.findings.filter((f) => f.severity === "warn").map((f) => f.ruleId);

  it("detects missing DESIGN.md", () => {
    expect(ids()).toContain("frontend/design-md");
  });

  it("detects missing components.json", () => {
    expect(ids()).toContain("frontend/shadcn-config");
  });

  it("detects competing UI library (@mui)", () => {
    expect(ids()).toContain("frontend/no-competing-ui-libs");
  });

  it("skips design-md-initialized as info when DESIGN.md is absent (file-exists の責務)", () => {
    expect(
      badMissing.findings.some(
        (f) => f.ruleId === "frontend/design-md-initialized" && f.severity === "info",
      ),
    ).toBe(true);
    expect(ids()).not.toContain("frontend/design-md-initialized");
  });

  it("stays ok (warn only, no error)", () => {
    expect(badMissing.ok).toBe(true);
    expect(badMissing.stats.error).toBe(0);
  });
});

describe("frontend preset: bad fixture (uninitialized DESIGN.md)", () => {
  it("detects remaining placeholder and gen: comment", () => {
    const findings = badUninit.findings.filter(
      (f) => f.ruleId === "frontend/design-md-initialized" && f.severity === "warn",
    );
    expect(findings).toHaveLength(2); // {{.*}} と <!-- gen: の2パターン
  });

  it("does not flag other frontend rules", () => {
    const ids = badUninit.findings.filter((f) => f.severity === "warn").map((f) => f.ruleId);
    expect(ids).toEqual(["frontend/design-md-initialized", "frontend/design-md-initialized"]);
  });
});

/** resolver(extendsマージ)と SARIF/console レポータ検証(旧 test-checks.ts のresolver部分を移行) */
import { rmSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { formatConsole, type LintResult } from "../src/lint.js";
import { loadPolicy, toSarif } from "../src/resolver.js";
import { makeFixtureDir, write } from "./helpers.js";

let BASE: string;

beforeAll(() => {
  BASE = makeFixtureDir("gs-policy");
  write(
    BASE,
    "presets/base.yaml",
    `version: 1
target: claude-code
rules:
  - id: a/one
    severity: error
    check: max-lines
    with: { path: CLAUDE.md, limit: 100 }
  - id: a/two
    severity: warn
    check: file-absent
    with: { paths: ['.env'] }
`,
  );
  write(
    BASE,
    "guard.policy.yaml",
    `version: 1
target: claude-code
extends: [ 'preset:base' ]
rules:
  - id: a/one
    severity: warn
    check: max-lines
    with: { path: CLAUDE.md, limit: 200 }
`,
  );
});

afterAll(() => {
  rmSync(BASE, { recursive: true, force: true });
});

describe("resolver", () => {
  it("merges preset rules and local rule overrides preset", async () => {
    const merged = await loadPolicy(join(BASE, "guard.policy.yaml"));
    expect(merged.rules.some((r) => r.id === "a/two")).toBe(true);
    expect(merged.rules.find((r) => r.id === "a/one")?.severity).toBe("warn");
  });

  it("raises explicit error for unresolvable preset", async () => {
    write(
      BASE,
      "missing-preset.yaml",
      "version: 1\ntarget: claude-code\nextends: [ 'preset:no-such' ]\nrules: []\n",
    );
    await expect(loadPolicy(join(BASE, "missing-preset.yaml"))).rejects.toThrow(/preset not found/);
  });

  it("raises error on invalid policy file", async () => {
    write(BASE, "invalid.yaml", "version: 2\ntarget: claude-code\nrules: []\n");
    await expect(loadPolicy(join(BASE, "invalid.yaml"))).rejects.toThrow(/invalid policy/);
  });

  it("resolves chained extends (3-layer) with later layers winning", async () => {
    write(
      BASE,
      "layer2.yaml",
      `version: 1
target: claude-code
extends: [ 'preset:base' ]
rules:
  - id: a/one
    severity: warn
    check: max-lines
    with: { path: CLAUDE.md, limit: 150 }
  - id: b/extra
    severity: info
    check: file-absent
    with: { paths: ['.tmp'] }
`,
    );
    write(
      BASE,
      "layer3.yaml",
      `version: 1
target: claude-code
extends: [ 'file:./layer2.yaml' ]
rules:
  - id: a/one
    severity: info
    check: max-lines
    with: { path: CLAUDE.md, limit: 300 }
`,
    );
    const merged = await loadPolicy(join(BASE, "layer3.yaml"));
    // Layer1 (preset:base) のルールが多段extends経由で届く
    expect(merged.rules.some((r) => r.id === "a/two")).toBe(true);
    // Layer2 の追加ルール
    expect(merged.rules.some((r) => r.id === "b/extra")).toBe(true);
    // Layer3 が最優先(後勝ち)
    expect(merged.rules.find((r) => r.id === "a/one")?.severity).toBe("info");
  });

  it("detects circular extends", async () => {
    write(
      BASE,
      "cyc-a.yaml",
      "version: 1\ntarget: claude-code\nextends: [ 'file:./cyc-b.yaml' ]\nrules: []\n",
    );
    write(
      BASE,
      "cyc-b.yaml",
      "version: 1\ntarget: claude-code\nextends: [ 'file:./cyc-a.yaml' ]\nrules: []\n",
    );
    await expect(loadPolicy(join(BASE, "cyc-a.yaml"))).rejects.toThrow(/circular extends/);
  });

  it("rejects unsupported ref scheme", async () => {
    write(
      BASE,
      "bad-ref.yaml",
      "version: 1\ntarget: claude-code\nextends: [ 'file:./x.txt' ]\nrules: []\n",
    );
    // schema 側で弾かれる(file: は .yaml/.yml のみ)
    await expect(loadPolicy(join(BASE, "bad-ref.yaml"))).rejects.toThrow();
  });
});

describe("reporters", () => {
  const result: LintResult = {
    ok: false,
    findings: [
      { ruleId: "a/one", severity: "error", message: "boom", file: "CLAUDE.md", line: 3 },
      { ruleId: "a/two", severity: "warn", message: "meh", suppressed: true },
    ],
    stats: { error: 1, warn: 0, info: 0, suppressed: 1 },
  };

  it("toSarif produces valid SARIF 2.1.0 with suppressions", async () => {
    const policy = await loadPolicy(join(BASE, "guard.policy.yaml"));
    const sarif = JSON.parse(toSarif(result, policy));
    expect(sarif.version).toBe("2.1.0");
    const run = sarif.runs[0];
    expect(run.tool.driver.rules.map((r: { id: string }) => r.id).sort()).toEqual([
      "a/one",
      "a/two",
    ]);
    expect(run.results[0].level).toBe("error");
    expect(run.results[0].locations[0].physicalLocation.region.startLine).toBe(3);
    expect(run.results[1].suppressions).toHaveLength(1);
  });

  it("formatConsole renders findings and summary", () => {
    const text = formatConsole(result);
    expect(text).toContain("ERROR");
    expect(text).toContain("SUPPRESSED");
    expect(text).toContain("CLAUDE.md:3");
    expect(text).toContain("FAILED: 1 error, 0 warn, 0 info, 1 suppressed");
  });
});

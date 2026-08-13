/** guard new — standards/ 一式の新規PJ展開 */
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { main } from "../src/cli.js";
import { parsePolicy } from "../src/schema.js";
import { makeFixtureDir, write } from "./helpers.js";

const cleanupDirs: string[] = [];
afterAll(() => {
  for (const d of cleanupDirs) rmSync(d, { recursive: true, force: true });
});

describe("guard new", () => {
  it("expands standards into an empty dir with policy + version stamp", async () => {
    const parent = makeFixtureDir("gs-new");
    cleanupDirs.push(parent);
    const dest = join(parent, "my-project");

    expect(await main(["new", dest])).toBe(0);

    // standards 一式が展開されている
    expect(existsSync(join(dest, "CLAUDE.md"))).toBe(true);
    expect(existsSync(join(dest, ".claude/agents/backend-engineer.md"))).toBe(true);
    expect(existsSync(join(dest, ".claude/skills/start-task/SKILL.md"))).toBe(true);
    expect(existsSync(join(dest, "docs/REQUIREMENTS.md"))).toBe(true);

    // standards バージョンコメントが guardsmith 版へ書き換わっている
    const claudeMd = readFileSync(join(dest, "CLAUDE.md"), "utf8");
    expect(claudeMd).toContain("<!-- standards: novexar/guardsmith v0.2.1 -->");
    expect(claudeMd).not.toContain("standards: novexar/claude-standards");

    // タグ固定のリモート参照を持つ guard.policy.yaml が生成され、スキーマを通る
    const policyRaw = readFileSync(join(dest, "guard.policy.yaml"), "utf8");
    expect(policyRaw).toContain("github:novexar/guardsmith//presets/baseline.yaml@v0.2.1");
    const parsed = parsePolicy(parse(policyRaw));
    expect(parsed.ok).toBe(true);
  });

  it("refuses a non-empty directory and requires <dir>", async () => {
    const parent = makeFixtureDir("gs-new-refuse");
    cleanupDirs.push(parent);
    write(parent, "existing.txt", "x");
    expect(await main(["new", parent])).toBe(2);
    expect(await main(["new"])).toBe(2);
  });
});

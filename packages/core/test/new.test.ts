/** guard new — standards/ 一式の新規PJ展開 */
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { main, restoreDotfiles } from "../src/cli.js";
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
    // .gitignore が(どの配布経路でも)存在すること(#1)
    expect(existsSync(join(dest, ".gitignore"))).toBe(true);
    expect(existsSync(join(dest, "gitignore"))).toBe(false);

    // Issue テンプレートは feature / bug / chore の3種(旧 task.md は配布しない)
    expect(existsSync(join(dest, ".github/ISSUE_TEMPLATE/feature.md"))).toBe(true);
    expect(existsSync(join(dest, ".github/ISSUE_TEMPLATE/bug.md"))).toBe(true);
    expect(existsSync(join(dest, ".github/ISSUE_TEMPLATE/chore.md"))).toBe(true);
    expect(existsSync(join(dest, ".github/ISSUE_TEMPLATE/task.md"))).toBe(false);

    // 外部ツール連携用の HTTP hooks サンプルが展開され、JSON として妥当である
    const hooksExamplePath = join(dest, ".claude/settings.local.json.example");
    expect(existsSync(hooksExamplePath)).toBe(true);
    const hooksExample = JSON.parse(readFileSync(hooksExamplePath, "utf8")) as {
      hooks?: Record<string, unknown>;
    };
    expect(hooksExample.hooks?.["SessionStart"]).toBeDefined();

    // ponytail 導入用の共有 settings.json が展開され、JSON として妥当である
    const settingsPath = join(dest, ".claude/settings.json");
    expect(existsSync(settingsPath)).toBe(true);
    const settings = JSON.parse(readFileSync(settingsPath, "utf8")) as {
      enabledPlugins?: Record<string, boolean>;
    };
    expect(settings.enabledPlugins?.["ponytail@ponytail"]).toBe(true);

    // standards バージョンコメントが guardsmith 版へ書き換わっている
    const claudeMd = readFileSync(join(dest, "CLAUDE.md"), "utf8");
    expect(claudeMd).toContain("<!-- standards: novexar/guardsmith v0.5.2 -->");
    expect(claudeMd).not.toContain("standards: novexar/claude-standards");

    // タグ固定のリモート参照を持つ guard.policy.yaml が生成され、スキーマを通る
    const policyRaw = readFileSync(join(dest, "guard.policy.yaml"), "utf8");
    expect(policyRaw).toContain("github:novexar/guardsmith//presets/baseline.yaml@v0.5.2");
    const parsed = parsePolicy(parse(policyRaw));
    expect(parsed.ok).toBe(true);
  });

  it("restoreDotfiles renames a dotless gitignore (npm パッケージ配布経路 — #1)", () => {
    const dir = makeFixtureDir("gs-new-dotfiles");
    cleanupDirs.push(dir);
    write(dir, "gitignore", "node_modules/\n");
    restoreDotfiles(dir);
    expect(existsSync(join(dir, ".gitignore"))).toBe(true);
    expect(existsSync(join(dir, "gitignore"))).toBe(false);
    expect(readFileSync(join(dir, ".gitignore"), "utf8")).toContain("node_modules/");
    // 両方ある場合はドット付きを正としてドットなしを消す(冪等)
    write(dir, "gitignore", "duplicate\n");
    restoreDotfiles(dir);
    expect(readFileSync(join(dir, ".gitignore"), "utf8")).toContain("node_modules/");
    expect(existsSync(join(dir, "gitignore"))).toBe(false);
  });

  it("refuses a non-empty directory and requires <dir>", async () => {
    const parent = makeFixtureDir("gs-new-refuse");
    cleanupDirs.push(parent);
    write(parent, "existing.txt", "x");
    expect(await main(["new", parent])).toBe(2);
    expect(await main(["new"])).toBe(2);
  });
});

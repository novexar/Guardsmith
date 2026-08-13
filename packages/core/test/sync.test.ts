/** guard sync — dry-run差分・write復元・allow_sections保全のE2E */
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { main } from "../src/cli.js";
import { planSync } from "../src/sync.js";
import { loadPolicy } from "../src/resolver.js";
import { makeFixtureDir, write } from "./helpers.js";

const MASTER_SKILL = "intro\n## 手順\nstep1\nstep2\n## PJ固有手順\n(ここに追記)\n";
const LOCAL_DRIFTED =
  "intro\n## 手順\n勝手に改変\n## PJ固有手順\nPJ独自の追記\n## 勝手な追加\n独自セクション\n";

let master: string;
let proj: string;

function buildFixtures() {
  master = makeFixtureDir("gs-sync-master");
  proj = makeFixtureDir("gs-sync-proj");
  write(master, ".claude/skills/start-task/SKILL.md", MASTER_SKILL);
  write(master, ".claude/skills/finish-task/SKILL.md", MASTER_SKILL);

  // start-task: 標準節を改変+非許可セクションを追加(復元対象)。許可セクションの編集は保全
  write(proj, ".claude/skills/start-task/SKILL.md", LOCAL_DRIFTED);
  // finish-task: ローカルに存在しない(create対象)
  // ローカル固有ファイル(維持対象)
  write(proj, ".claude/skills/local-note/NOTE.md", "PJ固有メモ\n");

  const masterPosix = master.replaceAll("\\", "/");
  write(
    proj,
    "guard.policy.yaml",
    `version: 1
target: claude-code
rules:
  - id: drift/skills-sync
    severity: warn
    check: drift
    with:
      source: file:${masterPosix}
      paths: ['.claude/skills/**']
      allow_sections: ['## PJ固有手順']
`,
  );
}

beforeAll(buildFixtures);
afterAll(() => {
  rmSync(master, { recursive: true, force: true });
  rmSync(proj, { recursive: true, force: true });
});

describe("planSync", () => {
  it("plans restore for drifted sections and create for missing files", async () => {
    const policy = await loadPolicy(join(proj, "guard.policy.yaml"));
    const plan = await planSync(policy, proj);

    const restore = plan.actions.find((a) => a.file.includes("start-task"));
    expect(restore?.kind).toBe("restore");
    expect(restore?.sections).toContain("## 手順");
    expect(restore?.sections).toContain("## 勝手な追加 (removed)");
    expect(restore?.sections).not.toContain("## PJ固有手順");

    const created = plan.actions.find((a) => a.file.includes("finish-task"));
    expect(created?.kind).toBe("create");

    expect(plan.localOnly).toContain(".claude/skills/local-note/NOTE.md");
  });

  it("throws when drift source is not resolved to file:", async () => {
    const policy = await loadPolicy(join(proj, "guard.policy.yaml"));
    const broken = {
      ...policy,
      rules: policy.rules.map((r) =>
        r.check === "drift" ? { ...r, with: { ...r.with, source: "github:acme/x@v1" } } : r,
      ),
    };
    await expect(planSync(broken, proj)).rejects.toThrow(/not resolved/);
  });
});

describe("guard sync CLI", () => {
  it("dry-run (default) reports the plan without modifying files", async () => {
    const before = readFileSync(join(proj, ".claude/skills/start-task/SKILL.md"), "utf8");
    expect(await main(["sync", "--root", proj])).toBe(0);
    expect(readFileSync(join(proj, ".claude/skills/start-task/SKILL.md"), "utf8")).toBe(before);
    expect(existsSync(join(proj, ".claude/skills/finish-task/SKILL.md"))).toBe(false);
  });

  it("--write restores master content while preserving allow_sections", async () => {
    expect(await main(["sync", "--root", proj, "--write"])).toBe(0);

    const startTask = readFileSync(join(proj, ".claude/skills/start-task/SKILL.md"), "utf8");
    // 標準節はマスターへ復元
    expect(startTask).toContain("## 手順\nstep1\nstep2");
    expect(startTask).not.toContain("勝手に改変");
    // 非許可の独自セクションは削除
    expect(startTask).not.toContain("## 勝手な追加");
    // 許可セクションのPJ編集は保全
    expect(startTask).toContain("## PJ固有手順\nPJ独自の追記");

    // 欠落ファイルはマスターから作成
    expect(readFileSync(join(proj, ".claude/skills/finish-task/SKILL.md"), "utf8")).toBe(
      MASTER_SKILL,
    );
    // ローカル固有ファイルは維持
    expect(readFileSync(join(proj, ".claude/skills/local-note/NOTE.md"), "utf8")).toBe(
      "PJ固有メモ\n",
    );
  });

  it("is idempotent: second sync reports already in sync", async () => {
    const policy = await loadPolicy(join(proj, "guard.policy.yaml"));
    const plan = await planSync(policy, proj);
    expect(plan.actions).toHaveLength(0);
  });
});

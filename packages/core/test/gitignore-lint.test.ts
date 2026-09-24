/**
 * lint 統合検証 — policy の ignore と .gitignore 追従が走査対象を絞り込むこと。
 * 背景: リポジトリ直下の .claude/worktrees/ 配下(各エージェントの .venv 等)が毎回走査され、
 *       secret-scan が .venv 内のファイルを誤検知していた(cctower #109)。
 */
import { rmSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runLint } from "../src/lint.js";
import { parsePolicy, type PolicyDocument } from "../src/schema.js";
import { makeFixtureDir, write } from "./helpers.js";

/** 疑似シークレット(AWS access key 形式)。実在しない値 */
const FAKE_SECRET = "AKIA" + "ABCDEFGHIJKLMNOP";

let R: string;

beforeAll(() => {
  R = makeFixtureDir("gs-ignore");
  write(R, ".gitignore", "node_modules/\n.claude/worktrees/\n.claude/settings.local.json\n");
  write(R, "CLAUDE.md", "# project\n");
  write(R, ".claude/agents/reviewer.md", "clean\n");
  // エージェント用 worktree(.gitignore 対象)配下の疑似 .venv
  write(R, ".claude/worktrees/agent-a/.venv/Scripts/activate", `KEY=${FAKE_SECRET}\n`);
  write(R, ".claude/settings.local.json", `{"token":"${FAKE_SECRET}"}`);
});

afterAll(() => rmSync(R, { recursive: true, force: true }));

function policy(over: Partial<PolicyDocument> = {}): PolicyDocument {
  const r = parsePolicy({
    version: 1,
    target: "claude-code",
    rules: [
      {
        id: "security/no-secrets-in-context",
        severity: "error",
        check: "secret-scan",
        with: { paths: ["CLAUDE.md", ".claude/**"] },
      },
    ],
    ...over,
  });
  if (!r.ok) throw new Error(r.errors.join("; "));
  return r.policy;
}

const ids = (findings: { ruleId: string; suppressed?: boolean }[]): string[] =>
  findings.filter((f) => !f.suppressed).map((f) => f.ruleId);

describe("guard lint × .gitignore", () => {
  it("skips .gitignore'd paths by default (no false positive from .venv)", async () => {
    const res = await runLint(policy(), R);
    expect(ids(res.findings)).not.toContain("security/no-secrets-in-context");
    expect(res.ok).toBe(true);
  });

  it("scans everything with gitignore disabled (--no-gitignore)", async () => {
    const res = await runLint(policy(), R, new Date(), { gitignore: false });
    const hits = res.findings.filter((f) => f.ruleId === "security/no-secrets-in-context");
    expect(hits.length).toBeGreaterThanOrEqual(2);
    expect(hits.map((f) => f.file)).toContain(".claude/settings.local.json");
    expect(res.ok).toBe(false);
  });

  it("honours the policy-level ignore key even with gitignore disabled", async () => {
    const res = await runLint(
      policy({ ignore: [".claude/worktrees/**", ".claude/settings.local.json"] }),
      R,
      new Date(),
      { gitignore: false },
    );
    expect(ids(res.findings)).not.toContain("security/no-secrets-in-context");
  });

  it("still honours a negative path pattern (baseline's !.claude/worktrees/**)", async () => {
    const p = policy({
      rules: [
        {
          id: "security/no-secrets-in-context",
          severity: "error",
          check: "secret-scan",
          with: { paths: ["CLAUDE.md", ".claude/**", "!.claude/worktrees/**"] },
        },
      ],
    } as Partial<PolicyDocument>);
    const res = await runLint(p, R, new Date(), { gitignore: false });
    const files = res.findings
      .filter((f) => f.ruleId === "security/no-secrets-in-context")
      .map((f) => f.file);
    expect(files).not.toContain(".claude/worktrees/agent-a/.venv/Scripts/activate");
  });

  it("treats a .gitignore'd path as non-existent for file-exists", async () => {
    const p = policy({
      rules: [
        {
          id: "structure/required-layout",
          severity: "error",
          check: "file-exists",
          with: { paths: [".claude/settings.local.json"] },
        },
      ],
    } as Partial<PolicyDocument>);
    expect(ids((await runLint(p, R)).findings)).toContain("structure/required-layout");
    expect(ids((await runLint(p, R, new Date(), { gitignore: false })).findings)).not.toContain(
      "structure/required-layout",
    );
  });
});

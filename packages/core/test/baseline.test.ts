/** baseline.yaml E2E: 準拠リポジトリ=PASS / 違反リポジトリ=期待どおり検出(旧 test-lint.ts を移行) */
import { readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { runLint, type LintResult } from "../src/lint.js";
import { parsePolicy, type PolicyDocument } from "../src/schema.js";
import { makeFixtureDir, REPO_ROOT, write } from "./helpers.js";

const policyDoc = parsePolicy(
  parse(readFileSync(resolve(REPO_ROOT, "presets/baseline.yaml"), "utf8")),
);
if (!policyDoc.ok) throw new Error(policyDoc.errors.join("; "));
const policy: PolicyDocument = policyDoc.policy;

const GOOD_CLAUDE_MD = `# CLAUDE.md — sample
## 技術スタック
React / FastAPI
## よく使うコマンド
npm test
## ブランチ戦略
feature-<issue>
## PJ固有ルール
なし
<!-- standards: novexar/guardsmith v0.1.0 -->
`;

function buildGood(root: string) {
  write(root, "CLAUDE.md", GOOD_CLAUDE_MD);
  write(
    root,
    ".claude/agents/backend-engineer.md",
    "---\nname: backend-engineer\ndescription: API実装担当\ntools: Read, Write, Bash\n---\n作業フロー\n",
  );
  write(
    root,
    ".claude/skills/start-task/SKILL.md",
    "---\nname: start-task\ndescription: Issue着手\n---\nintro\n## 手順\nstep1\n## PJ固有手順\n(追記)\n",
  );
  write(
    root,
    ".claude/skills/finish-task/SKILL.md",
    "---\nname: finish-task\ndescription: 完了処理\n---\nintro\n## 手順\nstep1\n## PJ固有手順\n(追記)\n",
  );
  write(root, "docs/overview.md", "docs\n");
  write(root, ".claude/settings.json", `{"permissions":{"allow":["npm test"]}}`);
}

function buildBad(root: string) {
  buildGood(root);
  // 未初期化テンプレのまま運用(プレースホルダ+警告+gen:コメント+契約見出し欠落)
  write(
    root,
    "CLAUDE.md",
    "> 未初期化テンプレート\n<!-- gen: 置換せよ -->\n# CLAUDE.md — {{PROJECT_NAME}}\n",
  );
  // agent: gen:コメント残存 + tools欠落
  write(
    root,
    ".claude/agents/backend-engineer.md",
    "<!-- gen: 具体化せよ -->\n---\nname: backend-engineer\ndescription: {{BE_STACK}}担当\n---\n",
  );
  // agent: frontmatterは正しいがtools欠落(frontmatterチェック単体の検証用)
  write(
    root,
    ".claude/agents/db-engineer.md",
    "---\nname: db-engineer\ndescription: DB担当\n---\n作業フロー\n",
  );
  // シークレット混入 + 必須skill欠落
  write(root, ".claude/notes.md", 'api_key = "sk1234567890abcdefghij"\n');
  rmSync(join(root, ".claude/skills/finish-task"), { recursive: true });
}

let goodRoot: string;
let badRoot: string;
let good: LintResult;
let bad: LintResult;

beforeAll(async () => {
  goodRoot = makeFixtureDir("gs-good");
  badRoot = makeFixtureDir("gs-bad");
  buildGood(goodRoot);
  buildBad(badRoot);
  good = await runLint(policy, goodRoot);
  bad = await runLint(policy, badRoot);
});

afterAll(() => {
  rmSync(goodRoot, { recursive: true, force: true });
  rmSync(badRoot, { recursive: true, force: true });
});

describe("baseline: good fixture", () => {
  it("passes", () => {
    expect(good.ok).toBe(true);
  });

  it("has zero warn (drift/skills-sync is info-skipped until github: fetch)", () => {
    expect(good.stats.warn).toBe(0);
  });
});

describe("baseline: bad fixture", () => {
  const ids = () => bad.findings.filter((f) => !f.suppressed).map((f) => f.ruleId);

  it("fails", () => {
    expect(bad.ok).toBe(false);
  });

  it("detects missing required file", () => {
    expect(ids()).toContain("structure/required-layout");
  });

  it("detects uninitialized template", () => {
    expect(ids().filter((i) => i === "claude-md/initialized")).toHaveLength(3);
  });

  it("detects missing contract headings", () => {
    expect(ids().filter((i) => i === "claude-md/contract-headings")).toHaveLength(4);
  });

  it("detects agent placeholder/gen comment", () => {
    expect(ids().filter((i) => i === "agents/no-template-placeholder")).toHaveLength(2);
  });

  it("detects frontmatter invalidated by leading comment", () => {
    expect(
      bad.findings.some(
        (f) =>
          f.ruleId === "agents/frontmatter" &&
          f.file?.includes("backend-engineer") &&
          f.message.includes("missing or invalid"),
      ),
    ).toBe(true);
  });

  it("detects agent missing tools", () => {
    expect(
      bad.findings.some(
        (f) =>
          f.ruleId === "agents/frontmatter" &&
          f.file?.includes("db-engineer") &&
          f.message.includes("tools"),
      ),
    ).toBe(true);
  });

  it("detects secret", () => {
    expect(ids()).toContain("security/no-secrets-in-context");
  });

  it("detects missing standards version", () => {
    expect(ids()).toContain("claude-md/standards-version");
  });
});

describe("exemptions", () => {
  it("active exemption suppresses / expired exemption surfaces as error", async () => {
    const withEx: PolicyDocument = {
      ...policy,
      exemptions: [
        {
          rule: "claude-md/initialized",
          reason: "移行中",
          expires: "2099-01-01",
          approved_by: "tech-lead",
        },
        {
          rule: "claude-md/thin-diff",
          reason: "期限切れテスト",
          expires: "2020-01-01",
          approved_by: "tech-lead",
        },
      ],
    };
    const ex = await runLint(withEx, badRoot);
    expect(ex.findings.some((f) => f.ruleId === "claude-md/initialized" && f.suppressed)).toBe(
      true,
    );
    expect(ex.findings.some((f) => f.message.includes("exemption expired"))).toBe(true);
  });
});

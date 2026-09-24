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
<type>/<issue番号>-<slug>(例: feature/142-preset-loader)
## PJ固有ルール
なし
<!-- standards: novexar/guardsmith v0.1.0 -->
`;

function buildGood(root: string) {
  write(root, "CLAUDE.md", GOOD_CLAUDE_MD);
  write(
    root,
    ".claude/agents/backend-engineer.md",
    "---\nname: backend-engineer\ndescription: API実装担当\nmodel: sonnet\ntools: Read, Write, Bash\n---\n作業フロー\n",
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
  // GuardSmith ランタイム成果物の除外(hygiene/guardsmith-artifacts-ignored の正例)
  write(root, ".gitignore", "node_modules/\n.guardsmith/\n.claude/settings.local.json\n");
  // deploy.yml 相当(push main のみ・テスト系ステップ無し)は ci/no-remote-test-workflows に検出されない
  write(
    root,
    ".github/workflows/deploy.yml",
    "name: Deploy\non:\n  push:\n    branches: [main]\njobs:\n  deploy:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo deploy placeholder\n",
  );
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
  // agent: frontmatterは正しいがtools欠落(frontmatterチェック単体の検証用)+ 日付付きmodel ID固定
  write(
    root,
    ".claude/agents/db-engineer.md",
    "---\nname: db-engineer\ndescription: DB担当\nmodel: claude-sonnet-5-20260101\n---\n作業フロー\n",
  );
  // シークレット混入 + 必須skill欠落
  write(root, ".claude/notes.md", 'api_key = "sk1234567890abcdefghij"\n');
  rmSync(join(root, ".claude/skills/finish-task"), { recursive: true });
  // リモートCI違反: pull_request トリガー + テストコマンド(ci/no-remote-test-workflows)
  write(
    root,
    ".github/workflows/test.yml",
    "name: Test\non:\n  pull_request:\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: pnpm test\n",
  );
  // GuardSmith ランタイム成果物の除外行が両方無い(hygiene/guardsmith-artifacts-ignored)
  write(root, ".gitignore", "node_modules/\ndist/\n");
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

describe("baseline: 収録ルール", () => {
  it("テスト58: 3-way 追随ルール drift/standards-sync を配布する", () => {
    const rule = policy.rules.find((r) => r.id === "drift/standards-sync");
    expect(rule?.check).toBe("drift3");
    expect(rule?.severity).toBe("warn");
    if (rule?.check !== "drift3") throw new Error("unreachable");
    expect(rule.with.source).toBe("github:novexar/guardsmith//standards@v0.7.0");
    expect(rule.with.paths).toEqual([
      "CLAUDE.md",
      "DESIGN.md",
      "docs/**/*.md",
      ".claude/agents/**/*.md",
    ]);
    // 節単位の skills ルールは据え置き(1 リリースで両方の意味を変えない)
    const skills = policy.rules.find((r) => r.id === "drift/skills-sync");
    expect(skills?.check).toBe("drift");
  });

  it("vars ファイルを secret-scan の対象に含める (R6)", () => {
    const rule = policy.rules.find((r) => r.id === "security/no-secrets-in-context");
    if (rule?.check !== "secret-scan") throw new Error("unreachable");
    expect(rule.with.paths).toContain("guardsmith.vars.yaml");
  });

  it("self preset は drift3 を持たない (R12: standards/ は配布マスター)", () => {
    const self = parsePolicy(parse(readFileSync(resolve(REPO_ROOT, "presets/self.yaml"), "utf8")));
    expect(self.ok, self.ok ? "" : self.errors.join("; ")).toBe(true);
    if (!self.ok) return;
    expect(self.policy.rules.some((r) => r.check === "drift3")).toBe(false);
  });
});

describe("baseline: good fixture", () => {
  it("passes", () => {
    expect(good.ok).toBe(true);
  });

  it("drift3 は github: source のまま info スキップされる(warn を増やさない)", () => {
    const hits = good.findings.filter((f) => f.ruleId === "drift/standards-sync");
    expect(hits).toHaveLength(1);
    expect(hits[0].severity).toBe("info");
    expect(hits[0].message).toContain("requires remote fetch");
  });

  it("has zero warn (drift/skills-sync is info-skipped until github: fetch)", () => {
    expect(good.stats.warn).toBe(0);
  });

  it("does not flag alias model (agents/no-pinned-model)", () => {
    expect(good.findings.filter((f) => f.ruleId === "agents/no-pinned-model")).toHaveLength(0);
  });

  it("does not flag deploy-only workflow (ci/no-remote-test-workflows)", () => {
    expect(good.findings.filter((f) => f.ruleId === "ci/no-remote-test-workflows")).toHaveLength(0);
  });

  it("does not flag .gitignore with both exclusion lines (hygiene/guardsmith-artifacts-ignored)", () => {
    expect(
      good.findings.filter((f) => f.ruleId === "hygiene/guardsmith-artifacts-ignored"),
    ).toHaveLength(0);
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

  it("detects pinned model id in agent", () => {
    expect(
      bad.findings.some(
        (f) => f.ruleId === "agents/no-pinned-model" && f.file?.includes("db-engineer"),
      ),
    ).toBe(true);
    expect(ids().filter((i) => i === "agents/no-pinned-model")).toHaveLength(1);
  });

  it("detects secret", () => {
    expect(ids()).toContain("security/no-secrets-in-context");
  });

  it("detects remote test workflow (pull_request trigger + test command)", () => {
    const hits = bad.findings.filter(
      (f) => f.ruleId === "ci/no-remote-test-workflows" && f.file?.includes("test.yml"),
    );
    // \bpull_request\b / pnpm test / npm test(pnpm test の部分一致)の3パターンが検出される
    // (deploy.yml 相当が検出されないことは good 側で検証)
    expect(hits).toHaveLength(3);
    expect(hits.every((f) => f.severity === "warn")).toBe(true);
  });

  it("detects missing standards version", () => {
    expect(ids()).toContain("claude-md/standards-version");
  });

  it("detects .gitignore missing both artifact exclusions (hygiene/guardsmith-artifacts-ignored)", () => {
    const hits = bad.findings.filter(
      (f) => f.ruleId === "hygiene/guardsmith-artifacts-ignored" && !f.suppressed,
    );
    // must の2パターン(.guardsmith/ と .claude/settings.local.json)がそれぞれ warn として検出される
    expect(hits).toHaveLength(2);
    expect(hits.every((f) => f.severity === "warn")).toBe(true);
  });
});

describe("hygiene/guardsmith-artifacts-ignored", () => {
  it("info-skips when .gitignore itself is absent (file-exists の責務)", async () => {
    const root = makeFixtureDir("gs-no-gitignore");
    try {
      const result = await runLint(policy, root);
      const hits = result.findings.filter(
        (f) => f.ruleId === "hygiene/guardsmith-artifacts-ignored",
      );
      expect(hits).toHaveLength(1);
      expect(hits[0].severity).toBe("info");
      expect(hits[0].message).toContain("content-match skipped");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("security/dangerous-permissions", () => {
  it("does not error on settings.json without a permissions key (guard new 配布物と同形)", async () => {
    const root = makeFixtureDir("gs-settings-noperm");
    try {
      write(
        root,
        ".claude/settings.json",
        JSON.stringify({
          $schema: "https://json.schemastore.org/claude-code-settings.json",
          extraKnownMarketplaces: {
            ponytail: { source: { source: "github", repo: "DietrichGebert/ponytail" } },
          },
          enabledPlugins: { "ponytail@ponytail": true },
        }),
      );
      const result = await runLint(policy, root);
      expect(result.findings.filter((f) => f.ruleId === "security/dangerous-permissions")).toEqual(
        [],
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
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

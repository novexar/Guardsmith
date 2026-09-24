/** マスター正規化 — gen コメント除去 / 警告ブロック / スタンプ / プレースホルダ描画 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createGlobScope, globFiles } from "../src/glob.js";
import {
  extractPlaceholderKeys,
  normalizeMaster,
  renderPlaceholders,
  rewriteStamp,
  stampFor,
  stripGenComments,
  stripUninitializedWarning,
} from "../src/normalize.js";
import { REPO_ROOT } from "./helpers.js";

/** drift3 のスコープ(presets/baseline.yaml の drift/standards-sync と同じ) */
const DRIFT3_PATHS = ["CLAUDE.md", "DESIGN.md", "docs/**/*.md", ".claude/agents/**/*.md"];

/**
 * §3.2 ゴールデン: gen コメント除去後に本文へ残るプレースホルダキー(ファイル別・昇順)。
 * standards/ を変更するとここが落ちる。落ちたら vars キー一覧の更新が必要という合図。
 */
const EXPECTED_KEYS: Readonly<Record<string, readonly string[]>> = {
  "CLAUDE.md": [
    "AUTH",
    "BE_DEV",
    "BE_DIR",
    "BE_INSTALL",
    "BE_LINT",
    "BE_STACK",
    "BE_TEST",
    "BRANCH_TREE",
    "DB",
    "FE_BUILD",
    "FE_DEV",
    "FE_DIR",
    "FE_INSTALL",
    "FE_LINT",
    "FE_STACK",
    "FE_TEST",
    "INFRA_SUMMARY",
    "ORG/REPO",
    "OWNER",
    "PROJECT_NAME",
    "PROJECT_SPECIFIC_RULES",
    "PURPOSE_ONE_LINE",
    "単一システム | モノレポ",
  ],
  "DESIGN.md": [
    "ACCENT_COLOR",
    "BODY_SIZE",
    "BREAKPOINTS",
    "BUTTON_STYLE",
    "CAPTION_SIZE",
    "CARD_STYLE",
    "CONTAINER_RULE",
    "DANGER_COLOR",
    "DISPLAY_SIZE",
    "HEADING_SIZE",
    "INPUT_STYLE",
    "NEUTRAL_BG",
    "NEUTRAL_BORDER",
    "NEUTRAL_FG",
    "PROJECT_NAME",
    "SUCCESS_COLOR",
    "VISUAL_THEME_DESCRIPTION",
    "WARNING_COLOR",
  ],
  "docs/AGENTS.md": [],
  "docs/ARCHITECTURE.md": [
    "ALTERNATIVES",
    "ARCHITECTURE_DIAGRAM",
    "AUTH_DESIGN",
    "COMPONENT",
    "DATA_FLOW",
    "DECISION",
    "DEPLOYMENT",
    "PROJECT_NAME",
    "REASON",
    "ROLE",
    "TECH",
  ],
  "docs/CI_CD.md": ["CICD_DIFFS", "PROJECT_NAME"],
  "docs/CODING_STANDARDS.md": [
    "BE_STACK",
    "BE_STANDARDS",
    "FE_STACK",
    "FE_STANDARDS",
    "PROJECT_NAME",
  ],
  "docs/DEVELOPMENT_WORKFLOW.md": ["PROJECT_NAME", "WORKFLOW_DIFFS"],
  "docs/FRONTEND_STANDARDS.md": [],
  "docs/REQUIREMENTS.md": [
    "ACCEPTANCE_CRITERIA",
    "AVAILABILITY",
    "BACKGROUND",
    "CONSTRAINTS",
    "COST",
    "DESC",
    "FEATURE_NAME",
    "IN_SCOPE",
    "OPERATIONS",
    "OUT_OF_SCOPE",
    "PERFORMANCE",
    "PROJECT_NAME",
    "ROLE",
    "SECURITY",
    "SUMMARY",
  ],
  "docs/SETUP.md": ["PROJECT_NAME", "SETUP_PROJECT_SPECIFIC"],
  ".claude/agents/backend-engineer.md": [
    "BASE_BRANCH",
    "BE_PROJECT_RULES",
    "BE_QUALITY_GATE_CMD",
    "BE_STACK_DETAIL",
    "BE_STACK_SHORT",
    "BE_TEST_RUNNER",
    "PROJECT_NAME",
  ],
  ".claude/agents/db-engineer.md": [
    "BASE_BRANCH",
    "DB_APPLY_CMD",
    "DB_FOCUS",
    "DB_SCHEMA_DOC",
    "DB_STACK_DETAIL",
    "DB_STACK_PRINCIPLES",
    "DB_STACK_SHORT",
    "DB_VERIFICATION",
    "MIGRATIONS_PATH",
    "MIGRATION_NAMING",
    "PROJECT_NAME",
  ],
  ".claude/agents/frontend-engineer.md": [
    "BASE_BRANCH",
    "FE_PROJECT_RULES",
    "FE_QUALITY_GATE_CMD",
    "FE_STACK_DETAIL",
    "FE_STACK_SHORT",
    "FE_TEST_RUNNER",
    "PROJECT_NAME",
  ],
  ".claude/agents/qa-engineer.md": ["E2E_TOOL", "ISSUE_LABELS", "PROJECT_NAME", "TEST_COMMANDS"],
};

/**
 * 対応する `<!--` を持たない `-->` が残っていないか。
 * gen コメントを途中で切ってしまうと、バナーの後半が本文へ漏れて必ずここに現れる。
 */
function hasDanglingCommentClose(text: string): boolean {
  let from = 0;
  for (;;) {
    const close = text.indexOf("-->", from);
    if (close < 0) return false;
    if (text.lastIndexOf("<!--", close) < from) return true;
    from = close + 3;
  }
}

async function standardsScopeFiles(): Promise<string[]> {
  const root = join(REPO_ROOT, "standards");
  // マスターは配布物そのもの。除外は .git のみ(= sync.ts と同じ扱い)
  const scope = await createGlobScope(root, { gitignore: false });
  return (await globFiles(scope, DRIFT3_PATHS)).sort();
}

describe("stripGenComments", () => {
  // 1
  it("removes a multi-line gen banner", () => {
    const text = [
      "<!-- ============================================================",
      "  gen: 生成規約(init-project 実行時に必読):",
      "  1. {{PLACEHOLDER}} を全て置換する。",
      "============================================================ -->",
      "# 本文",
      "",
    ].join("\n");
    expect(stripGenComments(text)).toBe("# 本文\n");
  });

  // 2
  it("removes a single-line gen comment together with its newline", () => {
    const text = "## 技術スタック\n<!-- gen: 採用しない層は行ごと削除 -->\n| 層 | 採用技術 |\n";
    expect(stripGenComments(text)).toBe("## 技術スタック\n| 層 | 採用技術 |\n");
  });

  // 3
  it("removes a gen comment that spans exactly two lines (docs/CI_CD.md shape)", () => {
    const text = [
      "# CI/CD 運用 — {{PROJECT_NAME}}",
      "",
      "<!-- gen: 本ファイルは Novexar 標準の CI/CD 方針。init-project で {{PROJECT_NAME}} を置換し、",
      "     「PJ 固有の運用差分」節のみ PJ に合わせて追記する。方針そのものの緩和・削除は禁止。 -->",
      "",
      "## 方針(Novexar 標準)",
      "",
    ].join("\n");
    expect(stripGenComments(text)).toBe(
      "# CI/CD 運用 — {{PROJECT_NAME}}\n\n\n## 方針(Novexar 標準)\n",
    );
  });

  // 4
  it("keeps HTML comments that do not carry a gen: directive", () => {
    const issueTemplate = [
      "<!--",
      "  固定見出し「## 背景」は外部ツールがパースする契約。改名禁止。",
      "-->",
      "",
    ].join("\n");
    const designSource =
      "<!--\n  出典: awesome-design-md-jp (MIT License) の template/DESIGN.md\n-->\n";
    expect(stripGenComments(issueTemplate)).toBe(issueTemplate);
    expect(stripGenComments(designSource)).toBe(designSource);
  });

  it("keeps a mixed document's non-gen comment while dropping the gen one", () => {
    const text = "<!-- keep me -->\n<!-- gen: drop me -->\nbody\n";
    expect(stripGenComments(text)).toBe("<!-- keep me -->\nbody\n");
  });

  it("collapses runs of three or more blank lines down to two", () => {
    const text = "a\n\n<!-- gen: x -->\n\n\n\nb\n";
    expect(stripGenComments(text)).toBe("a\n\n\nb\n");
  });

  it("leaves an unterminated comment untouched", () => {
    const text = "a\n<!-- gen: never closed\nb\n";
    expect(stripGenComments(text)).toBe(text);
  });

  // 回帰: standards/CLAUDE.md の生成規約バナーは gen コメントの書式自体を引用している。
  // 引用された `-->` を終端と誤認するとバナー後半が本文へ漏れ出す。
  it("does not treat a --> quoted inside a code span as the comment close", () => {
    const text = [
      "<!-- ============================================================",
      "  gen: 生成規約:",
      "  2. `<!-- gen: ... -->` コメントは生成指示。完成版からは削除する。",
      "  5. 末尾の standards バージョンコメントは維持する。",
      "============================================================ -->",
      "# 本文",
      "",
    ].join("\n");
    expect(stripGenComments(text)).toBe("# 本文\n");
  });

  it("still closes at a --> that merely follows a closed code span", () => {
    const text = "<!-- gen: `code` -->\n# 本文\n";
    expect(stripGenComments(text)).toBe("# 本文\n");
  });
});

describe("stripUninitializedWarning", () => {
  // 5
  it("removes the warning quote block and keeps the body that follows", () => {
    const text = [
      "> **⚠️ 未初期化テンプレート**",
      "> 本ファイルに `{{` プレースホルダが残っている間、未初期化です。",
      "> (この警告ブロックは初期化完了時に削除する)",
      "",
      "# CLAUDE.md — {{PROJECT_NAME}}",
      "",
    ].join("\n");
    expect(stripUninitializedWarning(text)).toBe("# CLAUDE.md — {{PROJECT_NAME}}\n");
  });

  it("is a no-op when the warning is absent", () => {
    expect(stripUninitializedWarning("# title\n")).toBe("# title\n");
  });
});

describe("rewriteStamp", () => {
  // 6
  it("rewrites the stamp to the target owner/repo and tag", () => {
    const text = "body\n\n<!-- standards: novexar/claude-standards v0.1.0 -->\n";
    expect(rewriteStamp(text, stampFor("v0.6.0"))).toBe(
      "body\n\n<!-- standards: novexar/guardsmith v0.6.0 -->\n",
    );
  });

  it("leaves text without a stamp unchanged", () => {
    expect(rewriteStamp("no stamp here\n", stampFor("v0.6.0"))).toBe("no stamp here\n");
  });
});

describe("renderPlaceholders", () => {
  // 7
  it("renders keys containing slashes, pipes and Japanese", () => {
    const text = "- **リポジトリ**: {{ORG/REPO}}({{単一システム | モノレポ}})\n";
    const res = renderPlaceholders(text, {
      "ORG/REPO": "novexar/acme",
      "単一システム | モノレポ": "モノレポ",
    });
    expect(res.text).toBe("- **リポジトリ**: novexar/acme(モノレポ)\n");
    expect(res.unresolved).toEqual([]);
  });

  it("trims whitespace inside the token before lookup", () => {
    expect(renderPlaceholders("{{ PROJECT_NAME }}", { PROJECT_NAME: "Acme" }).text).toBe("Acme");
  });

  // 8
  it("keeps unknown keys literal and reports them once in order", () => {
    const res = renderPlaceholders("{{B}} {{A}} {{B}}", { C: "c" });
    expect(res.text).toBe("{{B}} {{A}} {{B}}");
    expect(res.unresolved).toEqual(["B", "A"]);
  });

  it("renders a key whose value is an empty string", () => {
    const res = renderPlaceholders("[{{X}}]", { X: "" });
    expect(res.text).toBe("[]");
    expect(res.unresolved).toEqual([]);
  });
});

describe("normalizeMaster", () => {
  it("applies the full pipeline in order (EOL, gen, warning, stamp, render)", () => {
    const raw = [
      "> **⚠️ 未初期化テンプレート**",
      "> 初期化してください。",
      "",
      "<!-- gen: {{PROJECT_NAME}} をインタビュー結果で置換する -->",
      "# CLAUDE.md — {{PROJECT_NAME}}",
      "",
      "<!-- standards: novexar/claude-standards v0.1.0 -->",
      "",
    ].join("\r\n");
    const res = normalizeMaster(raw, {
      vars: { PROJECT_NAME: "Acme" },
      stamp: stampFor("v0.5.1"),
    });
    expect(res.text).toBe("# CLAUDE.md — Acme\n\n<!-- standards: novexar/guardsmith v0.5.1 -->\n");
    expect(res.unresolved).toEqual([]);
  });

  it("leaves the stamp alone when no stamp option is given", () => {
    const res = normalizeMaster("<!-- standards: novexar/guardsmith v0.1.0 -->\n", { vars: {} });
    expect(res.text).toBe("<!-- standards: novexar/guardsmith v0.1.0 -->\n");
  });
});

describe("standards/ ゴールデン", () => {
  // 10
  it("exposes exactly the expected placeholder keys per file after gen removal", async () => {
    const files = await standardsScopeFiles();
    expect(files).toEqual(Object.keys(EXPECTED_KEYS).sort());

    const actual: Record<string, string[]> = {};
    for (const file of files) {
      const raw = readFileSync(join(REPO_ROOT, "standards", file), "utf8");
      const stripped = stripGenComments(raw.replaceAll("\r\n", "\n"));
      actual[file] = extractPlaceholderKeys(stripped).sort();
    }
    const expected = Object.fromEntries(
      Object.entries(EXPECTED_KEYS).map(([k, v]) => [k, [...v].sort()]),
    );
    expect(actual).toEqual(expected);
  });

  // 9
  it("renders every remaining placeholder once the golden key set is supplied as vars", async () => {
    const vars = Object.fromEntries(
      [...new Set(Object.values(EXPECTED_KEYS).flat())].map((k) => [k, `<${k}>`]),
    );
    expect(Object.keys(vars)).toHaveLength(91);

    for (const file of await standardsScopeFiles()) {
      const raw = readFileSync(join(REPO_ROOT, "standards", file), "utf8");
      const res = normalizeMaster(raw, { vars, stamp: stampFor("v0.6.0") });
      expect(res.unresolved, `${file} has unexpected placeholders`).toEqual([]);
      expect(res.text, `${file} still contains a placeholder`).not.toMatch(/\{\{|<!-- gen:/);
      // キー集合だけでは gen バナーの切り損ね(本文への漏れ出し)を検知できない
      expect(hasDanglingCommentClose(res.text), `${file} leaked a gen comment tail`).toBe(false);
    }
  });

  // 回帰: 生成規約バナーが丸ごと消え、本文が見出しから始まること
  it("normalizes standards/CLAUDE.md down to its body with no banner residue", () => {
    const raw = readFileSync(join(REPO_ROOT, "standards", "CLAUDE.md"), "utf8");
    const res = normalizeMaster(raw, {
      vars: { PROJECT_NAME: "Acme" },
      stamp: stampFor("v0.6.0"),
    });
    expect(res.text.startsWith("# CLAUDE.md — Acme\n")).toBe(true);
    expect(res.text).not.toContain("生成規約");
    expect(res.text).not.toContain("============");
    expect(res.text).not.toContain("未初期化テンプレート");
    expect(res.text.trimEnd().endsWith("<!-- standards: novexar/guardsmith v0.6.0 -->")).toBe(true);
  });
});

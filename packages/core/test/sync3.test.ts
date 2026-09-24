/**
 * standards 3-way 取り込みのゴールデンテスト。
 *
 * 構成: masterOld(v0.5.1 相当)→ masterNew(v0.6.0 相当)を、masterOld を vars で
 * 具体化した PJ(init-project 相当 + PJ 固有の追記)へ適用する。
 * PJ 値が全て残り、標準変更が全て入り、意図的に改変した節だけが衝突することを固定する。
 */
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { applySync3, formatSync3Plan, planSync3, type Drift3Source } from "../src/sync3.js";
import { loadVars, writeVars, type VarsDocument } from "../src/vars.js";
import { makeFixtureDir, write } from "./helpers.js";

/* ---------- マスター(旧) ---------- */

const OLD_CLAUDE = `> **⚠️ 未初期化テンプレート**
> 本ファイルに \`{{\` プレースホルダが残っている間、このリポジトリは未初期化です。
> (この警告ブロックは初期化完了時に削除する)

<!-- ============================================================
  gen: 生成規約(init-project 実行時に必読):
  1. {{PLACEHOLDER}} を全てインタビュー結果で置換する。
============================================================ -->
# CLAUDE.md — {{PROJECT_NAME}}

## プロジェクト概要
<!-- gen: オーナー・目的・リポジトリを各1行で -->
- **オーナー**: {{OWNER}}
- **リポジトリ**: {{ORG/REPO}}({{単一システム | モノレポ}})
- **目的**: {{PURPOSE_ONE_LINE}}

## ブランチ戦略

main ← リリースライン

## PJ固有ルール

(ここに追記)

<!-- standards: novexar/guardsmith v0.5.1 -->
`;

const OLD_DESIGN = `# デザイン — {{PROJECT_NAME}}

## カラー

- アクセント: {{ACCENT_COLOR}}

## タイポグラフィ

- 本文: 16px
`;

// 2 行にまたがる gen コメント(standards/docs/CI_CD.md と同じ形)
const OLD_CICD = `# CI/CD 運用 — {{PROJECT_NAME}}

<!-- gen: 本ファイルは Novexar 標準の CI/CD 方針。init-project で {{PROJECT_NAME}} を置換し、
     「PJ 固有の運用差分」節のみ PJ に合わせて追記する。 -->

## 方針

ローカル Docker で CI を実行する。

## PJ 固有の運用差分

{{CICD_DIFFS}}
`;

const OLD_AGENT = `---
name: backend-engineer
description: {{PROJECT_NAME}} のバックエンド担当
---

あなたは {{PROJECT_NAME}} のバックエンドエンジニアです。

## 品質ゲート

{{BE_QUALITY_GATE_CMD}}
`;

const OLD_LEGACY = `# 旧ドキュメント — {{PROJECT_NAME}}

将来 docs/SETUP.md へ統合する。
`;

/* ---------- マスター(新) ---------- */

const NEW_CLAUDE = OLD_CLAUDE.replace(
  "## ブランチ戦略",
  "## セキュリティ\n\n- 秘密情報はコミットしない\n\n## ブランチ戦略",
)
  .replace("main ← リリースライン", "main ← リリースライン(タグ vX.Y.Z で配布)")
  .replace("v0.5.1 -->", "v0.6.0 -->");

const NEW_DESIGN = OLD_DESIGN.replace("- 本文: 16px", "- 本文: 15px");
const NEW_CICD = OLD_CICD.replace(
  "ローカル Docker で CI を実行する。",
  "ローカル Docker で CI を実行し、main への push のみ Actions を使う。",
);
const NEW_AGENT = OLD_AGENT.replace(
  "## 品質ゲート",
  "## 禁止事項\n\n- 直接 push 禁止\n\n## 品質ゲート",
);
const NEW_SETUP = `# セットアップ — {{PROJECT_NAME}}

1. pnpm install
`;

/* ---------- PJ(masterOld を vars で具体化したもの) ---------- */

const PROJ_CLAUDE = `# CLAUDE.md — Acme Portal

## プロジェクト概要
- **オーナー**: Novexar
- **リポジトリ**: novexar/acme(モノレポ)
- **目的**: 社内ポータルの刷新

## ブランチ戦略

main ← リリースライン

## PJ固有ルール

- PJ 固有: デプロイ前に必ず承認を取る

<!-- standards: novexar/guardsmith v0.5.1 -->
`;

const EXPECTED_CLAUDE = `# CLAUDE.md — Acme Portal

## プロジェクト概要
- **オーナー**: Novexar
- **リポジトリ**: novexar/acme(モノレポ)
- **目的**: 社内ポータルの刷新

## セキュリティ

- 秘密情報はコミットしない

## ブランチ戦略

main ← リリースライン(タグ vX.Y.Z で配布)

## PJ固有ルール

- PJ 固有: デプロイ前に必ず承認を取る

<!-- standards: novexar/guardsmith v0.6.0 -->
`;

const PROJ_DESIGN = `# デザイン — Acme Portal

## カラー

- アクセント: #3366ff

## タイポグラフィ

- 本文: 16px
`;

const PROJ_DESIGN_EDITED = PROJ_DESIGN.replace("- 本文: 16px", "- 本文: 14px(PJ 指定)");

// gen コメント除去で空行が 2 連続になるのは正規化の正しい結果(normalize テスト 3 と同じ)
const PROJ_CICD = `# CI/CD 運用 — Acme Portal


## 方針

ローカル Docker で CI を実行する。

## PJ 固有の運用差分

- 日次ビルドは JST 03:00
`;

const EXPECTED_CICD = PROJ_CICD.replace(
  "ローカル Docker で CI を実行する。",
  "ローカル Docker で CI を実行し、main への push のみ Actions を使う。",
);

const PROJ_LEGACY = `# 旧ドキュメント — Acme Portal

将来 docs/SETUP.md へ統合する。
`;

const PROJ_ONLY = `# PJ 固有メモ

触ってはいけない。
`;

const DRIFT3_PATHS = ["CLAUDE.md", "DESIGN.md", "docs/**/*.md", ".claude/agents/**/*.md"];

// CICD_DIFFS は意図的に未登録 → unresolvedVars に載るが sync は成功する(U6)
const VARS: VarsDocument = {
  version: 1,
  standards: "v0.5.1",
  vars: {
    PROJECT_NAME: "Acme Portal",
    OWNER: "Novexar",
    "ORG/REPO": "novexar/acme",
    "単一システム | モノレポ": "モノレポ",
    PURPOSE_ONE_LINE: "社内ポータルの刷新",
    ACCENT_COLOR: "#3366ff",
    BE_QUALITY_GATE_CMD: "pnpm ci",
  },
};

const dirs: string[] = [];
function fixtureDir(prefix: string): string {
  const d = makeFixtureDir(prefix);
  dirs.push(d);
  return d;
}
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function buildMasters(): { oldRoot: string; newRoot: string } {
  const oldRoot = fixtureDir("gs-sync3-old");
  write(oldRoot, "CLAUDE.md", OLD_CLAUDE);
  write(oldRoot, "DESIGN.md", OLD_DESIGN);
  write(oldRoot, "docs/CI_CD.md", OLD_CICD);
  write(oldRoot, "docs/LEGACY.md", OLD_LEGACY);
  write(oldRoot, ".claude/agents/backend-engineer.md", OLD_AGENT);

  const newRoot = fixtureDir("gs-sync3-new");
  write(newRoot, "CLAUDE.md", NEW_CLAUDE);
  write(newRoot, "DESIGN.md", NEW_DESIGN);
  write(newRoot, "docs/CI_CD.md", NEW_CICD);
  write(newRoot, "docs/SETUP.md", NEW_SETUP);
  write(newRoot, ".claude/agents/backend-engineer.md", NEW_AGENT);
  return { oldRoot, newRoot };
}

interface ProjectOptions {
  /** DESIGN.md を標準と同じ箇所で改変する(= 衝突させる) */
  conflict?: boolean;
  /** CLAUDE.md を置くか(false = スタンプ fallback の検証用に別構成を使う) */
  claudeMd?: boolean;
}

function buildProject(opts: ProjectOptions = {}): string {
  const proj = fixtureDir("gs-sync3-proj");
  if (opts.claudeMd !== false) write(proj, "CLAUDE.md", PROJ_CLAUDE);
  write(proj, "DESIGN.md", opts.conflict === true ? PROJ_DESIGN_EDITED : PROJ_DESIGN);
  write(proj, "docs/CI_CD.md", PROJ_CICD);
  write(proj, "docs/LEGACY.md", PROJ_LEGACY);
  write(proj, "docs/PJ_ONLY.md", PROJ_ONLY);
  // .claude/agents/backend-engineer.md は PJ が不要として削除済み
  writeVars(proj, VARS);
  return proj;
}

function sources(oldRoot: string, newRoot: string, paths: string[] = DRIFT3_PATHS): Drift3Source[] {
  return [
    {
      ruleId: "drift/standards-sync",
      paths,
      baseRoot: oldRoot,
      headRoot: newRoot,
      baseTag: "v0.5.1",
      headTag: "v0.6.0",
    },
  ];
}

function kindOf(plan: Awaited<ReturnType<typeof planSync3>>, file: string): string | undefined {
  return plan.actions.find((a) => a.file === file)?.kind;
}

describe("planSync3 / applySync3", () => {
  // 23
  it("keeps every project value and takes in every standards change", async () => {
    const { oldRoot, newRoot } = buildMasters();
    const proj = buildProject();
    const plan = await planSync3(sources(oldRoot, newRoot), proj, VARS);

    expect(plan.baseTag).toBe("v0.5.1");
    expect(plan.nextTag).toBe("v0.6.0");
    expect(plan.conflicted).toEqual([]);
    expect(kindOf(plan, "CLAUDE.md")).toBe("merge");
    expect(plan.actions.find((a) => a.file === "CLAUDE.md")?.content).toBe(EXPECTED_CLAUDE);

    applySync3(plan, proj, VARS);
    expect(readFileSync(join(proj, "CLAUDE.md"), "utf8")).toBe(EXPECTED_CLAUDE);
    expect(readFileSync(join(proj, "docs/CI_CD.md"), "utf8")).toBe(EXPECTED_CICD);
    expect(readFileSync(join(proj, "DESIGN.md"), "utf8")).toBe(
      PROJ_DESIGN.replace("- 本文: 16px", "- 本文: 15px"),
    );
  });

  // 24
  it("conflicts only on the section the project deliberately changed", async () => {
    const { oldRoot, newRoot } = buildMasters();
    const proj = buildProject({ conflict: true });
    const plan = await planSync3(sources(oldRoot, newRoot), proj, VARS);

    expect(plan.conflicted).toEqual(["DESIGN.md"]);
    const design = plan.actions.find((a) => a.file === "DESIGN.md");
    expect(design?.conflicts).toHaveLength(1);
    expect(design?.conflicts[0].ours).toEqual(["- 本文: 14px(PJ 指定)"]);
    expect(design?.conflicts[0].theirs).toEqual(["- 本文: 15px"]);
    expect(design?.content).toBeUndefined();
    expect(kindOf(plan, "CLAUDE.md")).toBe("merge");
    expect(kindOf(plan, "docs/CI_CD.md")).toBe("merge");
  });

  // 25
  it("creates a file that only exists in the new master", async () => {
    const { oldRoot, newRoot } = buildMasters();
    const proj = buildProject();
    const plan = await planSync3(sources(oldRoot, newRoot), proj, VARS);
    expect(kindOf(plan, "docs/SETUP.md")).toBe("create");

    applySync3(plan, proj, VARS);
    expect(readFileSync(join(proj, "docs/SETUP.md"), "utf8")).toBe(
      "# セットアップ — Acme Portal\n\n1. pnpm install\n",
    );
  });

  // 26
  it("skips a file the project deleted instead of re-creating it", async () => {
    const { oldRoot, newRoot } = buildMasters();
    const proj = buildProject();
    const plan = await planSync3(sources(oldRoot, newRoot), proj, VARS);

    expect(kindOf(plan, ".claude/agents/backend-engineer.md")).toBe("skip-deleted");
    applySync3(plan, proj, VARS);
    expect(existsSync(join(proj, ".claude/agents/backend-engineer.md"))).toBe(false);
    expect(formatSync3Plan(plan, true)).toContain("SKIP     .claude/agents/backend-engineer.md");
  });

  // 27
  it("reports a file dropped from the master but never deletes it", async () => {
    const { oldRoot, newRoot } = buildMasters();
    const proj = buildProject();
    const plan = await planSync3(sources(oldRoot, newRoot), proj, VARS);

    expect(kindOf(plan, "docs/LEGACY.md")).toBe("removed");
    applySync3(plan, proj, VARS);
    expect(readFileSync(join(proj, "docs/LEGACY.md"), "utf8")).toBe(PROJ_LEGACY);
    expect(formatSync3Plan(plan, true)).toContain("REMOVED  docs/LEGACY.md");
  });

  // 28
  it("writes nothing at all when any file conflicts", async () => {
    const { oldRoot, newRoot } = buildMasters();
    const proj = buildProject({ conflict: true });
    const plan = await planSync3(sources(oldRoot, newRoot), proj, VARS);
    applySync3(plan, proj, VARS);

    expect(plan.conflicted).toHaveLength(1);
    expect(readFileSync(join(proj, "CLAUDE.md"), "utf8")).toBe(PROJ_CLAUDE);
    expect(readFileSync(join(proj, "DESIGN.md"), "utf8")).toBe(PROJ_DESIGN_EDITED);
    expect(readFileSync(join(proj, "docs/CI_CD.md"), "utf8")).toBe(PROJ_CICD);
    expect(existsSync(join(proj, "docs/SETUP.md"))).toBe(false);
    expect(loadVars(proj)?.standards).toBe("v0.5.1");
  });

  // 29
  it("writes conflict markers only when conflictMarkers is set", async () => {
    const { oldRoot, newRoot } = buildMasters();
    const proj = buildProject({ conflict: true });
    const plan = await planSync3(sources(oldRoot, newRoot), proj, VARS, {
      conflictMarkers: true,
    });
    applySync3(plan, proj, VARS);

    const design = readFileSync(join(proj, "DESIGN.md"), "utf8");
    expect(design).toContain("<<<<<<< ours (project)");
    expect(design).toContain("||||||| base (standards v0.5.1)");
    expect(design).toContain(">>>>>>> theirs (standards v0.6.0)");
    // 衝突が残っている以上、基準タグは進めない
    expect(plan.conflicted).toEqual(["DESIGN.md"]);
    expect(loadVars(proj)?.standards).toBe("v0.5.1");
  });

  // 30
  it("advances vars.standards and the CLAUDE.md stamp after a clean apply", async () => {
    const { oldRoot, newRoot } = buildMasters();
    const proj = buildProject();
    applySync3(await planSync3(sources(oldRoot, newRoot), proj, VARS), proj, VARS);

    expect(loadVars(proj)?.standards).toBe("v0.6.0");
    expect(loadVars(proj)?.vars).toEqual(VARS.vars);
    expect(readFileSync(join(proj, "CLAUDE.md"), "utf8")).toContain(
      "<!-- standards: novexar/guardsmith v0.6.0 -->",
    );
  });

  // 31
  it("appends the stamp when the project had removed it", async () => {
    const { oldRoot, newRoot } = buildMasters();
    // スタンプ行を消した CLAUDE.md は drift3 のスコープ外(PJ が paths を絞った構成)。
    // スコープ内なら「ours が削除 / theirs が変更」で衝突するため、fallback は届かない。
    const proj = buildProject({ claudeMd: false });
    write(proj, "CLAUDE.md", "# CLAUDE.md — Acme Portal\n\n本文だけでスタンプが無い。\n");
    const plan = await planSync3(sources(oldRoot, newRoot, ["docs/**/*.md"]), proj, VARS);
    applySync3(plan, proj, VARS);

    expect(readFileSync(join(proj, "CLAUDE.md"), "utf8")).toBe(
      "# CLAUDE.md — Acme Portal\n\n本文だけでスタンプが無い。\n\n" +
        "<!-- standards: novexar/guardsmith v0.6.0 -->\n",
    );
  });

  // 32
  it("is idempotent: a second plan has nothing left to write", async () => {
    const { oldRoot, newRoot } = buildMasters();
    const proj = buildProject();
    applySync3(await planSync3(sources(oldRoot, newRoot), proj, VARS), proj, VARS);

    const again = await planSync3(sources(oldRoot, newRoot), proj, loadVars(proj)!);
    expect(again.conflicted).toEqual([]);
    expect(again.actions.filter((a) => a.kind === "merge" || a.kind === "create")).toEqual([]);
    expect(kindOf(again, "CLAUDE.md")).toBe("unchanged");
    expect(kindOf(again, "DESIGN.md")).toBe("unchanged");
    expect(kindOf(again, "docs/CI_CD.md")).toBe("unchanged");
    expect(kindOf(again, "docs/SETUP.md")).toBe("unchanged");
    expect(formatSync3Plan(again, false)).toContain("already in sync");
  });

  // 33
  it("succeeds with unresolved vars and reports them as info", async () => {
    const { oldRoot, newRoot } = buildMasters();
    const proj = buildProject();
    const plan = await planSync3(sources(oldRoot, newRoot), proj, VARS);

    const cicd = plan.actions.find((a) => a.file === "docs/CI_CD.md");
    expect(cicd?.kind).toBe("merge");
    expect(cicd?.unresolvedVars).toEqual(["CICD_DIFFS"]);
    expect(formatSync3Plan(plan, false)).toContain("unresolved vars: CICD_DIFFS");
    // 未解決キーがあっても PJ の実値は失われない
    expect(cicd?.content).toContain("- 日次ビルドは JST 03:00");
  });

  // 34
  it("never touches project-local files that the master does not know", async () => {
    const { oldRoot, newRoot } = buildMasters();
    const proj = buildProject();
    const plan = await planSync3(sources(oldRoot, newRoot), proj, VARS);

    expect(plan.localOnly).toEqual(["docs/PJ_ONLY.md"]);
    expect(plan.actions.some((a) => a.file === "docs/PJ_ONLY.md")).toBe(false);
    applySync3(plan, proj, VARS);
    expect(readFileSync(join(proj, "docs/PJ_ONLY.md"), "utf8")).toBe(PROJ_ONLY);
    expect(formatSync3Plan(plan, true)).toContain("KEEP     docs/PJ_ONLY.md");
  });

  it("summarises the plan with the tag transition and counts", async () => {
    const { oldRoot, newRoot } = buildMasters();
    const plan = await planSync3(sources(oldRoot, newRoot), buildProject(), VARS);
    const text = formatSync3Plan(plan, false);
    expect(text).toContain("standards v0.5.1 → v0.6.0");
    expect(text).toContain("MERGE    CLAUDE.md");
    expect(text).toContain("CREATE   docs/SETUP.md");
    expect(text).toContain("dry-run (use --write to apply)");
  });

  it("reports conflicts in the summary instead of claiming success", async () => {
    const { oldRoot, newRoot } = buildMasters();
    const plan = await planSync3(sources(oldRoot, newRoot), buildProject({ conflict: true }), VARS);
    const text = formatSync3Plan(plan, true);
    expect(text).toContain("CONFLICT DESIGN.md — 1 region(s) at line");
    expect(text).toContain("conflicts must be resolved manually");
  });

  it("falls back to the vars tag when no source is given", async () => {
    const plan = await planSync3([], buildProject(), VARS);
    expect(plan).toMatchObject({
      actions: [],
      localOnly: [],
      baseTag: "v0.5.1",
      nextTag: "v0.5.1",
    });
  });

  it("treats a non-markdown master change as a conflict and flags template syntax", async () => {
    const oldRoot = fixtureDir("gs-sync3-raw-old");
    const newRoot = fixtureDir("gs-sync3-raw-new");
    write(oldRoot, "docs/logo.svg", "<svg>{{PROJECT_NAME}}</svg>\n");
    write(newRoot, "docs/logo.svg", "<svg>{{PROJECT_NAME}} v2</svg>\n");
    const proj = fixtureDir("gs-sync3-raw-proj");
    write(proj, "docs/logo.svg", "<svg>Acme Portal</svg>\n");
    writeVars(proj, VARS);

    const plan = await planSync3(sources(oldRoot, newRoot, ["docs/**"]), proj, VARS);
    const action = plan.actions.find((a) => a.file === "docs/logo.svg");
    expect(action?.kind).toBe("conflict");
    expect(action?.note).toBe("binary/non-markdown master changed");
    applySync3(plan, proj, VARS);
    expect(readFileSync(join(proj, "docs/logo.svg"), "utf8")).toBe("<svg>Acme Portal</svg>\n");
  });

  it("conflicts when the master adds a file the project already owns", async () => {
    const oldRoot = fixtureDir("gs-sync3-add-old");
    const newRoot = fixtureDir("gs-sync3-add-new");
    write(oldRoot, "docs/KEEP.md", "# keep\n");
    write(newRoot, "docs/KEEP.md", "# keep\n");
    write(newRoot, "docs/NEW.md", "# 標準の新規文書 — {{PROJECT_NAME}}\n");
    const proj = fixtureDir("gs-sync3-add-proj");
    write(proj, "docs/KEEP.md", "# keep\n");
    write(proj, "docs/NEW.md", "# PJ が先に作っていた文書\n");
    writeVars(proj, VARS);

    const plan = await planSync3(sources(oldRoot, newRoot, ["docs/**/*.md"]), proj, VARS);
    expect(kindOf(plan, "docs/NEW.md")).toBe("conflict");
    expect(plan.conflicted).toEqual(["docs/NEW.md"]);
  });

  it("treats an identical pre-existing file as unchanged rather than a conflict", async () => {
    const oldRoot = fixtureDir("gs-sync3-same-old");
    const newRoot = fixtureDir("gs-sync3-same-new");
    write(oldRoot, "docs/KEEP.md", "# keep\n");
    write(newRoot, "docs/KEEP.md", "# keep\n");
    write(newRoot, "docs/NEW.md", "# 標準 — {{PROJECT_NAME}}\n");
    const proj = fixtureDir("gs-sync3-same-proj");
    write(proj, "docs/KEEP.md", "# keep\n");
    write(proj, "docs/NEW.md", "# 標準 — Acme Portal\n");
    writeVars(proj, VARS);

    const plan = await planSync3(sources(oldRoot, newRoot, ["docs/**/*.md"]), proj, VARS);
    expect(kindOf(plan, "docs/NEW.md")).toBe("unchanged");
    expect(plan.conflicted).toEqual([]);
  });
});

/**
 * check: drift3 — 「標準の変更が未適用」の検出(計画 §5 テスト 35〜39)。
 * 全て file: ソースでネットワーク非依存。
 */
import { rmSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { runLint, type Finding } from "../src/lint.js";
import { normalizeMaster, stampFor } from "../src/normalize.js";
import type { PolicyDocument, Rule } from "../src/schema.js";
import type { Drift3Source } from "../src/sync3.js";
import { writeVars, type VarsDocument } from "../src/vars.js";
import { makeFixtureDir, write } from "./helpers.js";

const RULE_ID = "drift/standards-sync";
const PATHS = ["CLAUDE.md", "DESIGN.md", "docs/**/*.md"];

const OLD_CLAUDE = `# CLAUDE.md — {{PROJECT_NAME}}

## プロジェクト概要
<!-- gen: オーナーを1行で -->
- **オーナー**: {{OWNER}}

## ブランチ戦略

main ← リリースライン

## PJ固有ルール

(ここに追記)

<!-- standards: novexar/guardsmith v0.6.0 -->
`;

const NEW_CLAUDE = OLD_CLAUDE.replace(
  "## ブランチ戦略",
  "## セキュリティ\n\n- 秘密情報はコミットしない\n\n## ブランチ戦略",
);

const OLD_DESIGN = `# デザイン — {{PROJECT_NAME}}

## タイポグラフィ

- 本文: 16px
`;

const NEW_DESIGN = OLD_DESIGN.replace("- 本文: 16px", "- 本文: 15px");

const VARS: VarsDocument = {
  version: 1,
  standards: "v0.6.0",
  vars: { PROJECT_NAME: "Acme Portal", OWNER: "Novexar" },
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

/** マスターを PJ に具体化した状態(init-project 相当)を作る */
function concretize(master: string, tag: string): string {
  return normalizeMaster(master, { vars: VARS.vars, stamp: stampFor(tag) }).text;
}

interface Fixture {
  proj: string;
  base: string;
  head: string;
}

interface FixtureOptions {
  /** PJ を新マスター相当まで進めておく(= 適用済み) */
  applied?: boolean;
  /** DESIGN.md を標準と同じ箇所で改変する(= 衝突させる) */
  conflict?: boolean;
  /** vars を書かない(退避経路の検証) */
  noVars?: boolean;
}

function buildFixture(opts: FixtureOptions = {}): Fixture {
  const base = fixtureDir("gs-d3-old");
  write(base, "CLAUDE.md", OLD_CLAUDE);
  write(base, "DESIGN.md", OLD_DESIGN);

  const head = fixtureDir("gs-d3-new");
  write(head, "CLAUDE.md", NEW_CLAUDE);
  write(head, "DESIGN.md", opts.conflict === true ? NEW_DESIGN : OLD_DESIGN);

  const proj = fixtureDir("gs-d3-proj");
  const appliedClaude = opts.applied === true;
  write(
    proj,
    "CLAUDE.md",
    concretize(appliedClaude ? NEW_CLAUDE : OLD_CLAUDE, appliedClaude ? "v0.7.0" : "v0.6.0"),
  );
  const design = concretize(OLD_DESIGN, "v0.6.0");
  write(
    proj,
    "DESIGN.md",
    opts.conflict === true ? design.replace("16px", "14px(PJ 指定)") : design,
  );
  if (opts.noVars !== true) writeVars(proj, VARS);
  return { proj, base, head };
}

function policyFor(fx: Fixture): PolicyDocument {
  const rule: Rule = {
    id: RULE_ID,
    severity: "warn",
    check: "drift3",
    with: { source: `file:${fx.head}`, paths: PATHS },
  };
  return { version: 1, target: "claude-code", ignore: [], rules: [rule], exemptions: [] };
}

function contextFor(fx: Fixture, headTag = "v0.7.0"): Drift3Source {
  return {
    ruleId: RULE_ID,
    paths: PATHS,
    baseRoot: fx.base,
    headRoot: fx.head,
    baseTag: "v0.6.0",
    headTag,
  };
}

async function lint(fx: Fixture, source?: Drift3Source, vars: VarsDocument | null = VARS) {
  const sources = new Map(source === undefined ? [] : [[source.ruleId, source]]);
  const res = await runLint(policyFor(fx), fx.proj, new Date(), {
    drift3: { sources, vars },
  });
  return res.findings;
}

const of = (findings: Finding[], severity: string) =>
  findings.filter((f) => f.severity === severity);

describe("checkDrift3", () => {
  it("テスト35: クリーンに適用できる未適用の標準変更を rule の severity で報告する", async () => {
    const fx = buildFixture();
    const findings = await lint(fx, contextFor(fx));
    const warns = of(findings, "warn");
    expect(warns).toHaveLength(1);
    expect(warns[0].ruleId).toBe(RULE_ID);
    expect(warns[0].message).toContain("standards v0.6.0 → v0.7.0 not applied");
    expect(warns[0].message).toContain("applies cleanly");
    expect(warns[0].message).toContain("run: guard bump v0.7.0");
  });

  it("テスト36: 衝突する変更しか無い場合は info で手動マージを促す", async () => {
    const fx = buildFixture({ conflict: true, applied: true });
    const findings = await lint(fx, contextFor(fx));
    expect(of(findings, "warn")).toHaveLength(0);
    const infos = of(findings, "info");
    expect(infos).toHaveLength(1);
    expect(infos[0].message).toContain("needs manual merge (conflicts in DESIGN.md)");
  });

  it("テスト37: 全て適用済みなら指摘ゼロ", async () => {
    const fx = buildFixture({ applied: true });
    expect(await lint(fx, contextFor(fx))).toHaveLength(0);
  });

  it("旧タグ == 新タグなら何も出さない", async () => {
    const fx = buildFixture();
    expect(await lint(fx, contextFor(fx, "v0.6.0"))).toHaveLength(0);
  });

  it("テスト38: vars が無いと節単位比較へ退避し --init-vars を案内する", async () => {
    const fx = buildFixture({ noVars: true });
    const findings = await lint(fx, undefined, null);
    expect(findings[0].severity).toBe("info");
    expect(findings[0].message).toContain("guardsmith.vars.yaml not found");
    expect(findings[0].message).toContain("guard sync --init-vars");
    // 以降は従来の節単位比較の結果(プレースホルダ未描画のマスターとの差分)
    const sections = findings.slice(1);
    expect(sections.length).toBeGreaterThan(0);
    expect(sections.every((f) => f.severity === "warn")).toBe(true);
    expect(sections.some((f) => f.message.includes("drift detected"))).toBe(true);
  });

  it("未解決の github: source は info でスキップする(drift と同じ扱い)", async () => {
    const fx = buildFixture();
    const policy = policyFor(fx);
    const rule = policy.rules[0] as Extract<Rule, { check: "drift3" }>;
    const remote: PolicyDocument = {
      ...policy,
      rules: [
        {
          ...rule,
          with: { ...rule.with, source: "github:novexar/guardsmith//standards@v0.7.0" },
        },
      ],
    };
    const res = await runLint(remote, fx.proj);
    expect(res.findings).toHaveLength(1);
    expect(res.findings[0].severity).toBe("info");
    expect(res.findings[0].message).toContain("requires remote fetch");
  });

  it("PJ が削除したファイル / マスターから消えたファイルは info のみ", async () => {
    const fx = buildFixture({ applied: true });
    // PJ が DESIGN.md を削除済みで、標準側では変更されている
    rmSync(`${fx.proj}/DESIGN.md`);
    write(fx.head, "DESIGN.md", NEW_DESIGN);
    // 旧マスターにだけ存在するファイル(= 新マスターから消えた)が PJ に残っている
    write(fx.base, "docs/LEGACY.md", "# 旧ドキュメント\n");
    write(fx.proj, "docs/LEGACY.md", "# 旧ドキュメント\n");

    const findings = await lint(fx, contextFor(fx));
    expect(of(findings, "warn")).toHaveLength(0);
    expect(findings.some((f) => f.file === "DESIGN.md" && f.message.includes("deleted it"))).toBe(
      true,
    );
    expect(
      findings.some((f) => f.file === "docs/LEGACY.md" && f.message.includes("gone from master")),
    ).toBe(true);
  });
});

describe("テスト39: 既存の check: drift は挙動が変わらない", () => {
  it("drift3 の文脈を渡しても drift ルールの findings は同一", async () => {
    const fx = buildFixture();
    const driftPolicy: PolicyDocument = {
      version: 1,
      target: "claude-code",
      ignore: [],
      exemptions: [],
      rules: [
        {
          id: "drift/skills-sync",
          severity: "warn",
          check: "drift",
          with: { source: `file:${fx.head}`, paths: ["DESIGN.md"] },
        },
      ],
    };
    const plain = await runLint(driftPolicy, fx.proj);
    const withCtx = await runLint(driftPolicy, fx.proj, new Date(), {
      drift3: { sources: new Map([[RULE_ID, contextFor(fx)]]), vars: VARS },
    });
    expect(withCtx.findings).toEqual(plain.findings);
    expect(plain.findings.length).toBeGreaterThan(0);
  });
});

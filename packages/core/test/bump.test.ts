/**
 * guard bump — 配布タグの引き上げと 3-way 取り込み(計画 §5 テスト 48〜54)。
 *
 * 最重要の不変条件: **失敗時に作業ツリーが一切変わらないこと**。
 * policy だけ新タグ・ファイルは旧状態、という中途半端な状態を残さない(R8)。
 */
import { cpSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { main } from "../src/cli.js";
import { rewriteExtendsTag, runBump } from "../src/bump.js";
import { normalizeMaster, stampFor } from "../src/normalize.js";
import { parsePolicy } from "../src/schema.js";
import { loadVars, writeVars, type VarsDocument } from "../src/vars.js";
import { createGlobScope, globFiles } from "../src/glob.js";
import { makeFixtureDir, REPO_ROOT, write } from "./helpers.js";
import { parse } from "yaml";

const dirs: string[] = [];
function fixtureDir(prefix: string): string {
  const d = makeFixtureDir(prefix);
  dirs.push(d);
  return d;
}
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
  vi.restoreAllMocks();
});

/* ---------------- rewriteExtendsTag ---------------- */

const POLICY_WITH_REFS = `version: 1
target: claude-code

# 標準の配布元(タグ固定は必須)
extends:
  - github:novexar/guardsmith//presets/baseline.yaml@v0.6.0
  - github:novexar/guardsmith//presets/frontend.yaml@v0.6.0
  # 他組織のオーバーレイ(対象外)
  - github:acme/overlay//policy.yaml@v3.1.0

rules:
  - id: drift/standards-sync
    severity: warn
    check: drift3
    with:
      source: github:novexar/guardsmith//standards@v0.6.0
      paths: ["CLAUDE.md"]

exemptions: []
output:
  formats: [console]
`;

describe("rewriteExtendsTag", () => {
  it("テスト48: 対象 owner/repo の参照だけを書き換える", () => {
    const res = rewriteExtendsTag(POLICY_WITH_REFS, "novexar", "guardsmith", "v0.7.0");
    expect(res.rewritten).toHaveLength(3);
    expect(res.rewritten.every((r) => r.from === "v0.6.0" && r.to === "v0.7.0")).toBe(true);
    expect(res.text).toContain("presets/baseline.yaml@v0.7.0");
    expect(res.text).toContain("presets/frontend.yaml@v0.7.0");
    // 別 owner/repo は無変更
    expect(res.text).toContain("github:acme/overlay//policy.yaml@v3.1.0");
  });

  it("テスト51: drift3 の source タグも同時に書き換わる", () => {
    const res = rewriteExtendsTag(POLICY_WITH_REFS, "novexar", "guardsmith", "v0.7.0");
    expect(res.text).toContain("source: github:novexar/guardsmith//standards@v0.7.0");
    expect(res.rewritten.some((r) => r.line.startsWith("source:"))).toBe(true);
  });

  it("テスト49: 書き換え後も policy スキーマ(タグ固定)を満たす", () => {
    const res = rewriteExtendsTag(POLICY_WITH_REFS, "novexar", "guardsmith", "v0.7.0");
    expect(parsePolicy(parse(res.text)).ok).toBe(true);
  });

  it("テスト50: コメント・インデント・キー順が保存される", () => {
    const res = rewriteExtendsTag(POLICY_WITH_REFS, "novexar", "guardsmith", "v0.7.0");
    // 差分はタグ 3 箇所だけ(YAML 再出力ではなくその場テキスト置換であること)
    expect(res.text).toBe(
      POLICY_WITH_REFS.replaceAll(
        "guardsmith//presets/baseline.yaml@v0.6.0",
        "guardsmith//presets/baseline.yaml@v0.7.0",
      )
        .replaceAll(
          "guardsmith//presets/frontend.yaml@v0.6.0",
          "guardsmith//presets/frontend.yaml@v0.7.0",
        )
        .replaceAll("guardsmith//standards@v0.6.0", "guardsmith//standards@v0.7.0"),
    );
    // 行数・コメント行がそのまま
    expect(res.text.split("\n")).toHaveLength(POLICY_WITH_REFS.split("\n").length);
    expect(res.text).toContain("# 標準の配布元(タグ固定は必須)");
    expect(res.text).toContain("  # 他組織のオーバーレイ(対象外)");
  });

  it("同じタグなら何も書き換えない", () => {
    const res = rewriteExtendsTag(POLICY_WITH_REFS, "novexar", "guardsmith", "v0.6.0");
    expect(res.rewritten).toEqual([]);
    expect(res.text).toBe(POLICY_WITH_REFS);
  });
});

/* ---------------- runBump ---------------- */

const MASTER_CLAUDE = `# CLAUDE.md — {{PROJECT_NAME}}

## プロジェクト概要
<!-- gen: オーナーを1行で -->
- **オーナー**: {{OWNER}}

## ブランチ戦略

main ← リリースライン

## PJ固有ルール

(ここに追記)

<!-- standards: novexar/guardsmith v0.6.0 -->
`;

const MASTER_DESIGN = `# デザイン — {{PROJECT_NAME}}

## タイポグラフィ

- 本文: 16px
`;

const VARS: VarsDocument = {
  version: 1,
  standards: "v0.6.0",
  vars: { PROJECT_NAME: "Acme Portal", OWNER: "Novexar" },
};

interface Built {
  proj: string;
  policyFile: string;
  policyText: string;
}

function concretize(master: string, tag: string): string {
  return normalizeMaster(master, { vars: VARS.vars, stamp: stampFor(tag) }).text;
}

/** vars に PM が書いた注記(--init-vars の候補コメント等)が消えないことの目印 */
const VARS_NOTE = "PM 注記: OWNER は法人名で統一する";

function buildProject(opts: { conflict?: boolean; todo?: boolean; noVars?: boolean } = {}): Built {
  const masters = fixtureDir("gs-bump-master");
  write(masters, "v0.6.0/standards/CLAUDE.md", MASTER_CLAUDE);
  write(masters, "v0.6.0/standards/DESIGN.md", MASTER_DESIGN);
  write(
    masters,
    "v0.7.0/standards/CLAUDE.md",
    MASTER_CLAUDE.replace(
      "## ブランチ戦略",
      "## セキュリティ\n\n- 秘密情報はコミットしない\n\n## ブランチ戦略",
    ),
  );
  write(
    masters,
    "v0.7.0/standards/DESIGN.md",
    MASTER_DESIGN.replace("- 本文: 16px", "- 本文: 15px"),
  );

  const proj = fixtureDir("gs-bump-proj");
  write(proj, "CLAUDE.md", concretize(MASTER_CLAUDE, "v0.6.0"));
  const design = concretize(MASTER_DESIGN, "v0.6.0");
  write(proj, "DESIGN.md", opts.conflict === true ? design.replace("16px", "14px") : design);
  if (opts.noVars !== true) {
    writeVars(
      proj,
      opts.todo === true ? { ...VARS, vars: { ...VARS.vars, OWNER: "TODO" } } : VARS,
      {
        header: [VARS_NOTE],
      },
    );
  }

  const policyText = `version: 1
target: claude-code
# 配布元: github:novexar/guardsmith//presets/baseline.yaml@v0.6.0
rules:
  - id: drift/standards-sync
    severity: warn
    check: drift3
    with:
      source: file:${masters.replaceAll("\\", "/")}/{tag}/standards
      paths: ["CLAUDE.md", "DESIGN.md"]
`;
  const policyFile = join(proj, "guard.policy.yaml");
  writeFileSync(policyFile, policyText);
  return { proj, policyFile, policyText };
}

/** ディレクトリ配下の全ファイル内容(相対パス → 内容) */
function snapshot(root: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const abs = join(dir, entry);
      if (statSync(abs).isDirectory()) walk(abs);
      else out.set(relative(root, abs).replaceAll("\\", "/"), readFileSync(abs, "utf8"));
    }
  };
  walk(root);
  return out;
}

function bumpOpts(built: Built, tag = "v0.7.0") {
  return { tag, rootDir: built.proj, policyFile: built.policyFile, repo: "novexar/guardsmith" };
}

describe("runBump", () => {
  it("テスト53: policy・ファイル・vars・スタンプの全てが更新され 0 を返す", async () => {
    const built = buildProject();
    expect(await runBump(bumpOpts(built))).toBe(0);

    const claudeMd = readFileSync(join(built.proj, "CLAUDE.md"), "utf8");
    expect(claudeMd).toContain("## セキュリティ");
    expect(claudeMd).toContain("- **オーナー**: Novexar"); // PJ 値が残っている
    expect(claudeMd).toContain("<!-- standards: novexar/guardsmith v0.7.0 -->");
    expect(readFileSync(join(built.proj, "DESIGN.md"), "utf8")).toContain("- 本文: 15px");
    expect(loadVars(built.proj)?.standards).toBe("v0.7.0");
    // vars は standards 行だけが書き換わり、PM の注記コメントは残る
    const varsRaw = readFileSync(join(built.proj, "guardsmith.vars.yaml"), "utf8");
    expect(varsRaw).toContain(VARS_NOTE);
    expect(varsRaw).toContain('standards: "v0.7.0"');
    // policy の github: 参照が新タグへ(コメント内も追従)
    expect(readFileSync(built.policyFile, "utf8")).toContain("baseline.yaml@v0.7.0");
  });

  it("テスト52: 衝突があると 1 を返し、作業ツリーを一切変更しない", async () => {
    const built = buildProject({ conflict: true });
    const before = snapshot(built.proj);
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(await runBump(bumpOpts(built))).toBe(1);

    expect(snapshot(built.proj)).toEqual(before);
    expect(readFileSync(built.policyFile, "utf8")).toBe(built.policyText);
    expect(loadVars(built.proj)?.standards).toBe("v0.6.0");
    const errors = spy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(errors).toContain("bump aborted");
    expect(errors).toContain("left unchanged");
  });

  it("--conflict-markers 指定時だけマーカーを書くが、policy と vars は進めない", async () => {
    const built = buildProject({ conflict: true });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await runBump({ ...bumpOpts(built), conflictMarkers: true })).toBe(1);

    expect(readFileSync(join(built.proj, "DESIGN.md"), "utf8")).toContain("<<<<<<<");
    expect(readFileSync(built.policyFile, "utf8")).toBe(built.policyText);
    expect(loadVars(built.proj)?.standards).toBe("v0.6.0");
  });

  it("テスト54: タグ形式でない引数は 2 を返し何も書かない", async () => {
    const built = buildProject();
    const before = snapshot(built.proj);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    for (const tag of ["0.7.0", "main", "v0.7"]) {
      expect(await runBump(bumpOpts(built, tag))).toBe(2);
    }
    expect(snapshot(built.proj)).toEqual(before);
  });

  it("vars に TODO が残っていると 2 で止まる(誤った値の書き込み防止)", async () => {
    const built = buildProject({ todo: true });
    const before = snapshot(built.proj);
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await runBump(bumpOpts(built))).toBe(2);
    expect(snapshot(built.proj)).toEqual(before);
    expect(spy.mock.calls.map((c) => String(c[0])).join("\n")).toContain("OWNER");
  });

  it("vars が無ければ --init-vars を案内して 2 を返す", async () => {
    const built = buildProject({ noVars: true });
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await runBump(bumpOpts(built))).toBe(2);
    expect(spy.mock.calls.map((c) => String(c[0])).join("\n")).toContain("guard sync --init-vars");
  });

  it("不正な --repo は 2 を返す", async () => {
    const built = buildProject();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await runBump({ ...bumpOpts(built), repo: "guardsmith" })).toBe(2);
  });

  it("新タグのマスターが存在しなければ書く前に落ちる(タグだけ進めない)", async () => {
    const built = buildProject();
    const before = snapshot(built.proj);
    // v0.9.0 のマスターは用意していない。空マスターとして扱うと「全ファイルが
    // マスターから消えた」と誤判定し、何も適用せずタグだけ進んでしまう
    await expect(runBump(bumpOpts(built, "v0.9.0"))).rejects.toThrow(/head master not found/);
    expect(snapshot(built.proj)).toEqual(before);
  });
});

/* ---------------- 統合: guard new → 具体化 → vars → guard bump ---------------- */

describe("guard new から guard bump までの一連の流れ", () => {
  const PATHS = ["CLAUDE.md", "DESIGN.md", "docs/**/*.md", ".claude/agents/**/*.md"];
  const NAMED: Record<string, string> = {
    PROJECT_NAME: "Acme Portal",
    OWNER: "Novexar",
    "ORG/REPO": "novexar/acme",
  };

  /**
   * init-project が埋めるはずの vars 一式を、マスターの実ファイルから作る。
   * 1 つでも欠けると guard bump は 2 で止まる(未確定値の流し込み防止)ので、
   * 標準にキーが増えてもこのテストが正しい前提のまま動くようにする。
   */
  async function varsForMaster(root: string): Promise<Record<string, string>> {
    const scope = await createGlobScope(root, { gitignore: false });
    const out: Record<string, string> = { ...NAMED };
    for (const file of await globFiles(scope, PATHS)) {
      const raw = readFileSync(join(root, file), "utf8");
      for (const key of normalizeMaster(raw, { vars: {} }).unresolved) {
        out[key] ??= `値(${key})`;
      }
    }
    return out;
  }

  it("ローカル file: の新マスターで bump が通り、PJ 値と標準変更が両立する", async () => {
    const parent = fixtureDir("gs-e2e");
    const dest = join(parent, "acme");
    expect(await main(["new", dest])).toBe(0);

    // 配布マスターの 2 世代を用意する(v0.7.0 = guard new が展開したもの)
    const masters = fixtureDir("gs-e2e-master");
    const oldRoot = join(masters, "v0.7.0", "standards");
    const newRoot = join(masters, "v0.8.0", "standards");
    cpSync(join(REPO_ROOT, "standards"), oldRoot, { recursive: true });
    cpSync(oldRoot, newRoot, { recursive: true });
    const designPath = join(newRoot, "DESIGN.md");
    writeFileSync(
      designPath,
      `${readFileSync(designPath, "utf8")}\n## 新しい標準節\n\nv0.8.0 で追加された規約。\n`,
    );

    // init-project 相当: マスターを vars で具体化して PJ へ書き戻す
    const PROJECT_VARS = await varsForMaster(oldRoot);
    for (const file of ["CLAUDE.md", "DESIGN.md"]) {
      const raw = readFileSync(join(oldRoot, file), "utf8");
      writeFileSync(
        join(dest, file),
        normalizeMaster(raw, { vars: PROJECT_VARS, stamp: stampFor("v0.7.0") }).text,
      );
    }
    writeVars(dest, { version: 1, standards: "v0.7.0", vars: PROJECT_VARS });

    // policy をローカルマスター参照へ差し替える(実タグはまだ存在しないため)
    writeFileSync(
      join(dest, "guard.policy.yaml"),
      `version: 1
target: claude-code
rules:
  - id: drift/standards-sync
    severity: warn
    check: drift3
    with:
      source: file:${masters.replaceAll("\\", "/")}/{tag}/standards
      paths: ${JSON.stringify(PATHS)}
`,
    );

    expect(await main(["bump", "v0.8.0", "--root", dest])).toBe(0);

    const design = readFileSync(join(dest, "DESIGN.md"), "utf8");
    expect(design).toContain("## 新しい標準節");
    expect(design).toContain("Acme Portal"); // PJ 値が保たれている
    expect(loadVars(dest)?.standards).toBe("v0.8.0");
    expect(readFileSync(join(dest, "CLAUDE.md"), "utf8")).toContain(
      "<!-- standards: novexar/guardsmith v0.8.0 -->",
    );
  });
});

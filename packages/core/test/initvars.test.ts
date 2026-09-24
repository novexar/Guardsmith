/**
 * guard sync --init-vars — 既存 PJ からの置換値推定(計画 §5 テスト 40〜47)。
 * 推定は「わからないものは TODO にする」方向へ倒れること(誤った値の静かな混入が最大の危険)。
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { inferFromFile, inferVars, runInitVars } from "../src/initvars.js";
import { loadVars } from "../src/vars.js";
import { makeFixtureDir, write } from "./helpers.js";

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

function single(master: string, local: string) {
  return inferVars(new Map([["CLAUDE.md", master]]), new Map([["CLAUDE.md", local]]));
}

describe("inferFromFile / inferVars", () => {
  it("テスト40: 単一プレースホルダ行から値を切り出す", () => {
    const got = inferFromFile("# CLAUDE.md — {{PROJECT_NAME}}\n", "# CLAUDE.md — Acme Portal\n");
    expect(got.get("PROJECT_NAME")).toEqual(["Acme Portal"]);
  });

  it("テスト41: 区切りのある複数プレースホルダを全て切り出す", () => {
    const got = inferFromFile(
      "- **リポジトリ**: {{ORG/REPO}}({{単一システム | モノレポ}})\n",
      "- **リポジトリ**: novexar/acme(モノレポ)\n",
    );
    expect(got.get("ORG/REPO")).toEqual(["novexar/acme"]);
    expect(got.get("単一システム | モノレポ")).toEqual(["モノレポ"]);
  });

  it("テスト42: 区切りゼロで隣接する場合はその行を諦め、キーは TODO になる", () => {
    expect(inferFromFile("{{A}}{{B}}\n", "xy\n").size).toBe(0);
    const res = single("{{A}}{{B}}\n", "xy\n");
    expect(res.vars).toEqual({ A: "TODO", B: "TODO" });
    expect(res.todo).toEqual(["A", "B"]);
  });

  it("テスト43: 候補が割れたら最頻値を採用し全候補を記録する", () => {
    const master = "# {{NAME}}\n\n## 概要\n\n- 名称: {{NAME}}\n- 別名: {{NAME}}\n";
    const local = "# Acme\n\n## 概要\n\n- 名称: Acme\n- 別名: Acme Portal\n";
    const res = single(master, local);
    expect(res.vars.NAME).toBe("Acme");
    expect(res.ambiguous.NAME).toEqual(["Acme", "Acme Portal"]);
    expect(res.todo).toEqual([]);
  });

  it("テスト44: 一度も出現しなかったキーは TODO", () => {
    // PJ 側に対応するファイルが無い = 1 行も突き合わせできない
    const res = inferVars(new Map([["DESIGN.md", "色: {{ACCENT_COLOR}}\n"]]), new Map());
    expect(res.vars).toEqual({ ACCENT_COLOR: "TODO" });
    expect(res.todo).toEqual(["ACCENT_COLOR"]);
  });

  it("テスト45: PJ が行ごと削除した箇所のキーは TODO", () => {
    const master = "# タイトル\n\n- 採用しない層: {{FE_STACK}}\n\n## 次の節\n";
    const local = "# タイトル\n\n## 次の節\n";
    const res = single(master, local);
    expect(res.vars.FE_STACK).toBe("TODO");
    expect(res.todo).toContain("FE_STACK");
  });

  it("テスト46: 推定値が secret パターンにヒットしたら TODO に落とす", () => {
    const master = "- **トークン**: {{API_TOKEN}}\n";
    const local = "- **トークン**: ghp_0123456789abcdefghij0123456789abcdefgh\n";
    const res = single(master, local);
    expect(res.vars.API_TOKEN).toBe("TODO");
    expect(res.redacted).toEqual(["API_TOKEN"]);
    expect(res.todo).toContain("API_TOKEN");
    // 検出した値そのものは持ち回さない
    expect(JSON.stringify(res)).not.toContain("ghp_");
  });
});

/* ---------------- runInitVars ---------------- */

const MASTER_CLAUDE = `# CLAUDE.md — {{PROJECT_NAME}}

## プロジェクト概要
<!-- gen: オーナーを1行で -->
- **オーナー**: {{OWNER}}
- **リポジトリ**: {{ORG/REPO}}({{単一システム | モノレポ}})

## PJ固有ルール

- {{PROJECT_SPECIFIC_RULES}}

<!-- standards: novexar/guardsmith v0.6.0 -->
`;

const PROJ_CLAUDE = `# CLAUDE.md — Acme Portal

## プロジェクト概要
- **オーナー**: Novexar
- **リポジトリ**: novexar/acme(モノレポ)

## PJ固有ルール

- デプロイ前に承認を取る

<!-- standards: novexar/guardsmith v0.6.0 -->
`;

interface Built {
  proj: string;
  policyFile: string;
}

function buildProject(opts: { extendsTag?: string; stamp?: string | null } = {}): Built {
  const masters = fixtureDir("gs-iv-master");
  write(masters, "v0.6.0/standards/CLAUDE.md", MASTER_CLAUDE);

  const proj = fixtureDir("gs-iv-proj");
  const claude =
    opts.stamp === null
      ? PROJ_CLAUDE.replace(/<!-- standards:.*-->\n/, "")
      : PROJ_CLAUDE.replace("v0.6.0 -->", `${opts.stamp ?? "v0.6.0"} -->`);
  write(proj, "CLAUDE.md", claude);
  const policyFile = join(proj, "guard.policy.yaml");
  writeFileSync(
    policyFile,
    `version: 1
target: claude-code
# 配布元: github:novexar/guardsmith//presets/baseline.yaml@${opts.extendsTag ?? "v0.6.0"}
rules:
  - id: drift/standards-sync
    severity: warn
    check: drift3
    with:
      source: file:${masters.replaceAll("\\", "/")}/{tag}/standards
      paths: ["CLAUDE.md", "docs/**/*.md"]
`,
  );
  return { proj, policyFile };
}

describe("runInitVars", () => {
  it("旧マスターと PJ から vars を推定して書き出す", async () => {
    const { proj, policyFile } = buildProject();
    expect(await runInitVars({ rootDir: proj, policyFile })).toBe(0);

    const doc = loadVars(proj);
    expect(doc?.standards).toBe("v0.6.0");
    expect(doc?.vars).toMatchObject({
      PROJECT_NAME: "Acme Portal",
      OWNER: "Novexar",
      "ORG/REPO": "novexar/acme",
      "単一システム | モノレポ": "モノレポ",
      PROJECT_SPECIFIC_RULES: "デプロイ前に承認を取る",
    });
    const raw = readFileSync(join(proj, "guardsmith.vars.yaml"), "utf8");
    expect(raw).toContain("推定であって正ではない");
  });

  it("テスト47: 既存 guardsmith.vars.yaml があるとき上書きせず 2 を返す", async () => {
    const { proj, policyFile } = buildProject();
    const varsPath = join(proj, "guardsmith.vars.yaml");
    writeFileSync(varsPath, 'version: 1\nstandards: "v0.1.0"\nvars: {}\n');
    expect(await runInitVars({ rootDir: proj, policyFile })).toBe(2);
    expect(readFileSync(varsPath, "utf8")).toContain("v0.1.0");
  });

  it("スタンプが無ければ 2 を返す(基準タグを決められない)", async () => {
    const { proj, policyFile } = buildProject({ stamp: null });
    expect(await runInitVars({ rootDir: proj, policyFile })).toBe(2);
    expect(existsSync(join(proj, "guardsmith.vars.yaml"))).toBe(false);
  });

  it("スタンプと extends のタグが食い違うと警告し、生成ファイルに直す旨を書く", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { proj, policyFile } = buildProject({ extendsTag: "v0.7.0" });
    expect(await runInitVars({ rootDir: proj, policyFile })).toBe(0);
    const warned = spy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(warned).toContain("v0.7.0");
    expect(warned).toContain("stamped v0.6.0");
    const raw = readFileSync(join(proj, "guardsmith.vars.yaml"), "utf8");
    expect(raw).toContain("`standards:` は実際に取り込んだ標準のタグに直すこと");
    // 採用するのはスタンプ側(= 実際に取り込んだ標準)
    expect(loadVars(proj)?.standards).toBe("v0.6.0");
  });

  it("マスターに 1 件も該当が無ければ空の vars を書かずに 2 を返す", async () => {
    const { proj, policyFile } = buildProject();
    // paths がマスターの実体と噛み合っていないケース(source の指定ミス等)
    writeFileSync(
      policyFile,
      readFileSync(policyFile, "utf8").replace('["CLAUDE.md", "docs/**/*.md"]', '["docs/**/*.md"]'),
    );
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await runInitVars({ rootDir: proj, policyFile })).toBe(2);
    expect(existsSync(join(proj, "guardsmith.vars.yaml"))).toBe(false);
    expect(spy.mock.calls.map((c) => String(c[0])).join("\n")).toContain("no master files matched");
  });

  it("drift3 ルールが無い policy では 2 を返す", async () => {
    const { proj, policyFile } = buildProject();
    writeFileSync(policyFile, "version: 1\ntarget: claude-code\nrules: []\n");
    expect(await runInitVars({ rootDir: proj, policyFile })).toBe(2);
  });
});

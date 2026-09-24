/**
 * レビュー指摘(H2 / H3 / H4 / M1 / M2 / M3 / M4 / LOW)の回帰テスト。
 * 共通の狙いは「未確定・対象外・失敗のときに PJ へ書かない」こと。
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runBump } from "../src/bump.js";
import { main } from "../src/cli.js";
import { runLint } from "../src/lint.js";
import { normalizeMaster, rewriteStamp, renderPlaceholders, stampFor } from "../src/normalize.js";
import {
  buildDrift3Sources,
  Drift3PolicyError,
  loadPolicyWithMeta,
  resolveBaseMasters,
} from "../src/resolver.js";
import { applySync3, planSync3, varsBlockingWrite } from "../src/sync3.js";
import {
  loadVars,
  readStampTag,
  updateStandardsTag,
  writeVars,
  type VarsDocument,
} from "../src/vars.js";
import type { PolicyDocument, Rule } from "../src/schema.js";
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

const MASTER_CLAUDE = `# CLAUDE.md — {{PROJECT_NAME}}

## ブランチ戦略

main ← リリースライン

<!-- standards: novexar/guardsmith v0.6.0 -->
`;
const NEW_CLAUDE = MASTER_CLAUDE.replace(
  "main ← リリースライン",
  "main ← リリースライン(タグ固定)",
);
const MASTER_NEWDOC = "# 追加文書 — {{PROJECT_NAME}}\n\n{{SETUP_STEPS}}\n";

const VARS: VarsDocument = {
  version: 1,
  standards: "v0.6.0",
  vars: { PROJECT_NAME: "Acme", SETUP_STEPS: "pnpm install" },
};

interface Proj {
  proj: string;
  masters: string;
  policyFile: string;
}

interface BuildOptions {
  /** vars から抜くキー(未解決プレースホルダを作る) */
  drop?: string;
  /** vars の値を TODO にするキー */
  todo?: string;
  /** 新マスターにのみ存在するファイルを足す(create を発生させる) */
  addNew?: boolean;
  /** 節単位 drift ルール(skills)も持たせる */
  skills?: boolean;
  /** 同じリポジトリを指す drift3 を 2 本にする */
  duplicate?: boolean;
  /** PJ 側で標準と同じ箇所を書き換え、衝突させる */
  conflict?: boolean;
}

function buildProject(opts: BuildOptions = {}): Proj {
  const masters = fixtureDir("gs-rf-master");
  write(masters, "v0.6.0/standards/CLAUDE.md", MASTER_CLAUDE);
  write(masters, "v0.7.0/standards/CLAUDE.md", NEW_CLAUDE);
  if (opts.addNew === true) write(masters, "v0.7.0/standards/docs/NEW.md", MASTER_NEWDOC);
  if (opts.skills === true) {
    for (const tag of ["v0.6.0", "v0.7.0"]) {
      write(
        masters,
        `${tag}/standards/.claude/skills/start-task/SKILL.md`,
        "intro\n## 手順\nマスターの手順\n",
      );
    }
  }

  const proj = fixtureDir("gs-rf-proj");
  const source = MASTER_CLAUDE.replace(
    "main ← リリースライン",
    opts.conflict === true ? "main ← リリースライン(PJ 運用)" : "main ← リリースライン",
  );
  write(
    proj,
    "CLAUDE.md",
    normalizeMaster(source, { vars: VARS.vars, stamp: stampFor("v0.6.0") }).text,
  );
  if (opts.skills === true) {
    write(proj, ".claude/skills/start-task/SKILL.md", "intro\n## 手順\nPJ が書き換えた手順\n");
  }

  const vars = { ...VARS, vars: { ...VARS.vars } };
  if (opts.drop !== undefined) delete vars.vars[opts.drop];
  if (opts.todo !== undefined) vars.vars[opts.todo] = "TODO";
  writeVars(proj, vars);

  const dir = masters.replaceAll("\\", "/");
  const rules = [
    `  - id: drift/standards-sync
    severity: warn
    check: drift3
    with:
      source: file:${dir}/{tag}/standards@v0.7.0
      paths: ["CLAUDE.md", "docs/**/*.md"]`,
  ];
  if (opts.duplicate === true) {
    rules.push(`  - id: drift/standards-extra
    severity: warn
    check: drift3
    with:
      source: file:${dir}/{tag}/standards@v0.7.0
      paths: ["CLAUDE.md"]`);
  }
  if (opts.skills === true) {
    rules.push(`  - id: drift/skills-sync
    severity: warn
    check: drift
    with:
      source: file:${dir}/v0.7.0/standards
      paths: [".claude/skills/**"]
      allow_sections: ["## PJ固有手順"]`);
  }
  const policyFile = join(proj, "guard.policy.yaml");
  writeFileSync(policyFile, `version: 1\ntarget: claude-code\nrules:\n${rules.join("\n")}\n`);
  return { proj, masters, policyFile };
}

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

function bumpOpts(p: Proj) {
  return {
    tag: "v0.7.0",
    rootDir: p.proj,
    policyFile: p.policyFile,
    repo: "novexar/guardsmith",
  };
}

function quiet() {
  return vi.spyOn(console, "error").mockImplementation(() => undefined);
}

/* ---------------- H2: 未確定の置換値では書かない ---------------- */

describe("H2: TODO / 未解決 vars が残っていると書き込みを拒否する", () => {
  it("varsBlockingWrite が TODO と未登録キーの両方を報告する", async () => {
    const p = buildProject({ todo: "PROJECT_NAME", drop: "SETUP_STEPS", addNew: true });
    const vars = loadVars(p.proj)!;
    const { policy, driftOrigins } = await loadPolicyWithMeta(p.policyFile);
    const resolved = await buildDrift3Sources(policy, driftOrigins, vars.standards);
    const plan = await planSync3(resolved.sources, p.proj, vars);

    const msg = varsBlockingWrite(plan, vars);
    expect(msg).toContain("PROJECT_NAME"); // TODO のまま
    expect(msg).toContain("SETUP_STEPS"); // vars に無い

    // 全て埋めた vars で作り直した計画なら止まらない
    const full = { ...vars, vars: { PROJECT_NAME: "Acme", SETUP_STEPS: "pnpm install" } };
    const fullPlan = await planSync3(resolved.sources, p.proj, full);
    expect(varsBlockingWrite(fullPlan, full)).toBeNull();
  });

  it("guard sync --write は TODO が残っていると 2 を返し何も書かない", async () => {
    const p = buildProject({ todo: "PROJECT_NAME" });
    const before = snapshot(p.proj);
    const spy = quiet();
    expect(await main(["sync", "--write", "--root", p.proj])).toBe(2);
    expect(snapshot(p.proj)).toEqual(before);
    expect(spy.mock.calls.map((c) => String(c[0])).join("\n")).toContain("TODO");
  });

  it("guard sync --write は未登録のプレースホルダが残っていると 2 を返す", async () => {
    const p = buildProject({ drop: "SETUP_STEPS", addNew: true });
    const before = snapshot(p.proj);
    const spy = quiet();
    expect(await main(["sync", "--write", "--root", p.proj])).toBe(2);
    expect(snapshot(p.proj)).toEqual(before);
    expect(spy.mock.calls.map((c) => String(c[0])).join("\n")).toContain("SETUP_STEPS");
  });

  it("dry-run は従来どおり 0 で、情報として出すだけ", async () => {
    const p = buildProject({ drop: "SETUP_STEPS", addNew: true });
    const before = snapshot(p.proj);
    expect(await main(["sync", "--root", p.proj])).toBe(0);
    expect(snapshot(p.proj)).toEqual(before);
  });

  it("guard bump も未登録プレースホルダで 2 を返す", async () => {
    const p = buildProject({ drop: "SETUP_STEPS", addNew: true });
    const before = snapshot(p.proj);
    quiet();
    expect(await runBump(bumpOpts(p))).toBe(2);
    expect(snapshot(p.proj)).toEqual(before);
  });
});

/* ---------------- H3 / M3: 追随対象のリポジトリ ---------------- */

describe("H3: 対象リポジトリ以外の drift3 にタグを強制しない", () => {
  const OTHER = "github:novexar/guardsmith-private//standards@v3.0.0";

  /**
   * policy の読込は別リポジトリの tarball 取得を伴う(その drift3 自身の検査に要る)ため、
   * ここでは解決済み policy を手で組み立てて buildDrift3Sources だけを検証する。
   * 主張は「別リポジトリの source は **解決対象にすらならない**(= 自分のタグを当てない)」で、
   * 解決されていたら取得が走って落ちるので、ネットワーク非依存のまま検証できる。
   */
  function policyWithBoth(dir: string): { policy: PolicyDocument; origins: Map<string, string> } {
    const own = `file:${dir}/{tag}/standards@v0.7.0`;
    const rule = (id: string, source: string): Rule => ({
      id,
      severity: "warn",
      check: "drift3",
      with: { source, paths: ["CLAUDE.md"] },
    });
    return {
      policy: {
        version: 1,
        target: "claude-code",
        ignore: [],
        exemptions: [],
        rules: [rule("drift/standards-sync", own), rule("drift/private-sync", OTHER)],
      },
      origins: new Map([
        ["drift/standards-sync", own],
        ["drift/private-sync", OTHER],
      ]),
    };
  }

  it("別リポジトリの drift3 は skipped に入り、タグ解決もされない", async () => {
    const p = buildProject();
    const { policy, origins } = policyWithBoth(p.masters.replaceAll("\\", "/"));
    const resolved = await buildDrift3Sources(policy, origins, "v0.6.0", {
      repo: "novexar/guardsmith",
    });
    expect(resolved.sources.map((s) => s.ruleId)).toEqual(["drift/standards-sync"]);
    expect(resolved.skipped).toEqual([{ ruleId: "drift/private-sync", source: OTHER }]);
  });

  it("--repo を切り替えても file: のローカル参照は対象に残る", async () => {
    const p = buildProject();
    const { policy, origins } = policyWithBoth(p.masters.replaceAll("\\", "/"));
    // file: はローカル開発用で owner/repo を持たないため常に対象。github: のみ一致判定する
    const resolved = await buildDrift3Sources(policy, origins, "v0.6.0", {
      repo: "novexar/other",
    });
    expect(resolved.sources.map((s) => s.ruleId)).toEqual(["drift/standards-sync"]);
    expect(resolved.skipped).toEqual([{ ruleId: "drift/private-sync", source: OTHER }]);
  });
});

describe("M3: 対象リポジトリ向けの drift3 は 1 本だけ", () => {
  it("2 本あると policy エラーになる", async () => {
    const p = buildProject({ duplicate: true });
    const { policy, driftOrigins } = await loadPolicyWithMeta(p.policyFile);
    await expect(buildDrift3Sources(policy, driftOrigins, "v0.6.0")).rejects.toBeInstanceOf(
      Drift3PolicyError,
    );
    await expect(buildDrift3Sources(policy, driftOrigins, "v0.6.0")).rejects.toThrow(
      /must be unique/,
    );
  });

  it("guard bump / guard sync は 2 を返す", async () => {
    const p = buildProject({ duplicate: true });
    quiet();
    expect(await main(["sync", "--root", p.proj])).toBe(2);
    expect(await main(["bump", "v0.7.0", "--root", p.proj])).toBe(2);
  });
});

/* ---------------- H4: 部分適用させない ---------------- */

describe("H4: 途中で書き込みに失敗しても 1 件も適用しない", () => {
  it("2 件目が失敗すると 1 件目も書かれない", () => {
    const root = fixtureDir("gs-rf-atomic");
    write(root, "a.md", "元の A\n");
    write(root, "b.md", "元の B\n");
    writeVars(root, VARS);
    const vars = loadVars(root)!;

    // 2 件目の書き込み先をディレクトリにして writeFileSync を失敗させる
    mkdirSync(join(root, "b.md.guardsmith.tmp"), { recursive: true });

    expect(() =>
      applySync3(
        {
          actions: [
            {
              file: "a.md",
              kind: "merge",
              content: "新しい A\n",
              conflicts: [],
              unresolvedVars: [],
            },
            {
              file: "b.md",
              kind: "merge",
              content: "新しい B\n",
              conflicts: [],
              unresolvedVars: [],
            },
          ],
          localOnly: [],
          conflicted: [],
          baseTag: "v0.6.0",
          nextTag: "v0.7.0",
          conflictMarkers: false,
        },
        root,
        vars,
      ),
    ).toThrow(/nothing was applied/);

    expect(readFileSync(join(root, "a.md"), "utf8")).toBe("元の A\n");
    expect(readFileSync(join(root, "b.md"), "utf8")).toBe("元の B\n");
    // 基準タグも進めない
    expect(loadVars(root)?.standards).toBe("v0.6.0");
    // 一時ファイルを残さない
    expect(existsSync(join(root, "a.md.guardsmith.tmp"))).toBe(false);
  });
});

/* ---------------- M1 / M2: 節単位モードとの協調 ---------------- */

describe("M1: 3-way が衝突したら節単位モードの適用も止める", () => {
  it("skills は復元されず、終了コードは 1", async () => {
    const p = buildProject({ skills: true, conflict: true });
    const skill = join(p.proj, ".claude/skills/start-task/SKILL.md");
    const before = readFileSync(skill, "utf8");
    expect(await main(["sync", "--write", "--root", p.proj])).toBe(1);
    expect(readFileSync(skill, "utf8")).toBe(before);
    expect(loadVars(p.proj)?.standards).toBe("v0.6.0");
  });

  it("衝突が無ければ節単位モードも 3-way も適用される", async () => {
    const p = buildProject({ skills: true });
    expect(await main(["sync", "--write", "--root", p.proj])).toBe(0);
    expect(readFileSync(join(p.proj, ".claude/skills/start-task/SKILL.md"), "utf8")).toContain(
      "マスターの手順",
    );
    expect(readFileSync(join(p.proj, "CLAUDE.md"), "utf8")).toContain("(タグ固定)");
  });
});

describe("M2: guard bump は節単位 drift(skills)も同期する", () => {
  it("1 コマンドで 3-way と節単位の両方が適用され、件数を報告する", async () => {
    const p = buildProject({ skills: true });
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    expect(await runBump(bumpOpts(p))).toBe(0);
    expect(readFileSync(join(p.proj, ".claude/skills/start-task/SKILL.md"), "utf8")).toContain(
      "マスターの手順",
    );
    const out = log.mock.calls.map((c) => String(c[0])).join("\n");
    expect(out).toContain("merged (3-way)");
    expect(out).toContain("restored (sections)");
  });
});

/* ---------------- M4: lint で未登録プレースホルダを見せる ---------------- */

describe("M4: checkDrift3 が未登録の置換値を info で報告する", () => {
  it("vars に無いキーが lint に出る", async () => {
    const p = buildProject({ drop: "SETUP_STEPS", addNew: true });
    const { policy, driftOrigins } = await loadPolicyWithMeta(p.policyFile);
    const vars = loadVars(p.proj)!;
    const resolved = await buildDrift3Sources(policy, driftOrigins, vars.standards);
    const res = await runLint(policy, p.proj, new Date(), {
      drift3: { sources: new Map(resolved.sources.map((s) => [s.ruleId, s])), vars },
    });
    const hit = res.findings.find((f) => f.message.includes("missing from guardsmith.vars.yaml"));
    expect(hit?.severity).toBe("info");
    expect(hit?.message).toContain("SETUP_STEPS");
  });
});

/* ---------------- LOW ---------------- */

describe("LOW: 細部", () => {
  it("1. vars の standards 行を書き換えても行末コメントを残す", () => {
    const root = fixtureDir("gs-rf-varscomment");
    writeFileSync(
      join(root, "guardsmith.vars.yaml"),
      '# 先頭コメント\nversion: 1\nstandards: "v0.6.0" # 展開元のタグ\nvars: {}\n',
    );
    updateStandardsTag(root, { version: 1, standards: "v0.6.0", vars: {} }, "v0.7.0");
    const raw = readFileSync(join(root, "guardsmith.vars.yaml"), "utf8");
    expect(raw).toContain('standards: "v0.7.0" # 展開元のタグ');
    expect(raw).toContain("# 先頭コメント");
    expect(loadVars(root)?.standards).toBe("v0.7.0");
  });

  it("2. 空キー {{ }} はプレースホルダとして扱わない", () => {
    const res = renderPlaceholders("値: {{ }} と {{KEY}}\n", { KEY: "x" });
    expect(res.text).toBe("値: {{ }} と x\n");
    expect(res.unresolved).toEqual([]);
  });

  it("3. スタンプのタグは vX.Y.Z 固定(.. を読み出さない)", () => {
    expect(readStampTag("<!-- standards: novexar/guardsmith v0.7.0 -->")).toBe("v0.7.0");
    expect(readStampTag("<!-- standards: novexar/guardsmith v.. -->")).toBeNull();
    expect(readStampTag("<!-- standards: novexar/guardsmith v0.7 -->")).toBeNull();
  });

  it("4. resolveBaseMasters は旧マスターだけを見る(新タグが無くても通る)", async () => {
    const masters = fixtureDir("gs-rf-baseonly");
    write(masters, "v0.6.0/standards/CLAUDE.md", MASTER_CLAUDE);
    const origins = new Map([
      ["drift/standards-sync", `file:${masters.replaceAll("\\", "/")}/{tag}/standards@v0.7.0`],
    ]);
    const roots = await resolveBaseMasters(origins, "v0.6.0");
    expect(roots.get("drift/standards-sync")).toContain("v0.6.0");
  });

  it("5. guard bump は lint 専用フラグを黙って無視しない", async () => {
    const p = buildProject();
    await expect(main(["bump", "v0.7.0", "--root", p.proj, "--format", "json"])).rejects.toThrow(
      /unknown flag/,
    );
    await expect(main(["bump", "v0.7.0", "--root", p.proj, "--out", "x.json"])).rejects.toThrow(
      /unknown flag/,
    );
  });

  it("5. 置換値に $& や $1 を含んでもそのまま書き込まれる", () => {
    const res = renderPlaceholders("名前: {{NAME}}\n", { NAME: "$& と $1 と $$" });
    expect(res.text).toBe("名前: $& と $1 と $$\n");
    expect(
      rewriteStamp("<!-- standards: novexar/guardsmith v0.6.0 -->", "novexar/x$&y v0.7.0"),
    ).toBe("<!-- standards: novexar/x$&y v0.7.0 -->");
  });
});

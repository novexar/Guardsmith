/**
 * 巻き戻しの防止(レビュー HIGH)と、bump が extends も新タグで解決すること(MEDIUM)。
 *
 * 再現する事故: ファイルと vars は v0.7.0 なのに policy だけ v0.6.0(bump の policy
 * 書き込みだけが失敗した / policy を revert・手編集した)。素直に 3-way を組むと
 * base=v0.7.0 / theirs=v0.6.0 の向きになり、`guard sync --write` が標準を**巻き戻す**。
 */
import { readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runBump } from "../src/bump.js";
import { main } from "../src/cli.js";
import { runLint } from "../src/lint.js";
import { normalizeMaster, stampFor } from "../src/normalize.js";
import { buildDrift3Sources, loadPolicyWithMeta } from "../src/resolver.js";
import { compareTags, loadVars, writeVars, type VarsDocument } from "../src/vars.js";
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

function quiet() {
  return vi.spyOn(console, "error").mockImplementation(() => undefined);
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

const OLD_CLAUDE = `# CLAUDE.md — {{PROJECT_NAME}}

## ブランチ戦略

main ← リリースライン

<!-- standards: novexar/guardsmith v0.6.0 -->
`;
const NEW_CLAUDE = OLD_CLAUDE.replace(
  "## ブランチ戦略",
  "## セキュリティ\n\n- 秘密は持たない\n\n## ブランチ戦略",
);

const VARS: VarsDocument = { version: 1, standards: "v0.7.0", vars: { PROJECT_NAME: "Acme" } };

/**
 * 「ファイルと vars は v0.7.0 / policy は v0.6.0」の PJ。
 * drift3 の source は `@v0.6.0` を固定しているので、3-way は新 → 旧の向きになる。
 */
function buildRolledBackPolicy(): { proj: string; policyFile: string } {
  const masters = fixtureDir("gs-dg-master");
  write(masters, "v0.6.0/standards/CLAUDE.md", OLD_CLAUDE);
  write(masters, "v0.7.0/standards/CLAUDE.md", NEW_CLAUDE);

  const proj = fixtureDir("gs-dg-proj");
  // PJ は v0.7.0 まで取り込み済み
  write(
    proj,
    "CLAUDE.md",
    normalizeMaster(NEW_CLAUDE, { vars: VARS.vars, stamp: stampFor("v0.7.0") }).text,
  );
  writeVars(proj, VARS);

  const policyFile = join(proj, "guard.policy.yaml");
  writeFileSync(
    policyFile,
    `version: 1
target: claude-code
rules:
  - id: drift/standards-sync
    severity: warn
    check: drift3
    with:
      source: file:${masters.replaceAll("\\", "/")}/{tag}/standards@v0.6.0
      paths: ["CLAUDE.md"]
`,
  );
  return { proj, policyFile };
}

describe("compareTags", () => {
  it("major / minor / patch の順に比較する", () => {
    expect(compareTags("v0.7.0", "v0.6.0")).toBeGreaterThan(0);
    expect(compareTags("v0.6.0", "v0.7.0")).toBeLessThan(0);
    expect(compareTags("v0.7.0", "v0.7.0")).toBe(0);
    expect(compareTags("v1.0.0", "v0.99.99")).toBeGreaterThan(0);
    expect(compareTags("v0.7.10", "v0.7.9")).toBeGreaterThan(0);
  });
});

describe("HIGH: 基準タグの方が新しいとき標準を巻き戻さない", () => {
  it("guard sync --write は 2 を返し、1 ファイルも書かない", async () => {
    const { proj } = buildRolledBackPolicy();
    const before = snapshot(proj);
    const spy = quiet();

    expect(await main(["sync", "--write", "--root", proj])).toBe(2);

    expect(snapshot(proj)).toEqual(before);
    expect(loadVars(proj)?.standards).toBe("v0.7.0");
    expect(readFileSync(join(proj, "CLAUDE.md"), "utf8")).toContain("## セキュリティ");
    const err = spy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(err).toContain("roll the standards back");
    expect(err).toContain("guard bump v0.7.0");
  });

  it("dry-run も計画を出さず 2 を返す", async () => {
    const { proj } = buildRolledBackPolicy();
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    quiet();
    expect(await main(["sync", "--root", proj])).toBe(2);
    expect(log.mock.calls.map((c) => String(c[0])).join("\n")).not.toContain("standards v0.7.0 →");
  });

  it("guard bump も 2 を返して何も書かない", async () => {
    const { proj } = buildRolledBackPolicy();
    const before = snapshot(proj);
    quiet();
    // 現行より古いタグへの bump はそのまま巻き戻し要求になる
    expect(await main(["bump", "v0.6.0", "--root", proj])).toBe(2);
    expect(snapshot(proj)).toEqual(before);
  });

  it("guard lint は warn で可視化する(exit 0 で黙らない)", async () => {
    const { proj, policyFile } = buildRolledBackPolicy();
    const { policy, driftOrigins } = await loadPolicyWithMeta(policyFile);
    const vars = loadVars(proj)!;
    const resolved = await buildDrift3Sources(policy, driftOrigins, vars.standards);
    const res = await runLint(policy, proj, new Date(), {
      drift3: { sources: new Map(resolved.sources.map((s) => [s.ruleId, s])), vars },
    });
    const warns = res.findings.filter((f) => f.severity === "warn");
    expect(warns).toHaveLength(1);
    expect(warns[0].message).toContain("is at v0.7.0 but the policy distributes v0.6.0");
    expect(warns[0].message).toContain("guard bump v0.7.0");
  });

  it("--allow-downgrade を明示すれば適用される", async () => {
    const { proj } = buildRolledBackPolicy();
    expect(await main(["sync", "--write", "--root", proj, "--allow-downgrade"])).toBe(0);
    // 意図した巻き戻し: 標準の節が消え、基準タグも下がる
    expect(readFileSync(join(proj, "CLAUDE.md"), "utf8")).not.toContain("## セキュリティ");
    expect(loadVars(proj)?.standards).toBe("v0.6.0");
  });
});

describe("MEDIUM: guard bump は extends も新タグで解決する", () => {
  /** 新タグの baseline だけ drift3 の paths が広い fixture */
  function buildWidenedBaseline(): { proj: string; policyFile: string; cacheDir: string } {
    const masters = fixtureDir("gs-dg-ext");
    const cacheDir = join(masters, "cache");
    const repo = "cache/novexar/guardsmith";
    for (const [tag, paths] of [
      ["v0.6.0", '["CLAUDE.md"]'],
      ["v0.7.0", '["CLAUDE.md", "docs/**/*.md"]'],
    ] as const) {
      write(
        masters,
        `${repo}/${tag}/presets/baseline.yaml`,
        `version: 1
target: claude-code
rules:
  - id: drift/standards-sync
    severity: warn
    check: drift3
    with:
      source: github:novexar/guardsmith//standards@${tag}
      paths: ${paths}
`,
      );
      write(
        masters,
        `${repo}/${tag}/standards/CLAUDE.md`,
        tag === "v0.6.0" ? OLD_CLAUDE : NEW_CLAUDE,
      );
    }
    // docs/ は新タグの標準にだけ存在する = 広がった paths でのみ拾える
    write(masters, `${repo}/v0.7.0/standards/docs/SETUP.md`, "# セットアップ — {{PROJECT_NAME}}\n");

    const proj = fixtureDir("gs-dg-ext-proj");
    write(
      proj,
      "CLAUDE.md",
      normalizeMaster(OLD_CLAUDE, { vars: { PROJECT_NAME: "Acme" }, stamp: stampFor("v0.6.0") })
        .text,
    );
    writeVars(proj, { version: 1, standards: "v0.6.0", vars: { PROJECT_NAME: "Acme" } });

    const policyFile = join(proj, "guard.policy.yaml");
    writeFileSync(
      policyFile,
      `version: 1
target: claude-code
extends:
  - github:novexar/guardsmith//presets/baseline.yaml@v0.6.0
rules: []
`,
    );
    return { proj, policyFile, cacheDir };
  }

  it("新タグの baseline で広がった paths の対象を同じ bump で取り込む", async () => {
    const { proj, policyFile, cacheDir } = buildWidenedBaseline();
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    expect(
      await runBump({
        tag: "v0.7.0",
        rootDir: proj,
        policyFile,
        repo: "novexar/guardsmith",
        cacheDir,
      }),
    ).toBe(0);

    // 旧タグの baseline では paths に含まれず、取りこぼしていたファイル
    expect(readFileSync(join(proj, "docs/SETUP.md"), "utf8")).toBe("# セットアップ — Acme\n");
    expect(readFileSync(join(proj, "CLAUDE.md"), "utf8")).toContain("## セキュリティ");
    expect(loadVars(proj)?.standards).toBe("v0.7.0");
    expect(readFileSync(policyFile, "utf8")).toContain("baseline.yaml@v0.7.0");
  });
});

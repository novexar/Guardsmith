/**
 * 書き込み先の封じ込め(レビュー C1)。
 *
 * `guard sync` は glob にマッチしたパスへ **書き込む**。policy は remote extends から
 * 継承されうるため、上流を差し替えられると `paths: ["../**\/*.md"]` のようなパターンで
 * PJ 外へ書けてしまう。スキーマ(`..` セグメント拒否)と実行時(root 配下への封じ込め)の
 * 二重で塞ぎ、どちらか一方をすり抜けても書き込みが起きないことを固定する。
 */
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { parsePolicy, type PolicyDocument } from "../src/schema.js";
import { applySync, planSync } from "../src/sync.js";
import { applySync3, planSync3, type Drift3Source } from "../src/sync3.js";
import { writeVars, type VarsDocument } from "../src/vars.js";
import { makeFixtureDir, REPO_ROOT, write } from "./helpers.js";

const dirs: string[] = [];
function fixtureDir(prefix: string): string {
  const d = makeFixtureDir(prefix);
  dirs.push(d);
  return d;
}
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
});

const ESCAPING = ["../**/*.md", "..\\evil.md", "a/../../b.md", "../secret.md"];

describe("schema: paths に .. セグメントを許さない", () => {
  const policyWith = (paths: string[]) =>
    parsePolicy({
      version: 1,
      target: "claude-code",
      rules: [
        {
          id: "drift/standards-sync",
          severity: "warn",
          check: "drift3",
          with: { source: "file:./master", paths },
        },
      ],
    });

  for (const pattern of ESCAPING) {
    it(`rejects ${JSON.stringify(pattern)}`, () => {
      const r = policyWith([pattern]);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors.join("; ")).toContain("'..' segment");
    });
  }

  it("通常のパターンと否定パターンは通す", () => {
    const r = policyWith(["CLAUDE.md", "docs/**/*.md", "!.claude/worktrees/**", "..dotdir/x.md"]);
    expect(r.ok, r.ok ? "" : r.errors.join("; ")).toBe(true);
  });

  it("配布中の preset 3 種は引き続き parse できる", () => {
    for (const preset of ["presets/baseline.yaml", "presets/self.yaml", "presets/frontend.yaml"]) {
      const r = parsePolicy(parse(readFileSync(join(REPO_ROOT, preset), "utf8")));
      expect(r.ok, r.ok ? "" : `${preset}: ${r.errors.join("; ")}`).toBe(true);
    }
  });
});

/**
 * スキーマをすり抜けた(= 手で組み立てた PolicyDocument / Drift3Source)場合でも
 * 実行時に書き込みを止めること。glob が root 外の相対パスを返す状況を直接再現する。
 */
describe("実行時: root 外のパスへは書き込まない", () => {
  interface Escape {
    root: string;
    outside: string;
    master: string;
  }

  function buildEscape(): Escape {
    const parent = fixtureDir("gs-esc");
    const root = join(parent, "proj");
    const master = join(parent, "master");
    write(parent, "victim.md", "触ってはいけない\n");
    write(root, "CLAUDE.md", "# PJ\n");
    write(master, "victim.md", "マスターから注入した内容\n");
    return { root, outside: join(parent, "victim.md"), master };
  }

  it("節単位モード: applySync が root 外を書かない", async () => {
    const esc = buildEscape();
    const policy: PolicyDocument = {
      version: 1,
      target: "claude-code",
      ignore: [],
      exemptions: [],
      rules: [
        {
          id: "drift/skills-sync",
          severity: "warn",
          check: "drift",
          // スキーマを通さず直接組み立てた「上流が差し替えられた」状態
          with: { source: `file:${esc.master}`, paths: ["../victim.md"] },
        },
      ],
    };
    await expect(planSync(policy, esc.root)).rejects.toThrow(/outside the project root/);
    expect(readFileSync(esc.outside, "utf8")).toBe("触ってはいけない\n");

    // 計画を偽造して適用だけ呼んでも書けない
    expect(() =>
      applySync(
        {
          actions: [{ file: "../victim.md", kind: "create", sections: [], content: "x" }],
          localOnly: [],
        },
        esc.root,
      ),
    ).toThrow(/outside the project root/);
    expect(readFileSync(esc.outside, "utf8")).toBe("触ってはいけない\n");
  });

  it("3-way モード: planSync3 / applySync3 が root 外を書かない", async () => {
    const esc = buildEscape();
    const vars: VarsDocument = { version: 1, standards: "v0.6.0", vars: {} };
    writeVars(esc.root, vars);
    const source: Drift3Source = {
      ruleId: "drift/standards-sync",
      paths: ["../victim.md"],
      baseRoot: esc.master,
      headRoot: esc.master,
      baseTag: "v0.6.0",
      headTag: "v0.7.0",
    };
    await expect(planSync3([source], esc.root, vars)).rejects.toThrow(/outside the project root/);
    expect(readFileSync(esc.outside, "utf8")).toBe("触ってはいけない\n");

    expect(() =>
      applySync3(
        {
          actions: [
            {
              file: "../victim.md",
              kind: "create",
              content: "x",
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
        esc.root,
        vars,
      ),
    ).toThrow(/outside the project root/);
    expect(readFileSync(esc.outside, "utf8")).toBe("触ってはいけない\n");
    // 一時ファイルも残さない
    expect(existsSync(`${esc.outside}.guardsmith.tmp`)).toBe(false);
  });
});

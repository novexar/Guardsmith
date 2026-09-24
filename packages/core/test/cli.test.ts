/** CLI (guard init / lint / sync / bump / explain) の挙動検証 */
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main } from "../src/cli.js";
import { normalizeMaster, stampFor } from "../src/normalize.js";
import { writeVars } from "../src/vars.js";
import { makeFixtureDir, write } from "./helpers.js";

const SIMPLE_POLICY = `version: 1
target: claude-code
rules:
  - id: t/exists
    severity: error
    check: file-exists
    with: { paths: [README.md] }
`;

let dir: string;
let prevCwd: string;

beforeEach(() => {
  prevCwd = process.cwd();
  dir = makeFixtureDir("gs-cli");
  process.chdir(dir);
});

afterEach(() => {
  process.chdir(prevCwd);
  rmSync(dir, { recursive: true, force: true });
});

describe("guard init", () => {
  it("creates guard.policy.yaml and refuses to overwrite", async () => {
    expect(await main(["init"])).toBe(0);
    expect(existsSync(join(dir, "guard.policy.yaml"))).toBe(true);
    expect(readFileSync(join(dir, "guard.policy.yaml"), "utf8")).toContain("preset:baseline");
    expect(await main(["init"])).toBe(2);
  });
});

describe("guard lint", () => {
  it("returns 2 when policy is missing", async () => {
    expect(await main(["lint"])).toBe(2);
  });

  it("passes on compliant repo and fails on violation", async () => {
    writeFileSync(join(dir, "guard.policy.yaml"), SIMPLE_POLICY);
    write(dir, "README.md", "hello\n");
    expect(await main(["lint"])).toBe(0);
    rmSync(join(dir, "README.md"));
    expect(await main(["lint"])).toBe(1);
  });

  it("writes sarif report with --format sarif --out", async () => {
    writeFileSync(join(dir, "guard.policy.yaml"), SIMPLE_POLICY);
    write(dir, "README.md", "hello\n");
    expect(await main(["lint", "--format", "sarif", "--out", "report.sarif"])).toBe(0);
    const sarif = JSON.parse(readFileSync(join(dir, "report.sarif"), "utf8"));
    expect(sarif.version).toBe("2.1.0");
  });

  it("emits json with --format json", async () => {
    writeFileSync(join(dir, "guard.policy.yaml"), SIMPLE_POLICY);
    write(dir, "README.md", "hello\n");
    expect(await main(["lint", "--format", "json"])).toBe(0);
  });

  it("rejects unknown flag and invalid format", async () => {
    await expect(main(["lint", "--bogus"])).rejects.toThrow(/unknown flag/);
    await expect(main(["lint", "--format", "xml"])).rejects.toThrow(/invalid --format/);
  });
});

describe("guard explain", () => {
  it("explains a rule from the effective policy", async () => {
    writeFileSync(join(dir, "guard.policy.yaml"), SIMPLE_POLICY);
    expect(await main(["explain", "t/exists"])).toBe(0);
    expect(await main(["explain", "no/such"])).toBe(2);
    expect(await main(["explain"])).toBe(2);
  });

  it("returns 2 when policy cannot be loaded", async () => {
    expect(await main(["explain", "t/exists"])).toBe(2);
  });
});

describe("usage", () => {
  it("prints usage for unknown command", async () => {
    expect(await main(["wat"])).toBe(2);
  });

  it("documents every lint / sync / bump flag it accepts (テスト55)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      expect(await main(["wat"])).toBe(2);
      const lines = spy.mock.calls.flatMap((c) => String(c[0]).split("\n"));
      const lint = lines.find((l) => l.includes("guard lint"));
      const sync = lines.find((l) => l.includes("guard sync"));
      const bump = lines.find((l) => l.includes("guard bump"));
      for (const line of [lint, sync, bump]) {
        expect(line).toBeDefined();
        expect(line).toContain("--no-cache");
        expect(line).toContain("--no-gitignore");
      }
      expect(lint).toContain("--format");
      expect(sync).toContain("--write");
      expect(sync).toContain("--conflict-markers");
      expect(sync).toContain("--init-vars");
      expect(bump).toContain("<tag>");
      expect(bump).toContain("--repo");
      expect(bump).toContain("--conflict-markers");
      expect(lines.some((l) => l.startsWith("usage:") && l.includes("bump"))).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });
});

/* ---------------- guard sync ---------------- */

const DRIFT_POLICY = (master: string) => `version: 1
target: claude-code
rules:
  - id: drift/skills-sync
    severity: warn
    check: drift
    with:
      source: file:${master.replaceAll("\\", "/")}
      paths: [".claude/skills/**"]
      allow_sections: ["## PJ固有手順"]
`;

const DRIFT3_POLICY = (masters: string) => `version: 1
target: claude-code
rules:
  - id: drift/standards-sync
    severity: warn
    check: drift3
    with:
      source: file:${masters.replaceAll("\\", "/")}/{tag}/standards@v0.7.0
      paths: ["CLAUDE.md"]
`;

const OLD_CLAUDE = `# CLAUDE.md — {{PROJECT_NAME}}

## ブランチ戦略

main ← リリースライン

<!-- standards: novexar/guardsmith v0.6.0 -->
`;

const NEW_CLAUDE = OLD_CLAUDE.replace(
  "main ← リリースライン",
  "main ← リリースライン(タグ vX.Y.Z で配布)",
);

/** 3-way モードの PJ 一式を dir 直下に作る。conflict で同じ行を PJ 側も書き換える */
function build3Way(conflict: boolean): void {
  const masters = join(dir, "masters");
  write(masters, "v0.6.0/standards/CLAUDE.md", OLD_CLAUDE);
  write(masters, "v0.7.0/standards/CLAUDE.md", NEW_CLAUDE);
  write(
    dir,
    "CLAUDE.md",
    normalizeMaster(
      conflict ? NEW_CLAUDE.replace("(タグ vX.Y.Z で配布)", "(PJ 運用)") : OLD_CLAUDE,
      {
        vars: { PROJECT_NAME: "Acme" },
        stamp: stampFor("v0.6.0"),
      },
    ).text,
  );
  writeVars(dir, { version: 1, standards: "v0.6.0", vars: { PROJECT_NAME: "Acme" } });
  writeFileSync(join(dir, "guard.policy.yaml"), DRIFT3_POLICY(masters));
}

describe("guard sync", () => {
  it("drift3 ルールが無い policy では従来どおり 0 を返し節単位で復元する(回帰)", async () => {
    const master = join(dir, "master");
    write(master, ".claude/skills/start-task/SKILL.md", "intro\n## 手順\nmaster\n");
    write(dir, ".claude/skills/start-task/SKILL.md", "intro\n## 手順\nlocal edit\n");
    writeFileSync(join(dir, "guard.policy.yaml"), DRIFT_POLICY(master));

    expect(await main(["sync"])).toBe(0); // dry-run
    expect(readFileSync(join(dir, ".claude/skills/start-task/SKILL.md"), "utf8")).toContain(
      "local edit",
    );
    expect(await main(["sync", "--write"])).toBe(0);
    expect(readFileSync(join(dir, ".claude/skills/start-task/SKILL.md"), "utf8")).toContain(
      "master",
    );
  });

  it("テスト56: 3-way モードは衝突なしで 0 / 衝突ありで 1 を返す", async () => {
    build3Way(false);
    expect(await main(["sync"])).toBe(0); // dry-run でも衝突が無ければ 0
    expect(readFileSync(join(dir, "CLAUDE.md"), "utf8")).not.toContain("タグ vX.Y.Z");
    expect(await main(["sync", "--write"])).toBe(0);
    const applied = readFileSync(join(dir, "CLAUDE.md"), "utf8");
    expect(applied).toContain("main ← リリースライン(タグ vX.Y.Z で配布)");
    expect(applied).toContain("Acme");
    expect(readFileSync(join(dir, "guardsmith.vars.yaml"), "utf8")).toContain('"v0.7.0"');
  });

  it("テスト56: 衝突時は 1 を返し、既定では 1 ファイルも書かない", async () => {
    build3Way(true);
    const before = readFileSync(join(dir, "CLAUDE.md"), "utf8");
    expect(await main(["sync", "--write"])).toBe(1);
    expect(readFileSync(join(dir, "CLAUDE.md"), "utf8")).toBe(before);
    // --conflict-markers でマーカーを書いても終了コードは 1 のまま
    expect(await main(["sync", "--write", "--conflict-markers"])).toBe(1);
    expect(readFileSync(join(dir, "CLAUDE.md"), "utf8")).toContain("<<<<<<<");
  });

  it("vars が無い 3-way policy は --init-vars を案内して 2 を返す", async () => {
    build3Way(false);
    rmSync(join(dir, "guardsmith.vars.yaml"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      expect(await main(["sync"])).toBe(2);
      expect(spy.mock.calls.map((c) => String(c[0])).join("\n")).toContain(
        "guard sync --init-vars",
      );
    } finally {
      spy.mockRestore();
    }
  });

  it("--init-vars は vars を生成して終了する(sync は実行しない)", async () => {
    build3Way(false);
    rmSync(join(dir, "guardsmith.vars.yaml"));
    const before = readFileSync(join(dir, "CLAUDE.md"), "utf8");
    expect(await main(["sync", "--init-vars"])).toBe(0);
    expect(existsSync(join(dir, "guardsmith.vars.yaml"))).toBe(true);
    expect(readFileSync(join(dir, "CLAUDE.md"), "utf8")).toBe(before);
  });

  it("returns 2 when policy is missing", async () => {
    expect(await main(["sync"])).toBe(2);
  });
});

describe("guard bump", () => {
  it("requires a tag argument", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      expect(await main(["bump"])).toBe(2);
      expect(await main(["bump", "--repo", "novexar/guardsmith"])).toBe(2);
    } finally {
      spy.mockRestore();
    }
  });
});

/** CLI (guard init / lint / explain) の挙動検証 */
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main } from "../src/cli.js";
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

  it("documents every lint / sync flag it accepts", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      expect(await main(["wat"])).toBe(2);
      const lines = spy.mock.calls.flatMap((c) => String(c[0]).split("\n"));
      const lint = lines.find((l) => l.includes("guard lint"));
      const sync = lines.find((l) => l.includes("guard sync"));
      for (const line of [lint, sync]) {
        expect(line).toBeDefined();
        expect(line).toContain("--no-cache");
        expect(line).toContain("--no-gitignore");
      }
      expect(lint).toContain("--format");
      expect(sync).toContain("--write");
    } finally {
      spy.mockRestore();
    }
  });
});

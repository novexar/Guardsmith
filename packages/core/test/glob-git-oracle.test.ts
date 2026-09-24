/**
 * git を正解オラクルにした照合テスト。
 * 実 git の `git ls-files --cached --others --exclude-standard`(= 追跡される/されうる
 * ファイルの集合)と globFiles の結果が一致することを検証し、
 * 「git が追跡するファイルを誤って除外しない」を機械的に担保する。
 * git が無い環境では skip する。
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createGlobScope, globFiles } from "../src/glob.js";
import { makeFixtureDir, write } from "./helpers.js";

function gitAvailable(): boolean {
  try {
    execFileSync("git", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const GITIGNORES: Record<string, string> = {
  // ディレクトリ限定 / 非アンカー / アンカー / エスケープ / ディレクトリ再包含
  ".gitignore":
    "node_modules/\n*.log\n/root-only.txt\nbuild\n\\#hash.txt\nout/\ndirbuild/\n# comment\n",
  "sub/.gitignore": "!build\n!important.log\n!dirbuild/\n",
  "deep/.gitignore": "!out/keep\n",
};

const FILES = [
  "keep.txt",
  "root-only.txt",
  "sub/root-only.txt",
  "a.log",
  "sub/important.log",
  "sub/other.log",
  "build/x.txt",
  "sub/build/secret.md",
  "#hash.txt",
  "node_modules/pkg/index.js",
  "deep/out/keep",
  "out/z.txt",
  "dirbuild/a.txt",
  "sub/dirbuild/x.txt",
];

const available = gitAvailable();
let root: string;
let configDir: string;

beforeAll(() => {
  if (!available) return;
  root = makeFixtureDir("gs-git-oracle");
  // グローバル/システムの excludesFile に影響されないよう空の設定を指す
  configDir = mkdtempSync(join(tmpdir(), "gs-git-cfg-"));
  writeFileSync(join(configDir, "config"), "");
  for (const [path, content] of Object.entries(GITIGNORES)) write(root, path, content);
  for (const path of FILES) write(root, path, "x\n");
  execFileSync("git", ["init", "-q"], { cwd: root, env: gitEnv() });
});

afterAll(() => {
  if (!available) return;
  rmSync(root, { recursive: true, force: true });
  rmSync(configDir, { recursive: true, force: true });
});

function gitEnv(): NodeJS.ProcessEnv {
  const config = join(configDir, "config");
  return {
    ...process.env,
    GIT_CONFIG_GLOBAL: config,
    GIT_CONFIG_SYSTEM: config,
    GIT_CONFIG_NOSYSTEM: "1",
  };
}

/** git が「追跡している or 追跡されうる」とみなすファイル集合 */
function gitTracked(): string[] {
  return execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
    cwd: root,
    env: gitEnv(),
    encoding: "utf8",
  })
    .split("\n")
    .filter((line) => line.length > 0)
    .sort();
}

describe.skipIf(!available)("globFiles matches git", () => {
  it("returns exactly the set git would track", async () => {
    const scope = await createGlobScope(root);
    const ours = (await globFiles(scope, ["**/*"])).sort();
    expect(ours).toEqual(gitTracked());
  });

  it("keeps the files the fixture is designed to re-include", async () => {
    const scope = await createGlobScope(root);
    const ours = await globFiles(scope, ["**/*"]);
    // 深い階層の否定がディレクトリごと再包含するケース(過剰除外の回帰防止)
    expect(ours).toContain("sub/build/secret.md");
    // ディレクトリ限定形(`build/` + `!build/`)も同様に保持されること
    expect(ours).toContain("sub/dirbuild/x.txt");
    expect(ours).not.toContain("dirbuild/a.txt");
    expect(ours).toContain("sub/important.log");
    // 除外されたディレクトリの内側は再包含できない(git の規則)
    expect(ours).not.toContain("deep/out/keep");
    expect(ours).not.toContain("#hash.txt");
  });
});

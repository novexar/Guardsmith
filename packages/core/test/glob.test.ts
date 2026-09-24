/**
 * glob ヘルパー検証 — .gitignore 意味論(正確性)と fast-glob ignore(枝刈り)の両立。
 * 「git が追跡するファイルを誤って除外しない」を最優先に、枝刈りは安全な行からのみ行う。
 */
import { rmSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { ALWAYS_IGNORED, createGlobScope, globFiles } from "../src/glob.js";
import { makeFixtureDir, write } from "./helpers.js";

const dirs: string[] = [];

function fixture(files: Record<string, string>): string {
  const root = makeFixtureDir("gs-glob");
  dirs.push(root);
  for (const [path, content] of Object.entries(files)) write(root, path, content);
  return root;
}

afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true });
});

async function all(root: string, options = {}): Promise<string[]> {
  const scope = await createGlobScope(root, options);
  return (await globFiles(scope, ["**"])).sort();
}

describe("createGlobScope / globFiles — .gitignore semantics", () => {
  it("treats a trailing-slash pattern as directory-only", async () => {
    const root = fixture({
      ".gitignore": "build/\n",
      "build/out.txt": "x",
      "keep/build": "a file named build, not a directory",
    });
    const hits = await all(root);
    expect(hits).not.toContain("build/out.txt");
    expect(hits).toContain("keep/build");
  });

  it("anchors a pattern that starts with a slash to the .gitignore directory", async () => {
    const root = fixture({
      ".gitignore": "/anchored.txt\n",
      "anchored.txt": "x",
      "sub/anchored.txt": "x",
    });
    const hits = await all(root);
    expect(hits).not.toContain("anchored.txt");
    expect(hits).toContain("sub/anchored.txt");
  });

  it("matches an unanchored pattern at any depth", async () => {
    const root = fixture({
      ".gitignore": "secret.txt\n",
      "secret.txt": "x",
      "sub/deep/secret.txt": "x",
      "sub/keep.txt": "x",
    });
    const hits = await all(root);
    expect(hits).not.toContain("secret.txt");
    expect(hits).not.toContain("sub/deep/secret.txt");
    expect(hits).toContain("sub/keep.txt");
  });

  it("honours negation (!) and does not prune a negated .gitignore", async () => {
    const root = fixture({
      ".gitignore": "*.log\n!keep.log\n",
      "drop.log": "x",
      "keep.log": "x",
    });
    const scope = await createGlobScope(root);
    const hits = (await globFiles(scope, ["**"])).sort();
    expect(hits).not.toContain("drop.log");
    expect(hits).toContain("keep.log");
    // 否定行を含むファイルからは枝刈りパターンを作らない(誤って除外しないことが最優先)
    expect(scope.fgIgnore.some((p) => p.includes("*.log"))).toBe(false);
  });

  it("applies nested .gitignore relative to its own directory", async () => {
    const root = fixture({
      ".gitignore": "root-only.txt\n",
      "sub/.gitignore": "nested.txt\n",
      "nested.txt": "x",
      "root-only.txt": "x",
      "sub/nested.txt": "x",
      "sub/deep/nested.txt": "x",
      "sub/keep.txt": "x",
    });
    const hits = await all(root);
    expect(hits).toContain("nested.txt"); // ルートでは対象外
    expect(hits).not.toContain("root-only.txt");
    expect(hits).not.toContain("sub/nested.txt");
    expect(hits).not.toContain("sub/deep/nested.txt");
    expect(hits).toContain("sub/keep.txt");
  });

  it("does not let a deeper negation be defeated by an ancestor's prune pattern", async () => {
    const root = fixture({
      ".gitignore": "*.log\n",
      "sub/.gitignore": "!important.log\n",
      "drop.log": "x",
      "sub/important.log": "x",
    });
    const scope = await createGlobScope(root);
    const hits = (await globFiles(scope, ["**"])).sort();
    expect(hits).not.toContain("drop.log");
    expect(hits).toContain("sub/important.log");
  });

  it("always excludes .git, even when no .gitignore exists", async () => {
    const root = fixture({ ".git/config": "[core]", "CLAUDE.md": "x" });
    expect(await all(root)).toEqual(["CLAUDE.md"]);
    expect(ALWAYS_IGNORED).toContain("**/.git/**");
  });

  it("scans everything when gitignore is disabled", async () => {
    const root = fixture({ ".gitignore": "secret.txt\n", "secret.txt": "x", "keep.txt": "x" });
    const hits = await all(root, { gitignore: false });
    expect(hits).toContain("secret.txt");
    expect(hits).toContain("keep.txt");
  });

  it("applies policy ignore globs independently of .gitignore", async () => {
    const root = fixture({ "vendor/lib.js": "x", "src/app.js": "x" });
    const hits = await all(root, { ignore: ["vendor/**"] });
    expect(hits).toEqual(["src/app.js"]);
  });

  it("keeps policy ignore effective while gitignore is disabled", async () => {
    const root = fixture({ "vendor/lib.js": "x", "src/app.js": "x" });
    const hits = await all(root, { ignore: ["vendor/**"], gitignore: false });
    expect(hits).toEqual(["src/app.js"]);
  });
});

describe("createGlobScope — pruning (traversal, not just filtering)", () => {
  it("turns safe .gitignore lines into fast-glob ignore patterns", async () => {
    const root = fixture({
      ".gitignore": ".claude/worktrees/\nnode_modules/\n*.log\n",
      "CLAUDE.md": "x",
    });
    const scope = await createGlobScope(root);
    expect(scope.fgIgnore).toContain(".claude/worktrees/**/*");
    expect(scope.fgIgnore).toContain("**/node_modules/**/*");
    expect(scope.fgIgnore).toContain("**/*.log");
  });

  it("does not descend into a pruned directory", async () => {
    const files: Record<string, string> = { ".gitignore": "heavy/\n", "CLAUDE.md": "x" };
    for (let i = 0; i < 200; i++) files[`heavy/deep/f${i}.txt`] = "x";
    const root = fixture(files);

    const scope = await createGlobScope(root);
    // 枝刈りが効いていれば fast-glob の生結果そのものに heavy/ が現れない
    const raw = await globFiles(scope, ["**"]);
    expect(raw.sort()).toEqual([".gitignore", "CLAUDE.md"]);

    const open = await createGlobScope(root, { gitignore: false });
    expect((await globFiles(open, ["**"])).length).toBe(202);
  });

  it("keeps pruning directory contents when a descendant .gitignore negates", async () => {
    const root = fixture({
      ".gitignore": "node_modules/\n*.log\n",
      "standards/.gitignore": "!.env.example\n",
      "CLAUDE.md": "x",
    });
    const scope = await createGlobScope(root);
    // 「ディレクトリ配下」は深い否定に覆されないため枝刈りを続ける
    expect(scope.fgIgnore).toContain("**/node_modules/**/*");
    expect(scope.fgIgnore).toContain("**/*.log/**/*");
    // 「要素そのもの」は再包含されうるため落とす
    expect(scope.fgIgnore).not.toContain("**/*.log");
  });

  it("skips lines whose glob meaning differs between gitignore and fast-glob", async () => {
    const root = fixture({ ".gitignore": "a{b,c}.txt\n", "a{b,c}.txt": "x", "keep.txt": "x" });
    const scope = await createGlobScope(root);
    expect(scope.fgIgnore.some((p) => p.includes("{"))).toBe(false);
  });
});

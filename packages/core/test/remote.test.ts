/**
 * github: リモートresolver検証
 * モックHTTP(fetchImpl差し替え)でのユニット/E2E:
 *  - ref パース / キャッシュのヒット・バイパス / GITHUB_TOKEN ヘッダ / 404
 *  - tarball 展開時のパストラバーサル対策
 *  - extends github: (単段・多段3層・//path・既定 guard.policy.yaml)
 *  - drift source github://path の file: 解決 + 実検査
 */
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { create } from "tar";
import { runLint } from "../src/lint.js";
import { assertSafeEntry, containedJoin, ensureRepoCached, parseGithubRef } from "../src/remote.js";
import { loadPolicy } from "../src/resolver.js";
import { makeFixtureDir, write } from "./helpers.js";

const cleanupDirs: string[] = [];
afterAll(() => {
  for (const d of cleanupDirs) rmSync(d, { recursive: true, force: true });
});

function tempDir(prefix: string): string {
  const d = makeFixtureDir(prefix);
  cleanupDirs.push(d);
  return d;
}

/** codeload 形式(トップに <repo>-<ver>/ ディレクトリ)の tar.gz を作る */
async function makeTarball(buildContents: (dir: string) => void): Promise<Buffer> {
  const stage = tempDir("gs-tar");
  const top = "repo-1.0.0";
  mkdirSync(join(stage, top), { recursive: true });
  buildContents(join(stage, top));
  const out = join(stage, "out.tgz");
  await create({ file: out, gzip: true, cwd: stage }, [top]);
  return readFileSync(out);
}

/** `..` を含むエントリを持つ悪意ある tar.gz を作る */
async function makeMaliciousTarball(): Promise<Buffer> {
  const stage = tempDir("gs-evil");
  write(stage, "evil.txt", "evil");
  mkdirSync(join(stage, "repo-1.0.0"), { recursive: true });
  const out = join(stage, "out.tgz");
  // cwd を repo-1.0.0 にして ../evil.txt を preservePaths で格納 → エントリ path に .. が残る
  await create({ file: out, gzip: true, cwd: join(stage, "repo-1.0.0"), preservePaths: true }, [
    "../evil.txt",
  ]);
  return readFileSync(out);
}

interface FetchLog {
  urls: string[];
  headers: Record<string, string>[];
}

/** codeload URL → tarball Buffer のマップで応答するモック fetch */
function makeFetch(repos: Record<string, Buffer>, log?: FetchLog): typeof fetch {
  return (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    log?.urls.push(url);
    log?.headers.push(
      Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>)),
    );
    const m = /^https:\/\/codeload\.github\.com\/([^/]+)\/([^/]+)\/tar\.gz\/refs\/tags\/(.+)$/.exec(
      url,
    );
    const buf = m ? repos[`${m[1]}/${m[2]}@${m[3]}`] : undefined;
    if (!buf) return new Response("not found", { status: 404 });
    return new Response(new Uint8Array(buf));
  }) as typeof fetch;
}

describe("parseGithubRef", () => {
  it("parses owner/repo@tag and //path form", () => {
    expect(parseGithubRef("github:novexar/guardsmith@v0.1.0")).toEqual({
      owner: "novexar",
      repo: "guardsmith",
      path: undefined,
      tag: "v0.1.0",
    });
    expect(parseGithubRef("github:novexar/guardsmith//presets/baseline.yaml@v0.1.0")).toEqual({
      owner: "novexar",
      repo: "guardsmith",
      path: "presets/baseline.yaml",
      tag: "v0.1.0",
    });
  });

  it("rejects malformed refs and dangerous components", () => {
    expect(() => parseGithubRef("github:novexar/guardsmith")).toThrow(/invalid github ref/);
    expect(() => parseGithubRef("github:noslash@v1")).toThrow(/invalid github ref/);
    expect(() => parseGithubRef("github:../evil@v1")).toThrow(/invalid github ref|invalid owner/);
    expect(() => parseGithubRef("github:a/..@v1")).toThrow(/invalid repo/);
    expect(() => parseGithubRef("github:a/b@..")).toThrow(/invalid tag/);
  });
});

describe("ensureRepoCached", () => {
  it("downloads once, then serves from cache; --no-cache refetches", async () => {
    const cacheDir = tempDir("gs-cache");
    const tarball = await makeTarball((dir) => write(dir, "hello.txt", "world\n"));
    const log: FetchLog = { urls: [], headers: [] };
    const fetchImpl = makeFetch({ "acme/standards@v1.0.0": tarball }, log);
    const ref = parseGithubRef("github:acme/standards@v1.0.0");

    const dir1 = await ensureRepoCached(ref, { cacheDir, fetchImpl, token: "" });
    expect(dir1).toBe(join(cacheDir, "acme", "standards", "v1.0.0"));
    expect(readFileSync(join(dir1, "hello.txt"), "utf8")).toBe("world\n");
    expect(log.urls).toHaveLength(1);
    expect(log.urls[0]).toBe("https://codeload.github.com/acme/standards/tar.gz/refs/tags/v1.0.0");

    // キャッシュヒット: 再fetchしない
    const dir2 = await ensureRepoCached(ref, { cacheDir, fetchImpl, token: "" });
    expect(dir2).toBe(dir1);
    expect(log.urls).toHaveLength(1);

    // noCache: 破棄して再取得
    const dir3 = await ensureRepoCached(ref, { cacheDir, fetchImpl, token: "", noCache: true });
    expect(dir3).toBe(dir1);
    expect(log.urls).toHaveLength(2);
  });

  it("sends Authorization header only when token is available", async () => {
    const cacheDir = tempDir("gs-cache-auth");
    const tarball = await makeTarball((dir) => write(dir, "x.txt", "x"));
    const log: FetchLog = { urls: [], headers: [] };
    const fetchImpl = makeFetch({ "acme/private@v1.0.0": tarball }, log);

    await ensureRepoCached(parseGithubRef("github:acme/private@v1.0.0"), {
      cacheDir,
      fetchImpl,
      token: "ghp_test_token_value",
    });
    expect(log.headers[0].authorization).toBe("Bearer ghp_test_token_value");

    await ensureRepoCached(parseGithubRef("github:acme/private@v1.0.0"), {
      cacheDir,
      fetchImpl,
      token: "ghp_test_token_value",
      noCache: true,
    });
    expect(log.headers[1].authorization).toBe("Bearer ghp_test_token_value");
  });

  it("throws a clear error on HTTP 404 with token hint", async () => {
    const cacheDir = tempDir("gs-cache-404");
    const fetchImpl = makeFetch({});
    await expect(
      ensureRepoCached(parseGithubRef("github:acme/nope@v9.9.9"), {
        cacheDir,
        fetchImpl,
        token: "",
      }),
    ).rejects.toThrow(/HTTP 404.*GITHUB_TOKEN/);
  });

  it("rejects path traversal entries and leaves no cache behind", async () => {
    const cacheDir = tempDir("gs-cache-evil");
    const tarball = await makeMaliciousTarball();
    const fetchImpl = makeFetch({ "acme/evil@v1.0.0": tarball });
    await expect(
      ensureRepoCached(parseGithubRef("github:acme/evil@v1.0.0"), {
        cacheDir,
        fetchImpl,
        token: "",
      }),
    ).rejects.toThrow(/\.\.|traversal/i);
    // 失敗時にキャッシュ(壊れた展開結果)を残さない
    expect(existsSync(join(cacheDir, "acme", "evil", "v1.0.0"))).toBe(false);
    // キャッシュ外への書き込みが発生していない
    expect(existsSync(join(cacheDir, "..", "evil.txt"))).toBe(false);
  });
});

describe("entry safety / containment", () => {
  it("assertSafeEntry blocks traversal, absolute paths and link entries", () => {
    expect(assertSafeEntry("docs/README.md", "File")).toBe(true);
    expect(assertSafeEntry("a/link", "SymbolicLink")).toBe(false);
    expect(assertSafeEntry("a/hard", "Link")).toBe(false);
    expect(() => assertSafeEntry("../escape.txt", "File")).toThrow(/path traversal/);
    expect(() => assertSafeEntry("a/../../escape.txt", "File")).toThrow(/path traversal/);
    expect(() => assertSafeEntry("/abs/path.txt", "File")).toThrow(/path traversal/);
  });

  it("containedJoin keeps subpaths inside the root", () => {
    const root = tempDir("gs-contain");
    expect(containedJoin(root, "standards")).toBe(join(root, "standards"));
    expect(() => containedJoin(root, "../outside")).toThrow(/escapes repository root/);
    expect(() => containedJoin(root, "a/../../outside")).toThrow(/escapes repository root/);
  });
});

const ORG_PRESET_YAML = `version: 1
target: claude-code
rules:
  - id: org/claude-md-exists
    severity: error
    check: file-exists
    with: { paths: [CLAUDE.md] }
  - id: org/max-lines
    severity: error
    check: max-lines
    with: { path: CLAUDE.md, limit: 100 }
`;

describe("extends github: (E2E with mock HTTP)", () => {
  it("resolves github://path extends and merges rules", async () => {
    const cacheDir = tempDir("gs-e2e-cache");
    const tarball = await makeTarball((dir) => write(dir, "presets/org.yaml", ORG_PRESET_YAML));
    const fetchImpl = makeFetch({ "acme/standards@v1.0.0": tarball });

    const proj = tempDir("gs-e2e-proj");
    write(
      proj,
      "guard.policy.yaml",
      `version: 1
target: claude-code
extends: [ 'github:acme/standards//presets/org.yaml@v1.0.0' ]
rules:
  - id: org/max-lines
    severity: warn
    check: max-lines
    with: { path: CLAUDE.md, limit: 200 }
`,
    );
    const policy = await loadPolicy(join(proj, "guard.policy.yaml"), {
      cacheDir,
      fetchImpl,
      token: "",
    });
    expect(policy.rules.some((r) => r.id === "org/claude-md-exists")).toBe(true);
    expect(policy.rules.find((r) => r.id === "org/max-lines")?.severity).toBe("warn");
  });

  it("defaults to guard.policy.yaml when //path is omitted", async () => {
    const cacheDir = tempDir("gs-e2e-cache2");
    const tarball = await makeTarball((dir) => write(dir, "guard.policy.yaml", ORG_PRESET_YAML));
    const fetchImpl = makeFetch({ "acme/defaults@v1.0.0": tarball });

    const proj = tempDir("gs-e2e-proj2");
    write(
      proj,
      "guard.policy.yaml",
      "version: 1\ntarget: claude-code\nextends: [ 'github:acme/defaults@v1.0.0' ]\nrules: []\n",
    );
    const policy = await loadPolicy(join(proj, "guard.policy.yaml"), {
      cacheDir,
      fetchImpl,
      token: "",
    });
    expect(policy.rules.some((r) => r.id === "org/claude-md-exists")).toBe(true);
  });

  it("resolves 3-layer chain: project → private overlay → OSS base (later wins)", async () => {
    const cacheDir = tempDir("gs-3l-cache");
    const baseTarball = await makeTarball((dir) =>
      write(dir, "presets/base.yaml", ORG_PRESET_YAML),
    );
    const overlayTarball = await makeTarball((dir) =>
      write(
        dir,
        "overlay.yaml",
        `version: 1
target: claude-code
extends: [ 'github:oss/base//presets/base.yaml@v1.0.0' ]
rules:
  - id: org/max-lines
    severity: warn
    check: max-lines
    with: { path: CLAUDE.md, limit: 150 }
  - id: private/no-secret-docs
    severity: error
    check: content-match
    with: { path: 'docs/**/*.md', must_not: ['CONFIDENTIAL'] }
`,
      ),
    );
    const fetchImpl = makeFetch({
      "oss/base@v1.0.0": baseTarball,
      "acme/overlay@v2.0.0": overlayTarball,
    });

    const proj = tempDir("gs-3l-proj");
    write(
      proj,
      "guard.policy.yaml",
      `version: 1
target: claude-code
extends: [ 'github:acme/overlay//overlay.yaml@v2.0.0' ]
rules: []
`,
    );
    const policy = await loadPolicy(join(proj, "guard.policy.yaml"), {
      cacheDir,
      fetchImpl,
      token: "",
    });
    // Layer1 (OSS base) のルールが多段解決で届く
    expect(policy.rules.some((r) => r.id === "org/claude-md-exists")).toBe(true);
    // Layer2 (private overlay) の上書きと追加
    expect(policy.rules.find((r) => r.id === "org/max-lines")?.severity).toBe("warn");
    expect(policy.rules.some((r) => r.id === "private/no-secret-docs")).toBe(true);
  });

  it("raises clear error when //path does not exist in the repo", async () => {
    const cacheDir = tempDir("gs-e2e-cache3");
    const tarball = await makeTarball((dir) => write(dir, "README.md", "empty"));
    const fetchImpl = makeFetch({ "acme/standards@v1.0.0": tarball });
    const proj = tempDir("gs-e2e-proj3");
    write(
      proj,
      "guard.policy.yaml",
      "version: 1\ntarget: claude-code\nextends: [ 'github:acme/standards//presets/nope.yaml@v1.0.0' ]\nrules: []\n",
    );
    await expect(
      loadPolicy(join(proj, "guard.policy.yaml"), { cacheDir, fetchImpl, token: "" }),
    ).rejects.toThrow(/not found in acme\/standards@v1\.0\.0/);
  });
});

describe("drift source github: (E2E with mock HTTP)", () => {
  it("resolves github://path source to cached file: and detects drift", async () => {
    const cacheDir = tempDir("gs-drift-cache");
    const masterSkill = "intro\n## 手順\nstep1\n## PJ固有手順\n(ここに追記)\n";
    const tarball = await makeTarball((dir) => {
      write(dir, "standards/.claude/skills/start-task/SKILL.md", masterSkill);
      write(dir, "standards/.claude/skills/finish-task/SKILL.md", masterSkill);
    });
    const fetchImpl = makeFetch({ "novexar/guardsmith@v0.1.0": tarball });

    const proj = tempDir("gs-drift-proj");
    // start-task は許可セクションのみ編集 / finish-task は標準節を改変(違反)
    write(
      proj,
      ".claude/skills/start-task/SKILL.md",
      "intro\n## 手順\nstep1\n## PJ固有手順\nPJ独自の追記\n",
    );
    write(
      proj,
      ".claude/skills/finish-task/SKILL.md",
      "intro\n## 手順\n改変してしまった\n## PJ固有手順\n(ここに追記)\n",
    );
    write(
      proj,
      "guard.policy.yaml",
      `version: 1
target: claude-code
rules:
  - id: drift/skills-sync
    severity: warn
    check: drift
    with:
      source: github:novexar/guardsmith//standards@v0.1.0
      paths: ['.claude/skills/**']
      allow_sections: ['## PJ固有手順']
`,
    );

    const policy = await loadPolicy(join(proj, "guard.policy.yaml"), {
      cacheDir,
      fetchImpl,
      token: "",
    });
    const drift = policy.rules.find((r) => r.id === "drift/skills-sync");
    expect(drift?.check === "drift" && drift.with.source.startsWith("file:")).toBe(true);

    const result = await runLint(policy, proj);
    const findings = result.findings.filter((f) => f.ruleId === "drift/skills-sync");
    expect(findings.some((f) => f.file?.includes("start-task"))).toBe(false);
    expect(
      findings.some((f) => f.file?.includes("finish-task") && f.message.includes("## 手順")),
    ).toBe(true);
  });
});

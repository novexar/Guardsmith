/**
 * import-budget check の検証。
 * CLAUDE.md の `@` インポートを再帰解決し、起動時に常駐する総量を測る。
 */
import { existsSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { parse } from "yaml";
import {
  extractImportRefs,
  isInsideRoot,
  maskCodeSpans,
  realRoot,
  resolveImportRef,
} from "../src/import-budget.js";
import { runLint, type Finding } from "../src/lint.js";
import { parsePolicy } from "../src/schema.js";
import { makeFixtureDir, REPO_ROOT, write } from "./helpers.js";

const dirs: string[] = [];

function fixture(prefix: string): string {
  const d = makeFixtureDir(prefix);
  dirs.push(d);
  return d;
}

afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/**
 * ディレクトリ junction を作れる環境か。Windows でもファイルのシンボリックリンクと違い
 * 権限が不要なため、リンク経由の検証はこちらで行う。作れない環境では skip として明示する。
 */
const CAN_JUNCTION = ((): boolean => {
  const probe = makeFixtureDir("gs-ib-junction-probe");
  try {
    write(probe, "d/t.md", "x");
    symlinkSync(join(probe, "d"), join(probe, "l"), "junction");
    return true;
  } catch {
    return false;
  } finally {
    rmSync(probe, { recursive: true, force: true });
  }
})();

/** 大文字小文字を区別しないファイルシステムか(Windows / 既定の macOS) */
const CASE_INSENSITIVE_FS = ((): boolean => {
  const probe = makeFixtureDir("gs-ib-case-probe");
  try {
    write(probe, "lower.md", "x");
    return existsSync(join(probe, "LOWER.MD"));
  } catch {
    return false;
  } finally {
    rmSync(probe, { recursive: true, force: true });
  }
})();

interface RuleOptions {
  path?: string;
  max_chars?: number;
  max_depth?: number;
  severity?: "error" | "warn" | "info";
}

/** import-budget ルール1本だけの lint を回す */
async function lint(root: string, options: RuleOptions = {}): Promise<Finding[]> {
  const parsed = parsePolicy({
    version: 1,
    target: "claude-code",
    rules: [
      {
        id: "t/budget",
        severity: options.severity ?? "warn",
        check: "import-budget",
        with: {
          path: options.path ?? "CLAUDE.md",
          ...(options.max_chars === undefined ? {} : { max_chars: options.max_chars }),
          ...(options.max_depth === undefined ? {} : { max_depth: options.max_depth }),
        },
      },
    ],
  });
  if (!parsed.ok) throw new Error(parsed.errors.join("; "));
  const res = await runLint(parsed.policy, root);
  return res.findings;
}

/** 常に1件出る内訳 info */
function summary(findings: Finding[]): Finding {
  const s = findings.filter((f) => f.message.startsWith("resident context:"));
  expect(s).toHaveLength(1);
  return s[0];
}

function totalChars(f: Finding): number {
  const m = /resident context: (\d+) files, (\d+) chars/.exec(f.message);
  if (!m) throw new Error(`unexpected summary message: ${f.message}`);
  return Number(m[2]);
}

function fileCount(f: Finding): number {
  const m = /resident context: (\d+) files/.exec(f.message);
  if (!m) throw new Error(`unexpected summary message: ${f.message}`);
  return Number(m[1]);
}

/* ---------- schema ---------- */

describe("import-budget schema", () => {
  const rule = (w: object) => ({
    version: 1,
    target: "claude-code",
    rules: [{ id: "a/b", severity: "warn", check: "import-budget", with: w }],
  });

  it("accepts path only", () => {
    expect(parsePolicy(rule({ path: "CLAUDE.md" })).ok).toBe(true);
  });

  it("accepts max_chars / max_depth", () => {
    expect(parsePolicy(rule({ path: "CLAUDE.md", max_chars: 32000, max_depth: 4 })).ok).toBe(true);
  });

  it("rejects an unknown key in with (strict)", () => {
    const r = parsePolicy(rule({ path: "CLAUDE.md", maxChars: 100 }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join("; ")).toContain("maxChars");
  });

  it("rejects missing path", () => {
    expect(parsePolicy(rule({ max_chars: 100 })).ok).toBe(false);
  });

  it("rejects non-positive / non-integer max_chars", () => {
    expect(parsePolicy(rule({ path: "CLAUDE.md", max_chars: 0 })).ok).toBe(false);
    expect(parsePolicy(rule({ path: "CLAUDE.md", max_chars: -1 })).ok).toBe(false);
    expect(parsePolicy(rule({ path: "CLAUDE.md", max_chars: 1.5 })).ok).toBe(false);
  });

  it("rejects non-positive max_depth", () => {
    expect(parsePolicy(rule({ path: "CLAUDE.md", max_depth: 0 })).ok).toBe(false);
  });
});

/* ---------- 集計 ---------- */

describe("import-budget totals", () => {
  it("sums the entry file and its imports, and reports a rough token estimate", async () => {
    const root = fixture("gs-ib-sum");
    const body = "# root\n@docs/a.md\n"; // 17 chars
    const a = "A".repeat(100);
    write(root, "CLAUDE.md", body);
    write(root, "docs/a.md", a);

    const s = summary(await lint(root));
    expect(s.severity).toBe("info");
    expect(s.file).toBe("CLAUDE.md");
    expect(fileCount(s)).toBe(2);
    expect(totalChars(s)).toBe(body.length + a.length);
    expect(s.message).toContain(`≈${Math.ceil((body.length + a.length) / 4)} tokens`);
    expect(s.message).toContain("rough");
    // ファイル別内訳
    expect(s.message).toContain("docs/a.md: 100");
    expect(s.message).toContain(`CLAUDE.md: ${body.length}`);
  });

  it("resolves imports recursively", async () => {
    const root = fixture("gs-ib-rec");
    write(root, "CLAUDE.md", "@a.md");
    write(root, "a.md", "@b.md");
    write(root, "b.md", "xyz");

    const s = summary(await lint(root));
    expect(fileCount(s)).toBe(3);
    expect(totalChars(s)).toBe(5 + 5 + 3);
  });

  it("counts a file imported twice only once", async () => {
    const root = fixture("gs-ib-dup");
    write(root, "CLAUDE.md", "@a.md and @a.md and @b.md\n");
    write(root, "a.md", "AAAA");
    write(root, "b.md", "@a.md"); // 別ファイル経由でも重複しない
    const s = summary(await lint(root));
    expect(fileCount(s)).toBe(3);
    expect(totalChars(s)).toBe(26 + 4 + 5);
  });

  it("emits one summary per matched entry file (glob)", async () => {
    const root = fixture("gs-ib-glob");
    write(root, "a/CLAUDE.md", "a");
    write(root, "b/CLAUDE.md", "b");
    const findings = await lint(root, { path: "**/CLAUDE.md" });
    const sums = findings.filter((f) => f.message.startsWith("resident context:"));
    expect(sums.map((f) => f.file).sort()).toEqual(["a/CLAUDE.md", "b/CLAUDE.md"]);
  });

  it("reports info when no file matches the path", async () => {
    const root = fixture("gs-ib-nomatch");
    write(root, "other.md", "x");
    const findings = await lint(root);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("info");
    expect(findings[0].message).toContain("no files matched");
  });
});

/* ---------- 構文 ---------- */

describe("import-budget syntax", () => {
  it("picks up @ mid-sentence and inside a table cell", async () => {
    const root = fixture("gs-ib-syntax");
    write(
      root,
      "CLAUDE.md",
      [
        "See @docs/a.md for details.",
        "",
        "| doc | ref |",
        "| --- | --- |",
        "| x | @docs/b.md |",
      ].join("\n"),
    );
    write(root, "docs/a.md", "A");
    write(root, "docs/b.md", "B");
    const s = summary(await lint(root));
    expect(fileCount(s)).toBe(3);
    expect(s.message).toContain("docs/a.md");
    expect(s.message).toContain("docs/b.md");
  });

  it("ignores @ inside code spans and fenced code blocks", async () => {
    const root = fixture("gs-ib-code");
    write(
      root,
      "CLAUDE.md",
      [
        "Write `@docs/span.md` to import it.",
        "",
        "```md",
        "@docs/fence.md",
        "```",
        "",
        "@docs/real.md",
      ].join("\n"),
    );
    write(root, "docs/span.md", "S");
    write(root, "docs/fence.md", "F");
    write(root, "docs/real.md", "R");
    const findings = await lint(root);
    const s = summary(findings);
    expect(fileCount(s)).toBe(2);
    expect(s.message).toContain("docs/real.md");
    expect(s.message).not.toContain("docs/span.md");
    expect(s.message).not.toContain("docs/fence.md");
  });

  it("ignores an email address but still sees an import on the same line", async () => {
    const root = fixture("gs-ib-mail");
    write(root, "docs/a.md", "A");
    write(root, "CLAUDE.md", "contact user@example.com\na@b.co and @docs/a.md\n");
    const findings = await lint(root);
    const s = summary(findings);
    expect(fileCount(s)).toBe(2);
    expect(s.message).toContain("docs/a.md");
    expect(s.message).not.toContain("example.com");
    expect(findings.some((f) => f.message.includes("b.co"))).toBe(false);
  });

  it("detects @ without a preceding space (markdown and Japanese prose)", async () => {
    const root = fixture("gs-ib-adjacent");
    for (const n of ["paren", "bold", "link", "ja1"]) write(root, `docs/${n}.md`, n);
    write(
      root,
      "CLAUDE.md",
      [
        "see (@docs/paren.md) for detail",
        "**@docs/bold.md**",
        "[link](@docs/link.md)",
        "詳細は@docs/ja1.md、および@docs/ja2.mdを参照",
      ].join("\n"),
    );
    const findings = await lint(root);
    const s = summary(findings);
    expect(fileCount(s)).toBe(5); // CLAUDE.md + 4
    for (const n of ["paren", "bold", "link", "ja1"]) {
      expect(s.message).toContain(`docs/${n}.md`);
    }
    // 助詞が続いた `@docs/ja2.mdを参照` はパス形状でないため unresolved を出さない
    expect(findings.filter((f) => f.message.startsWith("unresolved import:"))).toHaveLength(0);
  });

  it("skips a fence nested inside a list item but keeps indented list content", async () => {
    const root = fixture("gs-ib-nested-fence");
    write(root, "docs/x.md", "X");
    write(root, "docs/after.md", "A");
    write(
      root,
      "CLAUDE.md",
      [
        "- item",
        "    ```",
        "    @docs/in-fence.md",
        "    ```",
        "- outer",
        "    - nested list item with @docs/x.md", // 4 スペースはコードブロックにしない
        "",
        "@docs/after.md",
      ].join("\n"),
    );
    const findings = await lint(root);
    const s = summary(findings);
    expect(fileCount(s)).toBe(3); // CLAUDE.md + x.md + after.md
    expect(s.message).toContain("docs/x.md");
    expect(s.message).toContain("docs/after.md");
    expect(findings.some((f) => f.message.includes("in-fence"))).toBe(false);
  });

  it("masks a code span that spans two lines of the same paragraph", async () => {
    const root = fixture("gs-ib-multiline-span");
    write(root, "docs/real.md", "R");
    write(
      root,
      "CLAUDE.md",
      ["start `code", "@inside.md` end", "@docs/real.md", "", "unclosed ` and @docs/real.md"].join(
        "\n",
      ),
    );
    const findings = await lint(root);
    const s = summary(findings);
    expect(fileCount(s)).toBe(2); // CLAUDE.md + docs/real.md
    expect(findings.some((f) => f.message.includes("inside.md"))).toBe(false);
  });

  it("reports a repeated unresolved reference only once", async () => {
    const root = fixture("gs-ib-repeat");
    write(root, "CLAUDE.md", "@types/node here\nand @types/node again\nplus @types/node\n");
    const findings = await lint(root);
    const u = findings.filter((f) => f.message.startsWith("unresolved import:"));
    expect(u).toHaveLength(1);
    expect(u[0].line).toBe(1);
  });

  it("still reports an unresolved path-shaped reference, including a non-ASCII filename", async () => {
    const root = fixture("gs-ib-unresolved-shape");
    write(root, "CLAUDE.md", "@docs/日本語.md\n@types\n@docs/Y.mdを参照\n");
    const findings = await lint(root);
    const unresolved = findings.filter((f) => f.message.startsWith("unresolved import:"));
    expect(unresolved).toHaveLength(1);
    expect(unresolved[0].message).toContain("docs/日本語.md");
  });
});

/* ---------- パス解決 ---------- */

describe("import-budget path resolution", () => {
  it("resolves relative imports against the importing file's directory", async () => {
    const root = fixture("gs-ib-rel");
    write(root, "sub/CLAUDE.md", "@../shared.md\n");
    write(root, "shared.md", "SHARED");
    const findings = await lint(root, { path: "sub/CLAUDE.md" });
    const s = summary(findings);
    expect(fileCount(s)).toBe(2);
    expect(s.message).toContain("shared.md: 6");
    expect(findings.some((f) => f.message.includes("outside root"))).toBe(false);
  });

  it("does not read references outside the root", async () => {
    const root = fixture("gs-ib-outside");
    write(root, "CLAUDE.md", "@../escape.md\n@~/.claude/CLAUDE.md\n@/etc/passwd\n");
    const findings = await lint(root);
    const outside = findings.filter((f) => f.message.includes("outside root, not measured"));
    expect(outside).toHaveLength(3);
    for (const f of outside) {
      expect(f.severity).toBe("info");
      expect(f.file).toBe("CLAUDE.md");
    }
    expect(outside.map((f) => f.line)).toEqual([1, 2, 3]);
    expect(fileCount(summary(findings))).toBe(1);
  });

  it("never resolves a backslash reference (Windows path traversal)", async () => {
    const root = fixture("gs-ib-backslash");
    write(root, "secret.md", "SECRET"); // root 直下の囮
    write(
      root,
      "docs/CLAUDE.md",
      "@docs\\..\\..\\secret.md\n@..\\x.md\n@C:\\x\n@\\\\server\\share\n",
    );
    const findings = await lint(root, { path: "docs/CLAUDE.md" });
    const outside = findings.filter((f) => f.message.includes("outside root, not measured"));
    expect(outside).toHaveLength(4);
    expect(outside.map((f) => f.line)).toEqual([1, 2, 3, 4]);
    // 起点のみ。secret.md も root 外も読み込まれていない
    expect(fileCount(summary(findings))).toBe(1);
  });

  // ディレクトリ junction は Windows でも権限不要なので、リンク経由の検証はこちらで行う
  it.skipIf(!CAN_JUNCTION)(
    "does not follow a directory link pointing outside the root",
    async () => {
      const root = fixture("gs-ib-junction-out");
      const outsideDir = fixture("gs-ib-junction-target");
      write(outsideDir, "secret.md", "SECRET-OUTSIDE");
      write(root, "CLAUDE.md", "@link/secret.md\n");
      symlinkSync(outsideDir, join(root, "link"), "junction");
      const findings = await lint(root);
      const outside = findings.filter((f) => f.message.includes("outside root, not measured"));
      expect(outside).toHaveLength(1);
      expect(outside[0].severity).toBe("info");
      expect(fileCount(summary(findings))).toBe(1);
      expect(summary(findings).message).not.toContain("SECRET-OUTSIDE");
    },
  );

  it.skipIf(!CAN_JUNCTION)("follows a directory link that stays inside the root", async () => {
    const root = fixture("gs-ib-junction-in");
    write(root, "docs/real.md", "INSIDE");
    write(root, "CLAUDE.md", "@link/real.md\n");
    symlinkSync(join(root, "docs"), join(root, "link"), "junction");
    const s = summary(await lint(root));
    expect(fileCount(s)).toBe(2);
    expect(totalChars(s)).toBe(14 + 6);
  });

  it.skipIf(!CAN_JUNCTION)("counts a file reached through a link alias only once", async () => {
    const root = fixture("gs-ib-junction-alias");
    write(root, "docs/real.md", "INSIDE");
    write(root, "CLAUDE.md", "@docs/real.md\n@link/real.md\n");
    symlinkSync(join(root, "docs"), join(root, "link"), "junction");
    const s = summary(await lint(root));
    expect(fileCount(s)).toBe(2); // CLAUDE.md + real.md(別名でも1回)
    expect(totalChars(s)).toBe(28 + 6);
  });

  it.skipIf(!CASE_INSENSITIVE_FS)("counts a case-variant alias only once", async () => {
    const root = fixture("gs-ib-case");
    write(root, "docs/a.md", "AAAAA");
    write(root, "CLAUDE.md", "@docs/a.md\n@docs/A.MD\n");
    const findings = await lint(root);
    const s = summary(findings);
    expect(fileCount(s)).toBe(2);
    expect(totalChars(s)).toBe(22 + 5);
    expect(findings.filter((f) => f.message.startsWith("unresolved import:"))).toHaveLength(0);
  });

  it("reports unresolved imports with file and line", async () => {
    const root = fixture("gs-ib-unresolved");
    write(root, "CLAUDE.md", "intro\n@docs/missing.md\n");
    const findings = await lint(root);
    const u = findings.filter((f) => f.message.startsWith("unresolved import:"));
    expect(u).toHaveLength(1);
    expect(u[0].severity).toBe("info");
    expect(u[0].message).toBe("unresolved import: docs/missing.md (from CLAUDE.md:2)");
    expect(u[0].line).toBe(2);
    expect(fileCount(summary(findings))).toBe(1);
  });

  it("treats a directory reference as unresolved", async () => {
    const root = fixture("gs-ib-dir");
    write(root, "docs/inner/a.md", "A");
    write(root, "CLAUDE.md", "@docs/inner\n");
    const findings = await lint(root);
    expect(findings.some((f) => f.message.startsWith("unresolved import: docs/inner"))).toBe(true);
    expect(fileCount(summary(findings))).toBe(1);
  });
});

/* ---------- 循環・深さ ---------- */

describe("import-budget cycles and depth", () => {
  it("detects a cycle without hanging", async () => {
    const root = fixture("gs-ib-cycle");
    write(root, "CLAUDE.md", "@a.md");
    write(root, "a.md", "@b.md");
    write(root, "b.md", "@a.md");
    const findings = await lint(root);
    const cycle = findings.filter((f) => f.message.startsWith("import cycle detected:"));
    expect(cycle).toHaveLength(1);
    expect(cycle[0].severity).toBe("info");
    expect(cycle[0].file).toBe("b.md");
    expect(fileCount(summary(findings))).toBe(3);
  });

  it("detects self-import as a cycle", async () => {
    const root = fixture("gs-ib-self");
    write(root, "CLAUDE.md", "@CLAUDE.md");
    const findings = await lint(root);
    expect(findings.some((f) => f.message.startsWith("import cycle detected:"))).toBe(true);
    expect(fileCount(summary(findings))).toBe(1);
  });

  it("stops at max_depth and reports it", async () => {
    const root = fixture("gs-ib-depth");
    write(root, "CLAUDE.md", "@a.md");
    write(root, "a.md", "@b.md");
    write(root, "b.md", "@c.md");
    write(root, "c.md", "C");
    const findings = await lint(root, { max_depth: 2 });
    const over = findings.filter((f) => f.message.includes("import depth limit"));
    expect(over).toHaveLength(1);
    expect(over[0].severity).toBe("info");
    expect(over[0].file).toBe("b.md");
    expect(over[0].message).toContain("max_depth: 2");
    // CLAUDE.md + a.md + b.md のみ(c.md は未計測)
    expect(fileCount(summary(findings))).toBe(3);
  });

  it("re-descends when a file is reached again by a shallower path", async () => {
    // 深い経路(a1→a2→a3→shared)を先に辿ると shared の子は上限で打ち切られるが、
    // shallow 経由なら shared は 2 hop・child は 3 hop なので Claude Code は読み込む
    const root = fixture("gs-ib-shallower");
    write(root, "CLAUDE.md", "@a1.md\n@shallow.md\n");
    write(root, "a1.md", "@a2.md");
    write(root, "a2.md", "@a3.md");
    write(root, "a3.md", "@shared.md");
    write(root, "shallow.md", "@shared.md");
    write(root, "shared.md", "@child.md");
    write(root, "child.md", "C".repeat(9999));

    const findings = await lint(root);
    const s = summary(findings);
    expect(s.message).toContain("child.md: 9999 chars");
    expect(fileCount(s)).toBe(7); // CLAUDE.md, a1..a3, shallow, shared, child
    expect(totalChars(s)).toBeGreaterThan(9999);
    // 浅い経路で測れたので「深すぎる」報告は残らない
    expect(findings.some((f) => f.message.includes("import depth limit"))).toBe(false);
  });

  it("still counts a shared file only once when reached twice", async () => {
    const root = fixture("gs-ib-shared-once");
    write(root, "CLAUDE.md", "@x.md\n@y.md\n");
    write(root, "x.md", "@shared.md");
    write(root, "y.md", "@shared.md");
    write(root, "shared.md", "S".repeat(10));
    const s = summary(await lint(root));
    expect(fileCount(s)).toBe(4);
    expect(totalChars(s)).toBe(12 + 10 + 10 + 10);
  });

  it("defaults max_depth to the documented 4 hops", async () => {
    const root = fixture("gs-ib-depth-default");
    write(root, "CLAUDE.md", "@a.md");
    write(root, "a.md", "@b.md");
    write(root, "b.md", "@c.md");
    write(root, "c.md", "@d.md");
    write(root, "d.md", "@e.md"); // 5 hop目 = 上限超過
    write(root, "e.md", "E");
    const findings = await lint(root);
    const over = findings.filter((f) => f.message.includes("import depth limit"));
    expect(over).toHaveLength(1);
    expect(over[0].message).toContain("max_depth: 4");
    expect(fileCount(summary(findings))).toBe(5); // CLAUDE.md + a..d
  });
});

/* ---------- max_chars ---------- */

describe("import-budget max_chars", () => {
  it("fires at the rule severity when the budget is exceeded", async () => {
    const root = fixture("gs-ib-over");
    write(root, "CLAUDE.md", "@big.md");
    write(root, "big.md", "X".repeat(500));
    const findings = await lint(root, { max_chars: 100, severity: "error" });
    const over = findings.filter((f) => f.message.includes("exceeds max_chars"));
    expect(over).toHaveLength(1);
    expect(over[0].severity).toBe("error");
    expect(over[0].file).toBe("CLAUDE.md");
    expect(over[0].message).toBe("resident context 507 chars exceeds max_chars 100 (2 files)");
  });

  it("emits only the info summary when within budget", async () => {
    const root = fixture("gs-ib-under");
    write(root, "CLAUDE.md", "@small.md");
    write(root, "small.md", "x");
    const findings = await lint(root, { max_chars: 10_000 });
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("info");
  });

  it("emits no severity finding when max_chars is omitted", async () => {
    const root = fixture("gs-ib-nolimit");
    write(root, "CLAUDE.md", "X".repeat(100_000));
    const findings = await lint(root);
    expect(findings.every((f) => f.severity === "info")).toBe(true);
  });

  it("truncates the breakdown to the top 10 files", async () => {
    const root = fixture("gs-ib-many");
    const refs: string[] = [];
    for (let i = 0; i < 13; i++) {
      write(root, `d/f${i}.md`, "Z".repeat(100 + i));
      refs.push(`@d/f${i}.md`);
    }
    write(root, "CLAUDE.md", refs.join("\n"));
    const s = summary(await lint(root));
    expect(s.message).toContain("others");
    // 上位10件のみ列挙(内訳行 = 10 + others 行)
    const breakdown = s.message.split("\n").filter((l) => /: \d+ chars$/.test(l));
    expect(breakdown).toHaveLength(10);
    expect(s.message).toContain("d/f12.md"); // 最大のファイルは必ず載る
  });
});

/* ---------- .gitignore ---------- */

describe("import-budget and .gitignore", () => {
  it("skips gitignored entry files but still reads gitignored import targets", async () => {
    const root = fixture("gs-ib-gitignore");
    write(root, ".gitignore", "secret/\nlocal.md\n");
    write(root, "CLAUDE.md", "@local.md\n");
    write(root, "local.md", "LOCAL");
    write(root, "secret/CLAUDE.md", "S");
    const findings = await lint(root, { path: "**/CLAUDE.md" });
    const sums = findings.filter((f) => f.message.startsWith("resident context:"));
    expect(sums.map((f) => f.file)).toEqual(["CLAUDE.md"]); // secret/ は列挙されない
    expect(fileCount(sums[0])).toBe(2); // 明示参照された local.md は読む
    expect(sums[0].message).toContain("local.md: 5");
  });
});

/* ---------- プリセット ---------- */

describe("presets carry the import-budget rule", () => {
  for (const preset of ["presets/baseline.yaml", "presets/self.yaml"]) {
    it(`parses ${preset} and includes claude-md/import-budget`, () => {
      const doc = parse(readFileSync(resolve(REPO_ROOT, preset), "utf8"));
      const r = parsePolicy(doc);
      expect(r.ok, r.ok ? "" : r.errors.join("; ")).toBe(true);
      if (!r.ok) return;
      const rule = r.policy.rules.find((x) => x.id === "claude-md/import-budget");
      expect(rule?.check).toBe("import-budget");
      expect(rule?.severity).toBe("warn");
    });
  }

  it("measures this repository's own CLAUDE.md (@docs/LAYERING.md is resident)", async () => {
    const parsed = parsePolicy(
      parse(readFileSync(resolve(REPO_ROOT, "presets/self.yaml"), "utf8")),
    );
    if (!parsed.ok) throw new Error(parsed.errors.join("; "));
    const res = await runLint(parsed.policy, REPO_ROOT);
    const s = res.findings.filter(
      (f) => f.ruleId === "claude-md/import-budget" && f.message.startsWith("resident context:"),
    );
    expect(s).toHaveLength(1);
    expect(fileCount(s[0])).toBe(2);
    expect(s[0].message).toContain("docs/LAYERING.md");
    // 閾値内であること(超過するなら閾値か CLAUDE.md を見直す)
    expect(
      res.findings.some(
        (f) => f.ruleId === "claude-md/import-budget" && f.message.includes("exceeds max_chars"),
      ),
    ).toBe(false);
  });
});

/* ---------- パーサ単体 ---------- */

describe("import parsing internals", () => {
  it("leaves an unclosed backtick run untouched", () => {
    expect(maskCodeSpans("a ` b @x.md")).toBe("a ` b @x.md");
    expect(extractImportRefs("a ` b @x.md").map((r) => r.ref)).toEqual(["x.md"]);
  });

  it("matches a code span by exact backtick run length", () => {
    // 内側の ` は閉じ(長さ2)にならないため、`` ... `` 全体が1つのスパン
    expect(maskCodeSpans("``a ` @x.md``")).toBe(" ".repeat(13));
    expect(extractImportRefs("``a ` @x.md`` and @y.md").map((r) => r.ref)).toEqual(["y.md"]);
  });

  it("skips a tilde-fenced block", () => {
    const refs = extractImportRefs(["~~~", "@in-fence.md", "~~~", "@after.md"].join("\n"));
    expect(refs.map((r) => r.ref)).toEqual(["after.md"]);
  });

  it("does not close a fence on a line carrying an info string", () => {
    const refs = extractImportRefs(["```", "@a.md", "``` trailing", "@b.md"].join("\n"));
    expect(refs).toEqual([]);
  });

  it("drops trailing punctuation and stops at full-width parentheses", () => {
    expect(extractImportRefs("see @docs/a.md.").map((r) => r.ref)).toEqual(["docs/a.md"]);
    expect(extractImportRefs("| x | @vitest/coverage-v8(80%) |").map((r) => r.ref)).toEqual([
      "vitest/coverage-v8",
    ]);
  });

  it("resolves refs relative to the importing file and rejects escapes", () => {
    expect(resolveImportRef("b.md", "docs/a.md")).toBe("docs/b.md");
    expect(resolveImportRef("./sub/../b.md", "docs/a.md")).toBe("docs/b.md");
    expect(resolveImportRef("../b.md", "docs/a.md")).toBe("b.md");
    expect(resolveImportRef("../../b.md", "docs/a.md")).toBeNull();
    expect(resolveImportRef("~/x.md", "CLAUDE.md")).toBeNull();
    expect(resolveImportRef("/etc/passwd", "CLAUDE.md")).toBeNull();
    expect(resolveImportRef("C:/win.md", "CLAUDE.md")).toBeNull();
    expect(resolveImportRef(".", "CLAUDE.md")).toBeNull();
  });

  it("treats the root boundary as separator-delimited", () => {
    const root = join("C:", "repo");
    expect(isInsideRoot(root, join(root, "docs", "a.md"))).toBe(true);
    expect(isInsideRoot(root, root)).toBe(false); // root 自身はファイルではない
    expect(isInsideRoot(root, `${root}2${sep}a.md`)).toBe(false); // repo2 を repo 配下にしない
    expect(isInsideRoot(root, join("C:", "other", "a.md"))).toBe(false);
    // 末尾に区切りが付いた root でも同じ判定になる
    expect(isInsideRoot(root + sep, join(root, "a.md"))).toBe(true);
  });

  it("realRoot falls back to the absolute path for a missing directory", () => {
    const missing = join(makeFixtureDir("gs-ib-realroot"), "nope");
    expect(realRoot(missing)).toBe(missing);
  });

  it("rejects every backslash form (Windows separators are not spec syntax)", () => {
    expect(resolveImportRef("docs\\..\\..\\secret.md", "docs/CLAUDE.md")).toBeNull();
    expect(resolveImportRef("..\\x.md", "CLAUDE.md")).toBeNull();
    expect(resolveImportRef("C:\\x", "CLAUDE.md")).toBeNull();
    expect(resolveImportRef("\\\\server\\share", "CLAUDE.md")).toBeNull();
    expect(resolveImportRef("docs\\a.md", "CLAUDE.md")).toBeNull();
  });
});

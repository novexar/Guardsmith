/**
 * import-budget check の検証。
 * CLAUDE.md の `@` インポートを再帰解決し、起動時に常駐する総量を測る。
 */
import { readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { extractImportRefs, maskCodeSpans, resolveImportRef } from "../src/import-budget.js";
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

  // 既知の制約: Rule は `discriminatedUnion(...).and(RuleBase)` で組んでおり、zod 4 の
  // intersection を通ると branch 側 `.strict()` の未知キー拒否が失われる(既存8 check も同様に
  // 素通りする)。import-budget だけ挙動を変えないことをここで固定する。
  // 全 check 横断の仕様判断のため docs/decisions-needed.md に起票した。
  it("treats unknown keys in with the same way as the existing checks", () => {
    expect(parsePolicy(rule({ path: "CLAUDE.md", maxChars: 100 })).ok).toBe(true);
    expect(
      parsePolicy({
        version: 1,
        target: "claude-code",
        rules: [
          {
            id: "a/b",
            severity: "warn",
            check: "max-lines",
            with: { path: "x", limit: 1, bogus: 2 },
          },
        ],
      }).ok,
    ).toBe(true);
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

  it("ignores an email-like address (not preceded by whitespace)", async () => {
    const root = fixture("gs-ib-mail");
    write(root, "CLAUDE.md", "contact me@example.com\n");
    const s = summary(await lint(root));
    expect(fileCount(s)).toBe(1);
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
    write(root, "docs/a.md", "A");
    write(root, "CLAUDE.md", "@docs\n");
    const findings = await lint(root);
    expect(findings.some((f) => f.message.startsWith("unresolved import: docs"))).toBe(true);
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
});

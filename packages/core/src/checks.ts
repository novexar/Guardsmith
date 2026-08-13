/**
 * aidev-guard checks v0.1 — 残り5種の実装
 * file-absent / max-lines / frontmatter / json-path / drift
 */
import { readFileSync, existsSync } from "node:fs";
import fg from "fast-glob";
import { parse as parseYaml } from "yaml";
import { JSONPath } from "jsonpath-plus";
import type { Rule } from "./schema.js";
import type { Finding } from "./lint.js";

/* ---------- file-absent ---------- */

export async function checkFileAbsent(
  rule: Extract<Rule, { check: "file-absent" }>,
  root: string,
): Promise<Finding[]> {
  const findings: Finding[] = [];
  for (const p of rule.with.paths) {
    const hits = await fg(p, { cwd: root, dot: true });
    for (const file of hits) {
      findings.push({
        ruleId: rule.id,
        severity: rule.severity,
        file,
        message: `forbidden file exists: ${file}`,
      });
    }
  }
  return findings;
}

/* ---------- max-lines ---------- */

export async function checkMaxLines(
  rule: Extract<Rule, { check: "max-lines" }>,
  root: string,
): Promise<Finding[]> {
  const findings: Finding[] = [];
  const files = await fg(rule.with.path, { cwd: root, dot: true });
  for (const file of files) {
    const lines = readFileSync(`${root}/${file}`, "utf8").split("\n").length;
    if (lines > rule.with.limit) {
      findings.push({
        ruleId: rule.id,
        severity: rule.severity,
        file,
        message: `file has ${lines} lines (limit: ${rule.with.limit})`,
      });
    }
  }
  return findings;
}

/* ---------- frontmatter ---------- */

/** 先頭の --- ... --- ブロックをYAMLとして抽出。無ければ null */
export function extractFrontmatter(text: string): Record<string, unknown> | null {
  const m = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/.exec(text);
  if (!m) return null;
  try {
    const parsed = parseYaml(m[1]);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export async function checkFrontmatter(
  rule: Extract<Rule, { check: "frontmatter" }>,
  root: string,
): Promise<Finding[]> {
  const findings: Finding[] = [];
  const files = await fg(rule.with.paths, { cwd: root, dot: true });
  for (const file of files) {
    const fm = extractFrontmatter(readFileSync(`${root}/${file}`, "utf8"));
    if (fm === null) {
      findings.push({
        ruleId: rule.id,
        severity: rule.severity,
        file,
        message: "frontmatter block (--- ... ---) is missing or invalid YAML",
      });
      continue;
    }
    for (const key of rule.with.required) {
      if (!(key in fm) || fm[key] === null || fm[key] === "") {
        findings.push({
          ruleId: rule.id,
          severity: rule.severity,
          file,
          message: `frontmatter key missing or empty: ${key}`,
        });
      }
    }
    for (const [key, pattern] of Object.entries(rule.with.schema ?? {})) {
      const v = fm[key];
      if (v !== undefined && !new RegExp(pattern).test(String(v))) {
        findings.push({
          ruleId: rule.id,
          severity: rule.severity,
          file,
          message: `frontmatter '${key}' does not match /${pattern}/`,
        });
      }
    }
  }
  return findings;
}

/* ---------- json-path ---------- */
/**
 * assertセマンティクス:
 *  - exists: クエリ結果が1件以上 / absent: 0件
 *  - eq/matches: すべての結果が条件を満たす(満たさない値=違反)
 *  - ne/not-matches: いかなる結果も条件に該当しない(該当する値=違反)
 */
export async function checkJsonPath(
  rule: Extract<Rule, { check: "json-path" }>,
  root: string,
): Promise<Finding[]> {
  const findings: Finding[] = [];
  const path = `${root}/${rule.with.path}`;
  if (!existsSync(path)) {
    findings.push({
      ruleId: rule.id,
      severity: "info",
      message: `target file not found: ${rule.with.path} (json-path skipped)`,
    });
    return findings;
  }
  const raw = readFileSync(path, "utf8");
  let json: unknown;
  try {
    json = rule.with.path.endsWith(".json") ? JSON.parse(raw) : parseYaml(raw);
  } catch (e) {
    findings.push({
      ruleId: rule.id,
      severity: rule.severity,
      file: rule.with.path,
      message: `failed to parse: ${(e as Error).message}`,
    });
    return findings;
  }
  for (const a of rule.with.assert) {
    const results = JSONPath({ path: a.query, json: json as object }) as unknown as unknown[];
    const fail = (msg: string) =>
      findings.push({
        ruleId: rule.id,
        severity: rule.severity,
        file: rule.with.path,
        message: `${a.query}: ${msg}`,
      });

    switch (a.op) {
      case "exists":
        if (results.length === 0) fail("expected to exist but not found");
        break;
      case "absent":
        if (results.length > 0) fail(`expected absent but found ${results.length} value(s)`);
        break;
      case "eq":
        for (const v of results) if (v !== a.value) fail(`expected ${a.value}, got ${v}`);
        break;
      case "ne":
        for (const v of results) if (v === a.value) fail(`value must not equal ${a.value}`);
        break;
      case "matches":
        for (const v of results)
          if (!new RegExp(String(a.value)).test(String(v)))
            fail(`value does not match /${a.value}/`);
        break;
      case "not-matches":
        for (const v of results)
          if (new RegExp(String(a.value)).test(String(v)))
            fail(`forbidden value matched /${a.value}/`);
        break;
    }
  }
  return findings;
}

/* ---------- drift ---------- */
/**
 * v0.1アルゴリズム: 見出し(## )単位のセクション比較。
 *  - allow_sections に列挙された見出しのセクションは差分許可
 *  - それ以外のセクションはマスターと完全一致を要求
 *  - 非Markdown(見出し無し)はファイル全体一致
 *  - source は file:<dir> のみ実装。github: はCLI側でtag取得後に file: へ解決する設計
 */
export async function checkDrift(
  rule: Extract<Rule, { check: "drift" }>,
  root: string,
): Promise<Finding[]> {
  const findings: Finding[] = [];
  const src = rule.with.source;
  if (!src.startsWith("file:")) {
    findings.push({
      ruleId: rule.id,
      severity: "info",
      message: `drift source '${src}' requires remote fetch (resolve to file: first) — skipped`,
    });
    return findings;
  }
  const srcRoot = src.slice("file:".length);
  const files = await fg(rule.with.paths, { cwd: root, dot: true });
  for (const file of files) {
    const srcPath = `${srcRoot}/${file}`;
    if (!existsSync(srcPath)) {
      findings.push({
        ruleId: rule.id,
        severity: "info",
        file,
        message: "not present in master source (project-local file)",
      });
      continue;
    }
    // EOL(CRLF/LF)差は drift とみなさない — Windows チェックアウトの誤検知防止
    const target = normalizeEol(readFileSync(`${root}/${file}`, "utf8"));
    const master = normalizeEol(readFileSync(srcPath, "utf8"));
    if (target === master) continue;

    const allow = new Set(rule.with.allow_sections ?? []);
    const tSec = splitSections(target);
    const mSec = splitSections(master);
    const headings = new Set([...tSec.keys(), ...mSec.keys()]);
    for (const h of headings) {
      if (allow.has(h)) continue;
      if ((tSec.get(h) ?? "") !== (mSec.get(h) ?? "")) {
        findings.push({
          ruleId: rule.id,
          severity: rule.severity,
          file,
          message:
            h === ""
              ? "drift detected outside allowed sections (preamble/whole file)"
              : `drift detected in section '${h}' (not in allow_sections)`,
        });
      }
    }
  }
  return findings;
}

/** CRLF → LF 正規化(drift 検査と guard sync の比較前処理で共用) */
export function normalizeEol(text: string): string {
  return text.replaceAll("\r\n", "\n");
}

/** '## 'で始まる行を境にセクション分割。先頭部は "" キー(drift 検査と guard sync で共用) */
export function splitSections(text: string): Map<string, string> {
  const map = new Map<string, string>();
  let current = "";
  let buf: string[] = [];
  for (const line of text.split("\n")) {
    if (line.startsWith("## ")) {
      map.set(current, buf.join("\n"));
      current = line.trim();
      buf = [];
    } else {
      buf.push(line);
    }
  }
  map.set(current, buf.join("\n"));
  return map;
}

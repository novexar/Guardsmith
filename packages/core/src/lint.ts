/**
 * aidev-guard lint engine v0.1
 * 実装済みcheck: file-exists / content-match / secret-scan
 * 未実装checkは finding(info) として明示し、黙ってスキップしない。
 */
import { readFileSync } from "node:fs";
import fg from "fast-glob";
import type { PolicyDocument, Rule, Severity, Exemption } from "./schema.js";
import {
  checkFileAbsent,
  checkMaxLines,
  checkFrontmatter,
  checkJsonPath,
  checkDrift,
} from "./checks.js";

/* ---------- 結果モデル ---------- */

export interface Finding {
  ruleId: string;
  severity: Severity;
  message: string;
  /** 対象ファイル(リポジトリ相対)。リポジトリ全体の指摘は undefined */
  file?: string;
  line?: number;
  /** exemption適用で抑制されたか */
  suppressed?: boolean;
}

export interface LintResult {
  findings: Finding[];
  /** error(未抑制)が1件以上あれば false */
  ok: boolean;
  stats: { error: number; warn: number; info: number; suppressed: number };
}

/* ---------- secret-scan 既定パターン ---------- */
/** 誤検知を抑えるため「値の形が資格情報らしい」ものに限定(キー名だけでは検知しない) */
const DEFAULT_SECRET_PATTERNS: { name: string; re: RegExp }[] = [
  { name: "AWS access key", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "Private key block", re: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: "GitHub token", re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { name: "Azure connection string", re: /AccountKey=[A-Za-z0-9+/=]{40,}/ },
  { name: "Slack token", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  {
    name: "Generic assigned secret",
    re: /(api[_-]?key|secret|token|password)\s*[:=]\s*['"][A-Za-z0-9+/_-]{16,}['"]/i,
  },
];

/* ---------- エンジン ---------- */

export async function runLint(
  policy: PolicyDocument,
  rootDir: string,
  now: Date = new Date(),
): Promise<LintResult> {
  const raw: Finding[] = [];
  for (const rule of policy.rules) {
    raw.push(...(await runRule(rule, rootDir)));
  }
  const findings = applyExemptions(raw, policy.exemptions, now);

  const stats = { error: 0, warn: 0, info: 0, suppressed: 0 };
  for (const f of findings) {
    if (f.suppressed) stats.suppressed++;
    else stats[f.severity]++;
  }
  return { findings, ok: stats.error === 0, stats };
}

async function runRule(rule: Rule, root: string): Promise<Finding[]> {
  switch (rule.check) {
    case "file-exists":
      return checkFileExists(rule, root, rule.with.paths);
    case "content-match":
      return checkContentMatch(rule, root);
    case "secret-scan":
      return checkSecretScan(rule, root);
    case "file-absent":
      return checkFileAbsent(rule, root);
    case "max-lines":
      return checkMaxLines(rule, root);
    case "frontmatter":
      return checkFrontmatter(rule, root);
    case "json-path":
      return checkJsonPath(rule, root);
    case "drift":
      return checkDrift(rule, root);
  }
}

/* ---------- file-exists ---------- */

async function checkFileExists(rule: Rule, root: string, paths: string[]): Promise<Finding[]> {
  const findings: Finding[] = [];
  for (const p of paths) {
    const isDir = p.endsWith("/");
    const pattern = isDir ? `${p}**` : p;
    const hits = await fg(pattern, { cwd: root, dot: true, onlyFiles: !isDir });
    if (hits.length === 0) {
      findings.push({
        ruleId: rule.id,
        severity: rule.severity,
        message: `required path not found: ${p}`,
      });
    }
  }
  return findings;
}

/* ---------- content-match ---------- */

async function checkContentMatch(
  rule: Extract<Rule, { check: "content-match" }>,
  root: string,
): Promise<Finding[]> {
  const findings: Finding[] = [];
  const files = await fg(rule.with.path, { cwd: root, dot: true });
  if (files.length === 0) {
    // 対象ファイルが無い場合は file-exists の責務。ここでは info に留める
    findings.push({
      ruleId: rule.id,
      severity: "info",
      message: `no files matched '${rule.with.path}' (content-match skipped)`,
    });
    return findings;
  }
  for (const file of files) {
    const text = readFileSync(`${root}/${file}`, "utf8");
    for (const pat of rule.with.must ?? []) {
      if (!new RegExp(pat, "m").test(text)) {
        findings.push({
          ruleId: rule.id,
          severity: rule.severity,
          file,
          message: `required pattern not found: /${pat}/`,
        });
      }
    }
    for (const pat of rule.with.must_not ?? []) {
      const m = new RegExp(pat, "m").exec(text);
      if (m) {
        findings.push({
          ruleId: rule.id,
          severity: rule.severity,
          file,
          line: lineOf(text, m.index),
          message: `forbidden pattern found: /${pat}/`,
        });
      }
    }
  }
  return findings;
}

/* ---------- secret-scan ---------- */

async function checkSecretScan(
  rule: Extract<Rule, { check: "secret-scan" }>,
  root: string,
): Promise<Finding[]> {
  const findings: Finding[] = [];
  const patterns = [
    ...DEFAULT_SECRET_PATTERNS,
    ...(rule.with.extra_patterns ?? []).map((p) => ({ name: `custom: ${p}`, re: new RegExp(p) })),
  ];
  const files = await fg(rule.with.paths, { cwd: root, dot: true });
  for (const file of files) {
    const text = readFileSync(`${root}/${file}`, "utf8");
    for (const { name, re } of patterns) {
      const m = re.exec(text);
      if (m) {
        findings.push({
          ruleId: rule.id,
          severity: rule.severity,
          file,
          line: lineOf(text, m.index),
          message: `potential secret detected (${name})`,
          // 検出値そのものはログに出さない(流出の二次被害防止)
        });
      }
    }
  }
  return findings;
}

/* ---------- exemption ---------- */

function applyExemptions(findings: Finding[], exemptions: Exemption[], now: Date): Finding[] {
  const out: Finding[] = [];
  const active = new Map<string, Exemption>();
  for (const ex of exemptions) {
    const expired = new Date(`${ex.expires}T23:59:59Z`) < now;
    if (expired) {
      // 期限切れexemptionはそれ自体をerrorとして表面化(設計方針: 例外の形骸化防止)
      out.push({
        ruleId: ex.rule,
        severity: "error",
        message: `exemption expired on ${ex.expires} (approved_by: ${ex.approved_by}) — renew or fix`,
      });
    } else {
      active.set(ex.rule, ex);
    }
  }
  for (const f of findings) {
    out.push(active.has(f.ruleId) ? { ...f, suppressed: true } : f);
  }
  return out;
}

/* ---------- util ---------- */

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split("\n").length;
}

/* ---------- console reporter ---------- */

export function formatConsole(result: LintResult): string {
  const lines: string[] = [];
  for (const f of result.findings) {
    const loc = f.file ? ` ${f.file}${f.line ? `:${f.line}` : ""}` : "";
    const tag = f.suppressed ? "SUPPRESSED" : f.severity.toUpperCase();
    lines.push(`${tag.padEnd(10)} ${f.ruleId}${loc} — ${f.message}`);
  }
  const s = result.stats;
  lines.push(
    `\n${result.ok ? "PASSED" : "FAILED"}: ${s.error} error, ${s.warn} warn, ${s.info} info, ${s.suppressed} suppressed`,
  );
  return lines.join("\n");
}

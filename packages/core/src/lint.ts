/**
 * aidev-guard lint engine v0.1
 * 実装済みcheck: file-exists / content-match / secret-scan
 * 未実装checkは finding(info) として明示し、黙ってスキップしない。
 */
import { readFileSync } from "node:fs";
import { createGlobScope, globFiles, type GlobScope } from "./glob.js";
import type { PolicyDocument, Rule, Severity, Exemption } from "./schema.js";
import { checkImportBudget } from "./import-budget.js";
import {
  checkFileAbsent,
  checkMaxLines,
  checkFrontmatter,
  checkJsonPath,
  checkDrift,
} from "./checks.js";
import { checkDrift3, type Drift3Context } from "./drift3.js";

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

export interface SecretPattern {
  name: string;
  re: RegExp;
}

/**
 * 誤検知を抑えるため「値の形が資格情報らしい」ものに限定(キー名だけでは検知しない)。
 * `guard sync --init-vars` も同じパターンで推定値を検査する(R6: vars はコミット対象)。
 */
export const DEFAULT_SECRET_PATTERNS: readonly SecretPattern[] = [
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

export interface LintOptions {
  /** ローカルの .gitignore を尊重するか(既定 true)。false で全走査に戻す */
  gitignore?: boolean;
  /** drift3 の 3-way 文脈(旧・新マスターと vars)。未指定なら節単位比較へ退避する */
  drift3?: Drift3Context;
}

export async function runLint(
  policy: PolicyDocument,
  rootDir: string,
  now: Date = new Date(),
  options: LintOptions = {},
): Promise<LintResult> {
  // .gitignore の探索・読込は1回だけ。全ルールで同じスコープを使い回す
  const scope = await createGlobScope(rootDir, {
    ignore: policy.ignore,
    gitignore: options.gitignore,
  });
  const raw: Finding[] = [];
  for (const rule of policy.rules) {
    raw.push(...(await runRule(rule, rootDir, scope, options)));
  }
  const findings = applyExemptions(raw, policy.exemptions, now);

  const stats = { error: 0, warn: 0, info: 0, suppressed: 0 };
  for (const f of findings) {
    if (f.suppressed) stats.suppressed++;
    else stats[f.severity]++;
  }
  return { findings, ok: stats.error === 0, stats };
}

async function runRule(
  rule: Rule,
  root: string,
  scope: GlobScope,
  options: LintOptions,
): Promise<Finding[]> {
  switch (rule.check) {
    case "file-exists":
      return checkFileExists(rule, scope, rule.with.paths);
    case "content-match":
      return checkContentMatch(rule, root, scope);
    case "secret-scan":
      return checkSecretScan(rule, root, scope);
    case "file-absent":
      return checkFileAbsent(rule, scope);
    case "max-lines":
      return checkMaxLines(rule, root, scope);
    case "import-budget":
      return checkImportBudget(rule, root, scope);
    case "frontmatter":
      return checkFrontmatter(rule, root, scope);
    case "json-path":
      return checkJsonPath(rule, root);
    case "drift":
      return checkDrift(rule, root, scope);
    case "drift3":
      return checkDrift3(rule, root, scope, options.drift3);
  }
}

/* ---------- file-exists ---------- */

async function checkFileExists(rule: Rule, scope: GlobScope, paths: string[]): Promise<Finding[]> {
  const findings: Finding[] = [];
  for (const p of paths) {
    const isDir = p.endsWith("/");
    const pattern = isDir ? `${p}**` : p;
    // .gitignore 対象のパスはコミットされないため「存在しない」として扱う
    const hits = await globFiles(scope, [pattern], { onlyFiles: !isDir });
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
  scope: GlobScope,
): Promise<Finding[]> {
  const findings: Finding[] = [];
  const files = await globFiles(scope, [rule.with.path]);
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
  scope: GlobScope,
): Promise<Finding[]> {
  const findings: Finding[] = [];
  const patterns = [
    ...DEFAULT_SECRET_PATTERNS,
    ...(rule.with.extra_patterns ?? []).map((p) => ({ name: `custom: ${p}`, re: new RegExp(p) })),
  ];
  const files = await globFiles(scope, rule.with.paths);
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

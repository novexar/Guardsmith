/**
 * `check: drift3` — 「標準の変更が PJ に未適用である」ことを lint で検出する。
 *
 * 既存 `check: drift`(節単位)との違い:
 *   drift  は「PJ がマスターから乖離していないか」= PJ の編集そのものを指摘する。
 *   drift3 は「マスターの変更が PJ に取り込まれているか」= PJ の編集は正として扱う。
 *
 * 判定は `guard sync` の 3-way 計画(planSync3)をそのまま使う。lint と sync で
 * 「何が未適用か」の解釈がずれないようにするため、検査専用の比較ロジックは持たない。
 */
import type { GlobScope } from "./glob.js";
import type { Rule } from "./schema.js";
import type { Finding } from "./lint.js";
import { checkDrift } from "./checks.js";
import { planSync3, type Drift3Source, type Sync3Plan } from "./sync3.js";
import { VARS_FILENAME, type VarsDocument } from "./vars.js";

/**
 * drift3 検査に必要な、ポリシーだけからは得られない文脈。CLI が組み立てて runLint へ渡す。
 * 計画(§2.2)の `baseRoots` は「旧マスターのディレクトリ」だけを持つ形だったが、
 * タグ・新マスターも同時に必要なため解決済みの Drift3Source をそのまま持ち回す。
 */
export interface Drift3Context {
  /** ruleId → 解決済みの 3-way ソース(旧・新マスターとそのタグ) */
  sources: ReadonlyMap<string, Drift3Source>;
  /** PJ の置換値。null = guardsmith.vars.yaml が無い(3-way 不能 → 節単位へ退避) */
  vars: VarsDocument | null;
}

export async function checkDrift3(
  rule: Extract<Rule, { check: "drift3" }>,
  root: string,
  scope: GlobScope,
  ctx?: Drift3Context,
): Promise<Finding[]> {
  const src = rule.with.source;
  if (!src.startsWith("file:")) {
    // drift と同じ扱い: 未解決の source は黙って無視せず info で見えるようにする
    return [
      info(
        rule.id,
        `drift3 source '${src}' requires remote fetch (resolve to file: first) — skipped`,
      ),
    ];
  }
  if (ctx === undefined || ctx.vars === null) {
    return [
      info(
        rule.id,
        `${VARS_FILENAME} not found — falling back to section comparison. ` +
          "run: guard sync --init-vars",
      ),
      ...(await sectionFallback(rule, root, scope)),
    ];
  }
  const source = ctx.sources.get(rule.id);
  if (source === undefined) {
    return [info(rule.id, "3-way source could not be resolved for this rule — skipped")];
  }
  // 基準タグと配布タグが同じなら「追随すべき変更」は定義上存在しない
  if (source.baseTag === source.headTag) return [];

  const plan = await planSync3([source], root, ctx.vars);
  return summarize(rule, plan);
}

/** vars が無い PJ 向けの退避経路。従来の節単位比較(新マスターとの比較)を行う */
async function sectionFallback(
  rule: Extract<Rule, { check: "drift3" }>,
  root: string,
  scope: GlobScope,
): Promise<Finding[]> {
  return checkDrift(
    {
      id: rule.id,
      severity: rule.severity,
      check: "drift",
      with: { source: rule.with.source, paths: rule.with.paths },
    },
    root,
    scope,
  );
}

function summarize(rule: Extract<Rule, { check: "drift3" }>, plan: Sync3Plan): Finding[] {
  const findings: Finding[] = [];
  const delta = `standards ${plan.baseTag} → ${plan.nextTag}`;
  const clean = plan.actions.filter((a) => a.kind === "merge" || a.kind === "create");
  if (clean.length > 0) {
    findings.push({
      ruleId: rule.id,
      severity: rule.severity,
      message:
        `${delta} not applied (${clean.length} files, applies cleanly) — ` +
        `run: guard bump ${plan.nextTag}`,
    });
  }
  if (plan.conflicted.length > 0) {
    findings.push(
      info(rule.id, `${delta} needs manual merge (conflicts in ${plan.conflicted.join(", ")})`),
    );
  }
  // 未登録の置換値は 3-way の入力そのものを歪める。`guard new` 直後の空 vars が
  // lint で見えるように、rule の対象範囲で 1 件にまとめて報告する
  const unresolved = [...new Set(plan.actions.flatMap((a) => a.unresolvedVars))].sort();
  if (unresolved.length > 0) {
    findings.push(
      info(
        rule.id,
        `${unresolved.length} placeholder(s) missing from ${VARS_FILENAME}: ` +
          `${unresolved.join(", ")} — guard sync --write and guard bump refuse to run until filled`,
      ),
    );
  }
  for (const a of plan.actions) {
    if (a.kind === "skip-deleted") {
      findings.push({
        ...info(rule.id, `${delta} changed this file, but the project deleted it — skipped`),
        file: a.file,
      });
    } else if (a.kind === "removed") {
      findings.push({
        ...info(rule.id, `gone from master at ${plan.nextTag} — delete manually if unused`),
        file: a.file,
      });
    }
  }
  return findings;
}

function info(ruleId: string, message: string): Finding {
  return { ruleId, severity: "info", message };
}

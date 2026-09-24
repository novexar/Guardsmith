/**
 * `guard bump <tag>` — 配布タグを上げ、その差分を PJ へ 3-way で取り込む。
 *
 * 失敗時に中途半端な作業ツリーを残さないことが最優先(R8):
 *   衝突があれば policy も vars もファイルも **一切書かない**。
 *   policy の書き換えは全ての適用が終わった **最後** に行う。
 *
 * policy の書き換えは正規表現によるその場テキスト置換のみで行う。yaml ライブラリで
 * parse → stringify するとコメント・キー順・引用符が失われるため(R7)。
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { buildDrift3Sources, Drift3PolicyError, loadPolicyWithMeta } from "./resolver.js";
import { writeAtomically } from "./atomic.js";
import { formatPlan, planSync, syncWrites, type SyncPlan } from "./sync.js";
import {
  applySync3,
  formatDowngrade,
  formatSync3Plan,
  planSync3,
  sync3Writes,
  varsBlockingWrite,
  type Sync3Plan,
} from "./sync3.js";
import { loadVars, TAG_RE, VARS_FILENAME } from "./vars.js";
import type { RemoteOptions } from "./remote.js";

/** dry-run の適用案内。`guard sync --write` ではなく「--dry-run を外して再実行」が正しい */
const BUMP_APPLY_HINT = "without --dry-run";

export interface RewrittenRef {
  /** 置換が起きた行(前後の空白は落とす) */
  line: string;
  from: string;
  to: string;
}

export interface RewriteResult {
  text: string;
  rewritten: RewrittenRef[];
}

/**
 * policy YAML 内の `github:<owner>/<repo>[//path]@<tag>` のタグだけをテキスト置換する。
 * owner/repo が一致する参照のみが対象で、コメント内の参照も同じ扱いで追従させる。
 */
export function rewriteExtendsTag(
  yamlText: string,
  owner: string,
  repo: string,
  tag: string,
): RewriteResult {
  const re = new RegExp(
    `(github:${escapeRegExp(owner)}/${escapeRegExp(repo)}(?://[\\w./-]+)?@)(v[\\w.-]+)`,
    "gi",
  );
  const rewritten: RewrittenRef[] = [];
  const text = yamlText.replace(re, (whole, prefix: string, from: string, offset: number) => {
    if (from === tag) return whole;
    rewritten.push({ line: lineAt(yamlText, offset), from, to: tag });
    return `${prefix}${tag}`;
  });
  return { text, rewritten };
}

export interface BumpOptions extends RemoteOptions {
  tag: string;
  rootDir: string;
  /** guard.policy.yaml の絶対パス */
  policyFile: string;
  /** タグを書き換える対象リポジトリ。既定 novexar/guardsmith */
  repo: string;
  gitignore?: boolean;
  conflictMarkers?: boolean;
  /** 基準タグの方が新しい(= 標準を巻き戻す)状態でも適用する */
  allowDowngrade?: boolean;
  /**
   * 計画だけを表示し、1 バイトも書かない。
   *
   * `guard sync` の dry-run は **現在の policy タグ**(= vars の standards)を基準に
   * するため、「新タグへ上げたら何が変わるか」は見えない。上げる前に予見できるのは
   * この dry-run だけなので、追随手順の 1 段目として案内している。
   */
  dryRun?: boolean;
}

/** 0 = 適用完了(dry-run では適用可能)/ 1 = 衝突あり(policy も vars も未変更)/ 2 = 実行エラー */
export async function runBump(opts: BumpOptions): Promise<number> {
  const { tag, rootDir, policyFile } = opts;
  if (!TAG_RE.test(tag)) {
    console.error(`invalid tag '${tag}' — remote references must pin a tag: vX.Y.Z`);
    return 2;
  }
  // dry-run は書かないのが唯一の約束。マーカー書き出しと同時には指定させない
  if (opts.dryRun === true && opts.conflictMarkers === true) {
    console.error("usage: guard bump <tag> --dry-run cannot be combined with --conflict-markers");
    return 2;
  }
  const slug = /^([\w.-]+)\/([\w.-]+)$/.exec(opts.repo);
  if (slug === null) {
    console.error(`invalid --repo '${opts.repo}' — expected <owner>/<repo>`);
    return 2;
  }
  if (!existsSync(policyFile)) {
    console.error(`policy not found: ${policyFile} — run 'guard init' first`);
    return 2;
  }
  const vars = loadVars(rootDir);
  if (vars === null) {
    console.error(`${VARS_FILENAME} not found — run: guard sync --init-vars`);
    return 2;
  }
  // ① まだ書かない。衝突したときに作業ツリーを一切変えないため、書き換え結果は保持だけする
  const policyText = readFileSync(policyFile, "utf8");
  const rewrite = rewriteExtendsTag(policyText, slug[1], slug[2], tag);

  // ② 新タグのマスターを解決する(policy のタグは headTag で上書きするため、一時ファイルは要らない)
  // 対象リポジトリの drift / drift3 を **新タグ** で解決する。節単位モードにも効かせないと、
  //  bump が skills を旧マスターの内容で上書きしてしまう
  const { policy, driftOrigins } = await loadPolicyWithMeta(policyFile, {
    ...opts,
    headTag: tag,
    repo: opts.repo,
  });
  let resolved;
  try {
    resolved = await buildDrift3Sources(policy, driftOrigins, vars.standards, {
      ...opts,
      headTag: tag,
      repo: opts.repo,
    });
  } catch (e) {
    if (!(e instanceof Drift3PolicyError)) throw e;
    console.error(e.message);
    return 2;
  }
  for (const s of resolved.skipped) {
    console.error(
      `warning: drift3 rule '${s.ruleId}' points at ${s.source} — not bumped ` +
        `(${VARS_FILENAME} records a single standards tag, so only ${opts.repo} is followed)`,
    );
  }
  if (resolved.sources.length === 0) {
    console.error(
      `no \`check: drift3\` rule for ${opts.repo} in the effective policy — nothing to bump`,
    );
    return 2;
  }

  const plan = await planSync3(resolved.sources, rootDir, vars, {
    gitignore: opts.gitignore,
    conflictMarkers: opts.conflictMarkers,
    allowDowngrade: opts.allowDowngrade,
  });

  // 基準タグの方が新しい = この bump は標準を巻き戻す。計画を出さずに止める
  if (plan.downgrade !== undefined) {
    console.error(formatDowngrade(plan.downgrade));
    return 2;
  }

  // 未確定の置換値が残っていれば、衝突判定より前に止める(TODO が PJ へ書かれるのを防ぐ)
  const blocking = varsBlockingWrite(plan, vars);
  if (blocking !== null) {
    console.error(blocking);
    return 2;
  }

  // ③ dry-run: ここから先は一切書かない。衝突の有無だけを終了コードで返す
  if (opts.dryRun === true) {
    return reportDryRun(plan, await planSync(policy, rootDir, { gitignore: opts.gitignore }), {
      rewritten: rewrite.rewritten,
      tag,
    });
  }

  // ④ 衝突: 既定は 1 ファイルも書かない。--conflict-markers のときだけマーカーを書く
  //    (どちらの場合も policy と vars は進めない)
  if (plan.conflicted.length > 0) {
    console.log(formatSync3Plan(plan, false));
    if (opts.conflictMarkers === true) applySync3(plan, rootDir, vars);
    console.error(
      `bump aborted: ${plan.conflicted.length} file(s) conflict — ` +
        (opts.conflictMarkers === true
          ? "conflict markers written; resolve them, revert, and re-run"
          : "resolve manually (re-run with --conflict-markers to write markers)") +
        `\nguard.policy.yaml and ${VARS_FILENAME} were left unchanged`,
    );
    return 1;
  }

  // ⑤ 節単位モード(check: drift の skills 同期)も同じコマンドで済ませる。
  //    bump 後に guard sync --write を別途要求すると、やり忘れで skills だけ旧タグのまま残る。
  //    policy は headTag 付きで読んであるので、ここで引くマスターも **新タグ** になる
  const sectionPlan = await planSync(policy, rootDir, { gitignore: opts.gitignore });

  // ⑥ 3-way・節単位・vars・スタンプを **1 つの 2 相バッチ** で適用する。
  //    全部書けるか、1 つも書かないかのどちらかにして、中間状態を作らない
  writeAtomically(rootDir, [...sync3Writes(plan, rootDir, vars), ...syncWrites(sectionPlan)]);
  // policy だけはバッチ外。--policy でリポジトリ外を指しうるうえ、ここで失敗しても
  // 「ファイルは新・policy は旧」= 次回 bump で再適用できる安全側に倒れる(R8)
  if (rewrite.rewritten.length > 0) {
    try {
      writeFileSync(policyFile, rewrite.text);
    } catch (e) {
      console.error(
        `${(e as Error).message}
the files and ${VARS_FILENAME} are at ${tag}, but ` +
          `guard.policy.yaml still pins ${plan.baseTag}. Fix the write permission and ` +
          `re-run \`guard bump ${tag}\` — do **not** run \`guard sync --write\`, which ` +
          "would see a newer project than the policy distributes",
      );
      return 2;
    }
  }
  console.log(formatSync3Plan(plan, true));
  if (sectionPlan.actions.length > 0) console.log(formatPlan(sectionPlan, true));
  for (const r of rewrite.rewritten) {
    console.log(`POLICY   ${r.from} → ${r.to}  (${r.line})`);
  }
  const merged = plan.actions.filter((a) => a.kind === "merge" || a.kind === "create").length;
  console.log(
    `bumped standards ${plan.baseTag} → ${tag}: ` +
      `${merged} file(s) merged (3-way), ${sectionPlan.actions.length} file(s) restored (sections)`,
  );
  return 0;
}

/**
 * dry-run の表示。実行時と同じ計画をそのまま出し、policy の書き換えは「予定行」として見せる。
 * 終了コードも適用時と揃える(0 = このまま適用できる / 1 = 衝突あり)ので、CI で
 * 「上げられるか」を先に判定できる。
 *
 * 適用案内は両フォーマッタへ差し替え文言を渡して **1 行だけ**出す。`guard sync` 既定の
 * `--write` をここで出すと、bump の計画を `guard sync --write`(= 現在のタグ)で適用しろ、
 * という誤った案内になる。
 */
function reportDryRun(
  plan: Readonly<Sync3Plan>,
  sectionPlan: Readonly<SyncPlan>,
  ref: { rewritten: readonly RewrittenRef[]; tag: string },
): number {
  console.log(formatSync3Plan(plan, false, BUMP_APPLY_HINT));
  if (sectionPlan.actions.length > 0) {
    console.log(formatPlan(sectionPlan, false, BUMP_APPLY_HINT));
  }
  for (const r of ref.rewritten) {
    console.log(`POLICY   ${r.from} → ${r.to}  (${r.line})`);
  }
  if (plan.conflicted.length === 0) return 0;
  console.error(
    `bump would abort: ${plan.conflicted.length} file(s) conflict — ` +
      `resolve them before running \`guard bump ${ref.tag}\``,
  );
  return 1;
}

function lineAt(text: string, offset: number): string {
  const start = text.lastIndexOf("\n", offset) + 1;
  const end = text.indexOf("\n", offset);
  return text.slice(start, end < 0 ? undefined : end).trim();
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

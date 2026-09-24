#!/usr/bin/env node
/**
 * GuardSmith CLI
 *   guard init                     # guard.policy.yaml を生成(30秒体験の入口)
 *   guard lint [--root <dir>] [--policy <file>] [--format console|sarif|json] [--out <file>] [--no-cache] [--no-gitignore]
 *   guard sync [--root <dir>] [--policy <file>] [--write] [--no-cache] [--no-gitignore] [--conflict-markers] [--init-vars] [--allow-downgrade]
 *   guard bump <tag> [--root <dir>] [--policy <file>] [--repo <owner>/<repo>] [--dry-run] [--no-cache] [--no-gitignore] [--conflict-markers] [--allow-downgrade]
 *   guard new <dir>                # standards/ 一式から新規PJ雛形を展開
 *   guard explain <rule-id>
 * exit code: 0 = pass / 1 = error検出(sync/bump は衝突あり)/ 2 = 実行エラー
 *   `guard bump --dry-run` は 1 バイトも書かずに同じ判定を返す(0 = 適用可能 / 1 = 衝突あり)
 */
import {
  cpSync,
  existsSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runBump } from "./bump.js";
import type { Drift3Context } from "./drift3.js";
import { runInitVars } from "./initvars.js";
import { formatConsole, runLint } from "./lint.js";
import { ASSET_ROOT } from "./paths.js";
import {
  buildDrift3Sources,
  Drift3PolicyError,
  loadPolicyWithMeta,
  toSarif,
  type SkippedDrift3,
} from "./resolver.js";
import { applySync, formatPlan, planSync } from "./sync.js";
import {
  applySync3,
  formatDowngrade,
  formatSync3Plan,
  planSync3,
  varsBlockingWrite,
} from "./sync3.js";
import { loadVars, resolveBaseTag, VARS_FILENAME, writeVars, type VarsDocument } from "./vars.js";
import type { PolicyDocument } from "./schema.js";

const VERSION = "0.6.1";

/**
 * guard new が参照する標準(standards/ + baseline)のタグ。
 * npm パッケージ版(VERSION)とは独立に、標準の内容が変わったリリースでのみ上げる。
 */
const STANDARDS_TAG = "0.7.1";

/** 既定の標準配布元。guard bump がタグを書き換える対象 */
const STANDARDS_REPO = "novexar/guardsmith";

const INIT_TEMPLATE = `version: 1
target: claude-code
extends:
  - preset:baseline
rules: []
exemptions: []
output:
  formats: [console]
`;

/** guard new が生成する PJ 用ポリシー(リモート参照・タグ固定) */
const NEW_POLICY_TEMPLATE = `version: 1
target: claude-code
extends:
  - github:novexar/guardsmith//presets/baseline.yaml@v${STANDARDS_TAG}
rules: []
exemptions: []
output:
  formats: [console]
`;

/**
 * guard new が生成する guardsmith.vars.yaml の雛形。
 * 値は init-project が記入する(ここでは空にしておき、書き忘れを lint で拾えるようにする)。
 */
const NEW_VARS: VarsDocument = { version: 1, standards: `v${STANDARDS_TAG}`, vars: {} };

const NEW_VARS_HEADER = [
  "init-project が CLAUDE.md / DESIGN.md / docs / .claude/agents の {{...}} を置換した値を",
  "ここへ記録する。この記録が無いと guard sync / guard bump の 3-way 追随ができない。",
  "選択式トークン(例: 単一システム | モノレポ)もキーとしてそのまま記録すること。",
];

export async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case "init":
      return init();
    case "lint":
      return lint(parseFlags(rest));
    case "sync":
      return sync(parseFlags(rest));
    case "bump":
      return bump(rest);
    case "new":
      rejectDryRun(rest);
      return newProject(rest[0]);
    case "explain":
      rejectDryRun(rest);
      return explain(rest[0]);
    case "version":
    case "--version":
      console.log(`guard ${VERSION} (standards v${STANDARDS_TAG})`);
      return 0;
    default:
      console.error(
        "usage: guard <init|lint|sync|bump|new|explain|version>\n" +
          "  guard init\n" +
          "  guard lint [--root <dir>] [--policy <file>] [--format console|sarif|json] [--out <file>] [--no-cache] [--no-gitignore]\n" +
          "  guard sync [--root <dir>] [--policy <file>] [--write] [--no-cache] [--no-gitignore] [--conflict-markers] [--init-vars] [--allow-downgrade]\n" +
          "  guard bump <tag> [--root <dir>] [--policy <file>] [--repo <owner>/<repo>] [--dry-run] [--no-cache] [--no-gitignore] [--conflict-markers] [--allow-downgrade]\n" +
          "  guard new <dir>\n" +
          "  guard explain <rule-id>",
      );
      return 2;
  }
}

/**
 * `--dry-run` は `guard bump` 専用。フラグを解析しないコマンド(new / explain)でも
 * 黙って無視すると「dry-run のつもりだった」取り違えを招くので、明示的に落とす。
 */
function rejectDryRun(args: readonly string[]): void {
  if (args.includes("--dry-run")) throw new Error("unknown flag: --dry-run");
}

function init(): number {
  const path = resolve("guard.policy.yaml");
  if (existsSync(path)) {
    console.error("guard.policy.yaml already exists — not overwriting");
    return 2;
  }
  writeFileSync(path, INIT_TEMPLATE);
  console.log("created guard.policy.yaml (extends preset:baseline)\nrun: guard lint");
  return 0;
}

interface Flags {
  root: string;
  policy: string;
  format: "console" | "sarif" | "json";
  out?: string;
  noCache: boolean;
  /** .gitignore に追従しない(= 全走査に戻す) */
  noGitignore: boolean;
  write: boolean;
  /** 衝突箇所をマーカー入りで書き出す(終了コードは 1 のまま) */
  conflictMarkers: boolean;
  /** guardsmith.vars.yaml を推定生成して終了する(sync は実行しない) */
  initVars: boolean;
  /** 基準タグの方が新しい(= 標準を巻き戻す)状態でも適用する */
  allowDowngrade: boolean;
  /** guard bump がタグを書き換える対象リポジトリ */
  repo: string;
  /** guard bump: 計画だけを表示し 1 バイトも書かない */
  dryRun: boolean;
}

/**
 * `allowDryRun` は `guard bump` からのみ真にする。全コマンドで受理すると
 * `guard sync --write --dry-run` が「dry-run のつもりで書き込む」事故になるため、
 * bump 以外では未知のフラグとして落とす(= 終了コード 2)。
 */
function parseFlags(args: string[], allowDryRun = false): Flags {
  const f: Flags = {
    root: ".",
    policy: "guard.policy.yaml",
    format: "console",
    noCache: false,
    noGitignore: false,
    write: false,
    conflictMarkers: false,
    initVars: false,
    allowDowngrade: false,
    repo: STANDARDS_REPO,
    dryRun: false,
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--root") f.root = args[++i];
    else if (a === "--policy") f.policy = args[++i];
    else if (a === "--format") f.format = args[++i] as Flags["format"];
    else if (a === "--out") f.out = args[++i];
    else if (a === "--repo") f.repo = args[++i];
    else if (a === "--no-cache") f.noCache = true;
    else if (a === "--no-gitignore") f.noGitignore = true;
    else if (a === "--write") f.write = true;
    else if (a === "--conflict-markers") f.conflictMarkers = true;
    else if (a === "--init-vars") f.initVars = true;
    else if (a === "--allow-downgrade") f.allowDowngrade = true;
    else if (a === "--dry-run" && allowDryRun) f.dryRun = true;
    else throw new Error(`unknown flag: ${a}`);
  }
  if (!["console", "sarif", "json"].includes(f.format))
    throw new Error(`invalid --format: ${f.format}`);
  return f;
}

async function lint(f: Flags): Promise<number> {
  const policyPath = resolve(f.root, f.policy);
  if (!existsSync(policyPath)) {
    console.error(`policy not found: ${policyPath} — run 'guard init' first`);
    return 2;
  }
  const root = resolve(f.root);
  const { policy, driftOrigins } = await loadPolicyWithMeta(policyPath, { noCache: f.noCache });
  const result = await runLint(policy, root, new Date(), {
    gitignore: !f.noGitignore,
    drift3: await drift3Context(policy, driftOrigins, root, f),
  });

  const output =
    f.format === "sarif"
      ? toSarif(result, policy)
      : f.format === "json"
        ? JSON.stringify(result, null, 2)
        : formatConsole(result);

  if (f.out) {
    writeFileSync(f.out, output);
    console.log(`wrote ${f.format} report to ${f.out}`);
    console.log(formatConsole(result).split("\n").at(-1)); // サマリ行だけ表示
  } else {
    console.log(output);
  }
  return result.ok ? 0 : 1;
}

/**
 * 3-way 検査の文脈を組み立てる。
 * vars が無い / マスターを引けない場合は null / 空を返し、checkDrift3 に退避させる
 * (lint 全体を落とさない — 標準の取得失敗で検査全部が止まるのは害が大きい)。
 */
async function drift3Context(
  policy: PolicyDocument,
  driftOrigins: ReadonlyMap<string, string>,
  root: string,
  f: Flags,
): Promise<Drift3Context | undefined> {
  if (!policy.rules.some((r) => r.check === "drift3")) return undefined;
  const base = resolveBaseTag(root);
  const vars = loadVars(root);
  if (base === null || vars === null) return { sources: new Map(), vars: null };
  warnStampMismatch(base.stampTag, base.tag);
  try {
    const resolved = await buildDrift3Sources(policy, driftOrigins, base.tag, {
      noCache: f.noCache,
      repo: f.repo,
    });
    warnSkippedDrift3(resolved.skipped, f.repo);
    return { sources: new Map(resolved.sources.map((s) => [s.ruleId, s])), vars };
  } catch (e) {
    // policy の不整合は検査結果を歪めるので落とす。取得失敗は lint 全体を止めない
    if (e instanceof Drift3PolicyError) throw e;
    console.error(`warning: could not resolve the standards master: ${(e as Error).message}`);
    return { sources: new Map(), vars };
  }
}

/** vars は単一タグしか持てないため、対象リポジトリ以外の drift3 は追随できない */
function warnSkippedDrift3(skipped: readonly SkippedDrift3[], repo: string): void {
  for (const s of skipped) {
    console.error(
      `warning: drift3 rule '${s.ruleId}' points at ${s.source} — not followed ` +
        `(${VARS_FILENAME} records a single standards tag, so only ${repo} is tracked)`,
    );
  }
}

function warnStampMismatch(stampTag: string | undefined, tag: string): void {
  if (stampTag === undefined) return;
  console.error(
    `warning: CLAUDE.md is stamped ${stampTag} but ${VARS_FILENAME} says ${tag} — ` +
      `using ${tag} (fix \`standards:\` if the stamp is the correct one)`,
  );
}

async function sync(f: Flags): Promise<number> {
  const root = resolve(f.root);
  const policyPath = resolve(f.root, f.policy);
  if (!existsSync(policyPath)) {
    console.error(`policy not found: ${policyPath} — run 'guard init' first`);
    return 2;
  }
  if (f.initVars) {
    return runInitVars({
      rootDir: root,
      policyFile: policyPath,
      noCache: f.noCache,
      gitignore: !f.noGitignore,
    });
  }
  const { policy, driftOrigins } = await loadPolicyWithMeta(policyPath, { noCache: f.noCache });

  // 節単位モード(check: drift)は drift3 の有無に関わらず従来どおり動く。両方のルールを
  // 持つ policy(baseline v0.7.0 の skills + standards)では両方走る。
  // drift3 だけの policy では節単位の空サマリを出さない(それ以外は従来どおりの出力)。
  const threeWay = policy.rules.some((r) => r.check === "drift3");
  const sections = !threeWay || policy.rules.some((r) => r.check === "drift");
  if (!threeWay) {
    const plan = await planSync(policy, root, { gitignore: !f.noGitignore });
    if (f.write) applySync(plan, root);
    console.log(formatPlan(plan, f.write));
    return 0;
  }
  return syncThreeWay(policy, driftOrigins, root, f, sections);
}

/**
 * 3-way モード。**先に 3-way の計画を作る**のは、衝突があったときに節単位モードの
 * 適用まで含めて止めるため(「衝突したら何も書かれない」を sync 全体で保証する)。
 */
async function syncThreeWay(
  policy: PolicyDocument,
  driftOrigins: ReadonlyMap<string, string>,
  root: string,
  f: Flags,
  sections: boolean,
): Promise<number> {
  const base = resolveBaseTag(root);
  const vars = loadVars(root);
  if (base === null || vars === null) {
    console.error(
      `${VARS_FILENAME} not found — the 3-way standards sync needs the values the project ` +
        "was generated with. run: guard sync --init-vars",
    );
    return 2;
  }
  warnStampMismatch(base.stampTag, base.tag);
  let resolved;
  try {
    resolved = await buildDrift3Sources(policy, driftOrigins, base.tag, {
      noCache: f.noCache,
      repo: f.repo,
    });
  } catch (e) {
    if (!(e instanceof Drift3PolicyError)) throw e;
    console.error(e.message);
    return 2;
  }
  warnSkippedDrift3(resolved.skipped, f.repo);
  const plan = await planSync3(resolved.sources, root, vars, {
    gitignore: !f.noGitignore,
    conflictMarkers: f.conflictMarkers,
    allowDowngrade: f.allowDowngrade,
  });

  // 基準タグの方が新しい = 適用すると標準が巻き戻る。計画も出さずに実行エラーにする
  if (plan.downgrade !== undefined) {
    console.error(formatDowngrade(plan.downgrade));
    return 2;
  }

  // 未確定の置換値が残っているうちは 1 バイトも書かない(TODO の流し込み防止)
  const blocking = f.write ? varsBlockingWrite(plan, vars) : null;
  if (blocking !== null) {
    console.error(blocking);
    return 2;
  }
  const write = f.write && plan.conflicted.length === 0;

  if (sections) {
    const sectionPlan = await planSync(policy, root, { gitignore: !f.noGitignore });
    if (write) applySync(sectionPlan, root);
    console.log(formatPlan(sectionPlan, write));
  }
  if (f.write) applySync3(plan, root, vars);
  console.log(formatSync3Plan(plan, write));
  return plan.conflicted.length > 0 ? 1 : 0;
}

async function bump(args: string[]): Promise<number> {
  const [tag, ...rest] = args;
  if (!tag || tag.startsWith("-")) {
    console.error("usage: guard bump <tag> [--repo <owner>/<repo>] [--dry-run]");
    return 2;
  }
  // lint 専用フラグを黙って無視しない(誤ったコマンドラインに気づけるように)
  const lintOnly = rest.find((a) => a === "--format" || a === "--out");
  if (lintOnly !== undefined) throw new Error(`unknown flag: ${lintOnly}`);
  const f = parseFlags(rest, true);
  return runBump({
    tag,
    rootDir: resolve(f.root),
    policyFile: resolve(f.root, f.policy),
    repo: f.repo,
    noCache: f.noCache,
    gitignore: !f.noGitignore,
    conflictMarkers: f.conflictMarkers,
    allowDowngrade: f.allowDowngrade,
    dryRun: f.dryRun,
  });
}

function newProject(dir?: string): number {
  if (!dir) {
    console.error("usage: guard new <dir>");
    return 2;
  }
  const dest = resolve(dir);
  if (existsSync(dest) && readdirSync(dest).length > 0) {
    console.error(`directory not empty: ${dest} — refusing to overwrite`);
    return 2;
  }
  const standardsDir = join(ASSET_ROOT, "standards");
  if (!existsSync(standardsDir)) {
    console.error(`standards master not found: ${standardsDir}`);
    return 2;
  }
  cpSync(standardsDir, dest, { recursive: true });
  restoreDotfiles(dest);

  // 展開時の加工: standards バージョンコメントを guardsmith 版へ更新
  const claudeMd = join(dest, "CLAUDE.md");
  if (existsSync(claudeMd)) {
    const updated = readFileSync(claudeMd, "utf8").replace(
      /<!-- standards: novexar\/[\w-]+ v[\w.-]+ -->/,
      `<!-- standards: novexar/guardsmith v${STANDARDS_TAG} -->`,
    );
    writeFileSync(claudeMd, updated);
  }
  writeFileSync(join(dest, "guard.policy.yaml"), NEW_POLICY_TEMPLATE);
  writeVars(dest, NEW_VARS, { header: NEW_VARS_HEADER });

  console.log(
    `expanded standards into ${dest}\n` +
      "next steps:\n" +
      "  1. run the init-project skill in Claude Code to concretize CLAUDE.md / agents / docs\n" +
      `     (it records every replacement value in ${VARS_FILENAME})\n` +
      "  2. guard lint  (errors are expected until init-project is completed)",
  );
  return 0;
}

/**
 * npm パッケージ同梱時にドットなしへ退避したファイルを復元する
 * (npm pack が .gitignore を常に除外するため — novexar/Guardsmith#1)。
 * リポジトリ/バンドル配布ではもとから .gitignore が存在し、何もしない。
 */
export function restoreDotfiles(dest: string): void {
  const dotless = join(dest, "gitignore");
  const dotted = join(dest, ".gitignore");
  if (existsSync(dotless) && !existsSync(dotted)) {
    renameSync(dotless, dotted);
  } else if (existsSync(dotless)) {
    rmSync(dotless);
  }
}

async function explain(ruleId?: string): Promise<number> {
  if (!ruleId) {
    console.error("usage: guard explain <rule-id>");
    return 2;
  }
  // v0.1: ローカルポリシーのdescriptionを表示。docs連携はv0.2
  try {
    const { policy } = await loadPolicyWithMeta(resolve("guard.policy.yaml"));
    const rule = policy.rules.find((r) => r.id === ruleId);
    if (!rule) {
      console.error(`rule not found in effective policy: ${ruleId}`);
      return 2;
    }
    console.log(`${rule.id} [${rule.severity}] (check: ${rule.check})`);
    console.log(rule.description ?? "(no description)");
    return 0;
  } catch (e) {
    console.error((e as Error).message);
    return 2;
  }
}

/**
 * bin エントリポイント用: プロセスとして main を実行し exit code を反映する。
 *
 * `process.exit()` ではなく `process.exitCode` を立ててイベントループの自然終了に任せる。
 * リモート取得(undici)のハンドルが閉じ切る前に強制終了すると、Windows で libuv が
 * `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)` を起こし、意図した 2 ではなく
 * 127 で落ちる — 「取得に失敗したのか CLI が壊れたのか」が CI から判別できなくなる。
 */
export function runCli(): Promise<void> {
  return main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((e: unknown) => {
      console.error(`error: ${(e as Error).message}`);
      process.exitCode = 2;
    });
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(resolve(entry)).href) {
  void runCli();
}

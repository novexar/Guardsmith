#!/usr/bin/env node
/**
 * GuardSmith CLI
 *   guard init                     # guard.policy.yaml を生成(30秒体験の入口)
 *   guard lint [--root <dir>] [--policy <file>] [--format console|sarif|json] [--out <file>] [--no-cache]
 *   guard sync [--root <dir>] [--policy <file>] [--write] [--no-cache]   # 既定は dry-run
 *   guard new <dir>                # standards/ 一式から新規PJ雛形を展開
 *   guard explain <rule-id>
 * exit code: 0 = pass / 1 = error検出 / 2 = 実行エラー
 */
import { cpSync, existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { formatConsole, runLint } from "./lint.js";
import { ASSET_ROOT } from "./paths.js";
import { loadPolicy, toSarif } from "./resolver.js";
import { applySync, formatPlan, planSync } from "./sync.js";

const VERSION = "0.2.1";

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
  - github:novexar/guardsmith//presets/baseline.yaml@v${VERSION}
rules: []
exemptions: []
output:
  formats: [console]
`;

export async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case "init":
      return init();
    case "lint":
      return lint(parseFlags(rest));
    case "sync":
      return sync(parseFlags(rest));
    case "new":
      return newProject(rest[0]);
    case "explain":
      return explain(rest[0]);
    default:
      console.error(
        "usage: guard <init|lint|sync|new|explain>\n" +
          "  guard init\n" +
          "  guard lint [--root <dir>] [--policy <file>] [--format console|sarif|json] [--out <file>] [--no-cache]\n" +
          "  guard sync [--root <dir>] [--policy <file>] [--write] [--no-cache]\n" +
          "  guard new <dir>\n" +
          "  guard explain <rule-id>",
      );
      return 2;
  }
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
  write: boolean;
}

function parseFlags(args: string[]): Flags {
  const f: Flags = {
    root: ".",
    policy: "guard.policy.yaml",
    format: "console",
    noCache: false,
    write: false,
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--root") f.root = args[++i];
    else if (a === "--policy") f.policy = args[++i];
    else if (a === "--format") f.format = args[++i] as Flags["format"];
    else if (a === "--out") f.out = args[++i];
    else if (a === "--no-cache") f.noCache = true;
    else if (a === "--write") f.write = true;
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
  const policy = await loadPolicy(policyPath, { noCache: f.noCache });
  const result = await runLint(policy, resolve(f.root));

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

async function sync(f: Flags): Promise<number> {
  const policyPath = resolve(f.root, f.policy);
  if (!existsSync(policyPath)) {
    console.error(`policy not found: ${policyPath} — run 'guard init' first`);
    return 2;
  }
  const policy = await loadPolicy(policyPath, { noCache: f.noCache });
  const plan = await planSync(policy, resolve(f.root));
  if (f.write) applySync(plan, resolve(f.root));
  console.log(formatPlan(plan, f.write));
  return 0;
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

  // 展開時の加工: standards バージョンコメントを guardsmith 版へ更新
  const claudeMd = join(dest, "CLAUDE.md");
  if (existsSync(claudeMd)) {
    const updated = readFileSync(claudeMd, "utf8").replace(
      /<!-- standards: novexar\/[\w-]+ v[\w.-]+ -->/,
      `<!-- standards: novexar/guardsmith v${VERSION} -->`,
    );
    writeFileSync(claudeMd, updated);
  }
  writeFileSync(join(dest, "guard.policy.yaml"), NEW_POLICY_TEMPLATE);

  console.log(
    `expanded standards into ${dest}\n` +
      "next steps:\n" +
      "  1. run the init-project skill in Claude Code to concretize CLAUDE.md / agents / docs\n" +
      "  2. guard lint  (errors are expected until init-project is completed)",
  );
  return 0;
}

async function explain(ruleId?: string): Promise<number> {
  if (!ruleId) {
    console.error("usage: guard explain <rule-id>");
    return 2;
  }
  // v0.1: ローカルポリシーのdescriptionを表示。docs連携はv0.2
  try {
    const policy = await loadPolicy(resolve("guard.policy.yaml"));
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

/** bin エントリポイント用: プロセスとして main を実行し exit code を反映する */
export function runCli(): void {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((e: unknown) => {
      console.error(`error: ${(e as Error).message}`);
      process.exit(2);
    });
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(resolve(entry)).href) {
  runCli();
}

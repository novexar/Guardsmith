/**
 * `guard sync --init-vars` — 既存 PJ の guardsmith.vars.yaml を推定生成する。
 *
 * 既に init-project 済みの PJ は「どのプレースホルダに何を入れたか」を失っている。
 * 旧マスター(PJ が展開した版)の各行のプレースホルダ位置と、PJ の対応行を突き合わせて
 * 値を逆算する。**推定であって正ではない**ため:
 *   - 決められなかったキーは `TODO`(残っている限り guard bump は止まる)
 *   - 候補が割れたキーは最頻値を採用し、全候補をコメントで並記する
 *   - 秘密情報らしき値は採用せず `TODO` へ落とす(vars はコミット対象 — R6)
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createGlobScope, globFiles } from "./glob.js";
import { DEFAULT_SECRET_PATTERNS } from "./lint.js";
import { diffChunks, toLines } from "./merge3.js";
import { PLACEHOLDER_RE, extractPlaceholderKeys, normalizeMaster, stampFor } from "./normalize.js";
import { loadPolicyWithMeta, resolveBaseMasters } from "./resolver.js";
import { readStampTag, VARS_FILENAME, writeVars, type VarsDocument } from "./vars.js";
import type { RemoteOptions } from "./remote.js";

/** 値を決められなかったキーに入れるリテラル。guard bump はこれが残っていると止まる */
export const TODO_VALUE = "TODO";

export interface InferredVars {
  /** 確定した値(決められなかったキーは TODO_VALUE) */
  vars: Record<string, string>;
  /** 値を決められず TODO を入れたキー */
  todo: string[];
  /** 複数候補が出たキー → 頻度降順の全候補 */
  ambiguous: Record<string, string[]>;
  /** 秘密情報らしき値だったため採用せず TODO に落としたキー */
  redacted: string[];
}

/**
 * 旧マスターと PJ ファイルから置換値を推定する。
 * masterFiles は「gen コメント除去・警告ブロック除去・EOL 正規化」まで進め、
 * **プレースホルダは描画していない** テキストであること。
 */
export function inferVars(
  masterFiles: ReadonlyMap<string, string>,
  localFiles: ReadonlyMap<string, string>,
): InferredVars {
  const candidates = new Map<string, string[]>();
  const keys: string[] = [];

  for (const [file, master] of masterFiles) {
    for (const key of extractPlaceholderKeys(master)) {
      if (!keys.includes(key)) keys.push(key);
    }
    const local = localFiles.get(file);
    if (local === undefined) continue; // PJ が削除済み → その行からは何も推定できない
    for (const [key, values] of inferFromFile(master, local)) {
      const bucket = candidates.get(key) ?? [];
      bucket.push(...values);
      candidates.set(key, bucket);
    }
  }

  const vars: Record<string, string> = {};
  const todo: string[] = [];
  const ambiguous: Record<string, string[]> = {};
  const redacted: string[] = [];

  for (const key of keys) {
    const ranked = rankByFrequency(candidates.get(key) ?? []);
    if (ranked.length > 1) ambiguous[key] = ranked;
    const best = ranked[0];
    if (best === undefined) {
      vars[key] = TODO_VALUE;
      todo.push(key);
    } else if (looksSecret(best)) {
      // R6: 秘密情報は値そのものを書き出さない(vars はコミット対象)
      vars[key] = TODO_VALUE;
      todo.push(key);
      redacted.push(key);
      delete ambiguous[key];
    } else {
      vars[key] = best;
    }
  }
  return { vars, todo, ambiguous, redacted };
}

/**
 * 1 ファイル分の推定。プレースホルダを含むマスター行をテンプレ正規表現化し、
 * 対応する PJ 行から値を切り出す。
 *
 * 計画(§2.2)のシグネチャは `Map<string, Set<string>>` だったが、§2.4 の「最頻値を採用」
 * には出現回数が要るため、重複を保った出現順の配列を返す。
 */
export function inferFromFile(master: string, local: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const chunk of diffChunks(toLines(master), toLines(local))) {
    // 行数が 1:1 のブロックだけを対応付けの候補にする(ずれた対応から値を作らない)
    if (chunk.left.length !== chunk.right.length) continue;
    for (let i = 0; i < chunk.left.length; i++) {
      collectLine(out, chunk.left[i], chunk.right[i]);
    }
  }
  return out;
}

function collectLine(out: Map<string, string[]>, masterLine: string, localLine: string): void {
  const template = buildTemplate(masterLine);
  if (template === null) return;
  const m = template.re.exec(localLine);
  if (m === null) return;
  for (let i = 0; i < template.keys.length; i++) {
    const value = m[i + 1];
    if (value === undefined || value.trim() === "") continue;
    const bucket = out.get(template.keys[i]) ?? [];
    bucket.push(value);
    out.set(template.keys[i], bucket);
  }
}

interface LineTemplate {
  re: RegExp;
  keys: string[];
}

/**
 * マスター行 → 値抽出用の正規表現。
 * 区切り文字ゼロで隣接するプレースホルダ(`{{A}}{{B}}`)は切り出し不能なので行ごと諦める。
 */
function buildTemplate(masterLine: string): LineTemplate | null {
  const keys: string[] = [];
  let pattern = "";
  let last = 0;
  let adjacent = false;
  for (const m of masterLine.matchAll(PLACEHOLDER_RE)) {
    const literal = masterLine.slice(last, m.index);
    if (keys.length > 0 && literal === "") adjacent = true;
    pattern += escapeRegExp(literal) + "(.*?)";
    keys.push(m[1].trim());
    last = m.index + m[0].length;
  }
  if (keys.length === 0 || adjacent) return null;
  pattern += escapeRegExp(masterLine.slice(last));
  return { re: new RegExp(`^${pattern}$`), keys };
}

/** 出現回数の多い順(同数は初出順)に候補を並べる */
function rankByFrequency(values: readonly string[]): string[] {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([v]) => v);
}

function looksSecret(value: string): boolean {
  return DEFAULT_SECRET_PATTERNS.some((p) => p.re.test(value));
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/* ---------------- CLI 実行 ---------------- */

export interface InitVarsOptions extends RemoteOptions {
  rootDir: string;
  /** guard.policy.yaml の絶対パス */
  policyFile: string;
  gitignore?: boolean;
}

/** 0 = 生成した / 2 = 生成できない(既存ファイル・スタンプ欠落・drift3 ルール無し) */
export async function runInitVars(opts: InitVarsOptions): Promise<number> {
  const { rootDir, policyFile } = opts;
  if (existsSync(join(rootDir, VARS_FILENAME))) {
    console.error(`${VARS_FILENAME} already exists — not overwriting`);
    return 2;
  }
  const claudeMd = join(rootDir, "CLAUDE.md");
  const stampTag = existsSync(claudeMd) ? readStampTag(readFileSync(claudeMd, "utf8")) : null;
  if (stampTag === null) {
    console.error(
      "cannot determine the standards tag: CLAUDE.md has no `<!-- standards: ... -->` stamp — " +
        `write ${VARS_FILENAME} with a \`standards:\` tag by hand and re-run`,
    );
    return 2;
  }

  const { policy, driftOrigins } = await loadPolicyWithMeta(policyFile, opts);
  const rules = policy.rules.filter((r) => r.check === "drift3");
  if (rules.length === 0) {
    console.error("no `check: drift3` rule in the effective policy — nothing to infer");
    return 2;
  }
  const origins = new Map(
    [...driftOrigins].filter(([id]) => rules.some((r) => r.id === id)),
  ) as ReadonlyMap<string, string>;
  const baseRoots = await resolveBaseMasters(origins, stampTag, opts);

  const masterFiles = new Map<string, string>();
  const localFiles = new Map<string, string>();
  const localScope = await createGlobScope(rootDir, { gitignore: opts.gitignore });
  for (const rule of rules) {
    const baseRoot = baseRoots.get(rule.id);
    if (baseRoot === undefined) continue;
    const masterScope = await createGlobScope(baseRoot, { gitignore: false });
    for (const file of await globFiles(masterScope, rule.with.paths)) {
      if (!file.toLowerCase().endsWith(".md") || masterFiles.has(file)) continue;
      const raw = readFileSync(join(baseRoot, file), "utf8");
      // プレースホルダは描画しない(位置を残したままテンプレとして使う)
      masterFiles.set(file, normalizeMaster(raw, { vars: {}, stamp: stampFor(stampTag) }).text);
    }
    for (const file of await globFiles(localScope, rule.with.paths)) {
      if (localFiles.has(file)) continue;
      localFiles.set(file, readFileSync(join(rootDir, file), "utf8"));
    }
  }

  if (masterFiles.size === 0) {
    // 空の vars を黙って書くと「推定できた結果ゼロ件」と区別がつかない
    console.error(
      `no master files matched the drift3 paths at ${stampTag} — ` +
        "check the rule's `source` and that the tag is the one the project was generated from",
    );
    return 2;
  }

  const inferred = inferVars(masterFiles, localFiles);
  const mismatch = extendsTagMismatch(readFileSync(policyFile, "utf8"), stampTag);
  const doc: VarsDocument = { version: 1, standards: stampTag, vars: inferred.vars };
  writeVars(rootDir, doc, {
    header: header(inferred, stampTag, mismatch),
    keyNotes: keyNotes(inferred),
  });

  report(inferred, stampTag, mismatch);
  return 0;
}

/** policy の extends が指すタグがスタンプと食い違っていれば、その相手タグを返す */
function extendsTagMismatch(policyText: string, stampTag: string): string[] {
  const tags = new Set<string>();
  for (const m of policyText.matchAll(/github:[\w.-]+\/[\w.-]+(?:\/\/[\w./-]+)?@(v[\w.-]+)/g)) {
    if (m[1] !== stampTag) tags.add(m[1]);
  }
  return [...tags];
}

function header(inferred: InferredVars, stampTag: string, mismatch: string[]): string[] {
  const lines = [
    `guard sync --init-vars が推定した下書き(基準タグ: ${stampTag} — CLAUDE.md のスタンプ由来)。`,
    "推定であって正ではない。全ての値を PM がレビューし、TODO を埋めてからコミットすること。",
  ];
  if (inferred.todo.length > 0) {
    lines.push(`TODO が ${inferred.todo.length} 件残っている: ${inferred.todo.join(", ")}`);
  }
  if (inferred.redacted.length > 0) {
    lines.push(
      `秘密情報らしき値だったため採用しなかったキー: ${inferred.redacted.join(", ")}` +
        "(vars はコミット対象。値は環境変数・シークレット管理へ移すこと)",
    );
  }
  if (mismatch.length > 0) {
    lines.push(
      `警告: guard.policy.yaml の extends は ${mismatch.join(", ")} を指しており、` +
        `CLAUDE.md のスタンプ(${stampTag})と食い違う。`,
      "`standards:` は実際に取り込んだ標準のタグに直すこと(extends だけ先に上げた場合は" +
        "スタンプ側が正)。",
    );
  }
  return lines;
}

function keyNotes(inferred: InferredVars): Record<string, string[]> {
  const notes: Record<string, string[]> = {};
  for (const [key, values] of Object.entries(inferred.ambiguous)) {
    notes[key] = [
      `候補が複数あり最頻値を採用: ${values.map((v) => JSON.stringify(v)).join(" / ")}`,
    ];
  }
  for (const key of inferred.redacted) {
    notes[key] = ["推定値が秘密情報パターンに一致したため採用しなかった"];
  }
  for (const key of inferred.todo) {
    if (notes[key] === undefined) notes[key] = ["値を推定できなかった — 手で埋めること"];
  }
  return notes;
}

function report(inferred: InferredVars, stampTag: string, mismatch: string[]): void {
  const total = Object.keys(inferred.vars).length;
  if (mismatch.length > 0) {
    console.error(
      `warning: guard.policy.yaml extends ${mismatch.join(", ")} but CLAUDE.md is stamped ` +
        `${stampTag} — fix \`standards:\` to the tag actually applied`,
    );
  }
  console.log(
    `wrote ${VARS_FILENAME} (standards ${stampTag}): ${total} keys, ` +
      `${inferred.todo.length} TODO, ${Object.keys(inferred.ambiguous).length} ambiguous\n` +
      "review every value before committing — guard bump refuses to run while TODO remains",
  );
}

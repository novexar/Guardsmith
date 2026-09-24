/**
 * standards 3-way 取り込み — 旧マスター(base)と新マスター(theirs)の差分を、
 * PJ の実ファイル(ours)へマージする計画の生成・適用・表示。
 *
 * 節単位モード(`sync.ts` / `check: drift`)との違い:
 *   節単位は「マスターが正、許可節だけ PJ を残す」= PJ の編集を原則捨てる。
 *   3-way は「PJ が正、標準の変更分だけ取り込む」= PJ の編集を保ったまま追随できる。
 *
 * 衝突時の既定は D6 に従い **1 ファイルも書かない**(部分適用で中途半端な作業ツリーを
 * 残さない)。`conflictMarkers` のときだけマーカー入りで書き、基準タグは進めない。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createGlobScope, globFiles, type GlobScope } from "./glob.js";
import { detectEol, merge3, type ConflictRegion } from "./merge3.js";
import { STAMP_RE, normalizeMaster, stampFor } from "./normalize.js";
import { withStandardsTag, writeVars, type VarsDocument } from "./vars.js";

export type Sync3Kind =
  | "merge" // クリーンに適用できる
  | "create" // 新マスターにのみ存在 → 追加
  | "conflict" // 衝突
  | "skip-deleted" // PJ が削除済み(info)
  | "removed" // 新マスターから消えた(info、自動削除しない)
  | "unchanged";

export interface Sync3Action {
  file: string;
  kind: Sync3Kind;
  /** merge / create / (markers 時の) conflict で書き出す全内容 */
  content?: string;
  conflicts: ConflictRegion[];
  unresolvedVars: string[];
  /** 表示用の補足(正規化対象外ファイルのテンプレート記法など) */
  note?: string;
}

export interface Sync3Plan {
  actions: Sync3Action[];
  /** マスターに存在しない PJ ローカルファイル(維持) */
  localOnly: string[];
  /** 衝突したファイル(表示・終了コード判定用) */
  conflicted: string[];
  /** 適用後に vars.standards / スタンプを進める先 */
  nextTag: string;
  baseTag: string;
  /**
   * 計画時に --conflict-markers が指定されていたか。
   * content の有無から推測すると、マーカーを作れない衝突(バイナリ等)しか無いときに
   * 「指定したのに 1 ファイルも書かれない」事故になるため、明示的に持ち回す。
   */
  conflictMarkers: boolean;
}

/** drift3 ルール 1 本分の入力。CLI / resolver が組み立てる */
export interface Drift3Source {
  ruleId: string;
  paths: string[];
  /** 旧マスター(file: 解決済みの絶対パス) */
  baseRoot: string;
  /** 新マスター(file: 解決済みの絶対パス) */
  headRoot: string;
  baseTag: string;
  headTag: string;
}

export interface Sync3Options {
  gitignore?: boolean;
  conflictMarkers?: boolean;
}

/** 正規化済みマスター 1 ファイル分 */
interface MasterText {
  text: string;
  unresolved: string[];
}

/** 書き出しを伴う種別(= 適用対象) */
const WRITABLE: ReadonlySet<Sync3Kind> = new Set<Sync3Kind>(["merge", "create", "conflict"]);

/** 旧マスターに存在しなかったファイルの base(空の base との 3-way にする) */
const EMPTY_MASTER: MasterText = { text: "", unresolved: [] };

/** 3-way 取り込みの計画を作る。sources の root は file: 解決済みであること */
export async function planSync3(
  sources: readonly Drift3Source[],
  rootDir: string,
  vars: Readonly<VarsDocument>,
  options: Readonly<Sync3Options> = {},
): Promise<Sync3Plan> {
  const actions: Sync3Action[] = [];
  const localOnly: string[] = [];
  const seen = new Set<string>();
  const localScope = await createGlobScope(rootDir, { gitignore: options.gitignore });
  // マスターは配布物そのもの。ローカルの .gitignore を適用する対象ではない
  const scopes = new Map<string, GlobScope>();

  for (const source of sources) {
    const baseFiles = new Set(
      await globFiles(await scopeFor(scopes, source.baseRoot), source.paths),
    );
    const headFiles = new Set(
      await globFiles(await scopeFor(scopes, source.headRoot), source.paths),
    );
    for (const file of [...new Set([...baseFiles, ...headFiles])].sort()) {
      if (seen.has(file)) continue;
      seen.add(file);
      const action = planFile(file, source, rootDir, vars.vars, options);
      if (action !== null) actions.push(action);
    }
    for (const file of await globFiles(localScope, source.paths)) {
      const known = baseFiles.has(file) || headFiles.has(file);
      if (!known && !localOnly.includes(file)) localOnly.push(file);
    }
  }

  return {
    actions,
    localOnly,
    conflicted: actions.filter((a) => a.kind === "conflict").map((a) => a.file),
    baseTag: sources[0]?.baseTag ?? vars.standards,
    nextTag: sources[0]?.headTag ?? vars.standards,
    conflictMarkers: options.conflictMarkers === true,
  };
}

/**
 * 計画を実ファイルへ適用する。
 * 衝突が 1 件でもあれば既定で何も書かない(markers 指定時のみマーカー入りで書き、
 * 未解決のまま基準タグを進めることはしない)。
 */
export function applySync3(
  plan: Readonly<Sync3Plan>,
  rootDir: string,
  vars: Readonly<VarsDocument>,
): void {
  const writable = plan.actions.filter((a) => WRITABLE.has(a.kind) && a.content !== undefined);
  if (plan.conflicted.length > 0) {
    // markers 指定時は衝突していないファイルも書く(指定したのに全て無変更、を避ける)。
    // ただし未解決が残る以上、基準タグとスタンプは進めない
    if (plan.conflictMarkers) for (const a of writable) writeAction(rootDir, a);
    return;
  }
  for (const a of writable) writeAction(rootDir, a);
  writeVars(rootDir, withStandardsTag(vars, plan.nextTag));
  ensureStamp(rootDir, plan.nextTag);
}

/** dry-run / 適用結果の表示 */
export function formatSync3Plan(plan: Readonly<Sync3Plan>, write: boolean): string {
  const lines: string[] = [`standards ${plan.baseTag} → ${plan.nextTag}`];
  for (const a of plan.actions) {
    const line = formatAction(a);
    if (line !== null) lines.push(line);
    if (a.unresolvedVars.length > 0) {
      lines.push(`INFO     ${a.file} — unresolved vars: ${a.unresolvedVars.join(", ")}`);
    }
    if (a.note !== undefined) lines.push(`INFO     ${a.file} — ${a.note}`);
  }
  for (const f of plan.localOnly) lines.push(`KEEP     ${f} (project-local, not in master)`);
  lines.push("", summary(plan, write));
  return lines.join("\n");
}

/* ---------- 計画 ---------- */

function planFile(
  file: string,
  source: Readonly<Drift3Source>,
  rootDir: string,
  vars: Readonly<Record<string, string>>,
  options: Readonly<Sync3Options>,
): Sync3Action | null {
  const localPath = join(rootDir, file);
  const hasLocal = existsSync(localPath);
  const headPath = join(source.headRoot, file);
  if (!existsSync(headPath)) {
    // D8: 自動削除はしない。PJ に残っているときだけ案内する
    return hasLocal ? bare(file, "removed") : null;
  }

  const markdown = file.toLowerCase().endsWith(".md");
  const head = readMaster(headPath, source.headTag, vars, markdown);
  const basePath = join(source.baseRoot, file);
  const base = existsSync(basePath) ? readMaster(basePath, source.baseTag, vars, markdown) : null;

  if (!hasLocal) {
    const missing = planMissingLocal(file, head, base);
    return missing === null ? null : withNote(missing, file, markdown, head);
  }

  // EOL は正規化せずそのまま渡す。merge3 が ours の EOL を検出して復元するため、
  // ここで LF へ潰すと CRLF の PJ で全行が差分になる
  const local = readFileSync(localPath, "utf8");
  const action = planThreeWay(file, local, base ?? EMPTY_MASTER, head, source, markdown, options);
  return withNote(addUntrackedNote(action, base), file, markdown, head);
}

/** PJ に実体が無いファイル。変更も無く PJ にも無いものは計画に載せない */
function planMissingLocal(
  file: string,
  head: MasterText,
  base: MasterText | null,
): Sync3Action | null {
  // D7: 旧マスターに無く新マスターにある → 追加
  if (base === null) {
    return {
      file,
      kind: "create",
      content: head.text,
      conflicts: [],
      unresolvedVars: head.unresolved,
    };
  }
  // D9: 標準側に変更があるのに PJ に無い = 節ごと削除済み。CREATE にはしない
  return base.text === head.text ? null : bare(file, "skip-deleted", head.unresolved);
}

/**
 * 旧マスターに無く新マスターにあり、PJ にも同名がある場合の補足(D7: CONFLICT)。
 * 空の base との 3-way になるので、内容が完全一致なら unchanged、違えば conflict になる。
 */
function addUntrackedNote(action: Sync3Action, base: MasterText | null): Sync3Action {
  if (base !== null || action.kind !== "conflict") return action;
  return {
    ...action,
    note: "added in master while the project already has a file of the same name",
  };
}

function planThreeWay(
  file: string,
  local: string,
  base: MasterText,
  head: MasterText,
  source: Readonly<Drift3Source>,
  markdown: boolean,
  options: Readonly<Sync3Options>,
): Sync3Action {
  if (base.text === head.text) return bare(file, "unchanged", head.unresolved);
  if (!markdown) {
    // §3.3: 正規化しないファイルはバイト比較。標準側が動いた以上は手動対応させる
    // (マーカーを差し込めないため、markers 指定でも content は持たせない)
    return local === head.text
      ? bare(file, "unchanged", head.unresolved)
      : {
          ...bare(file, "conflict", head.unresolved),
          note: "non-markdown master changed — resolve manually",
        };
  }
  const res = merge3(local, base.text, head.text, {
    markers: options.conflictMarkers === true,
    labels: {
      ours: "ours (project)",
      base: `base (standards ${source.baseTag})`,
      theirs: `theirs (standards ${source.headTag})`,
    },
  });
  if (res.conflicts.length > 0) {
    return {
      file,
      kind: "conflict",
      content: res.merged,
      conflicts: res.conflicts,
      unresolvedVars: head.unresolved,
    };
  }
  return res.changed
    ? { file, kind: "merge", content: res.merged, conflicts: [], unresolvedVars: head.unresolved }
    : bare(file, "unchanged", head.unresolved);
}

/** §3.3: 正規化対象外のマスターにテンプレート記法が残っていたら知らせる */
function withNote(
  action: Sync3Action,
  file: string,
  markdown: boolean,
  head: MasterText,
): Sync3Action {
  if (markdown || action.note !== undefined) return action;
  if (!/\{\{|gen:/.test(head.text)) return action;
  return { ...action, note: `master contains template syntax but ${file} is not normalized` };
}

function readMaster(
  path: string,
  tag: string,
  vars: Readonly<Record<string, string>>,
  markdown: boolean,
): MasterText {
  const raw = readFileSync(path, "utf8");
  if (!markdown) return { text: raw, unresolved: [] };
  return normalizeMaster(raw, { vars, stamp: stampFor(tag) });
}

function bare(file: string, kind: Sync3Kind, unresolvedVars: readonly string[] = []): Sync3Action {
  return { file, kind, conflicts: [], unresolvedVars: [...unresolvedVars] };
}

async function scopeFor(cache: Map<string, GlobScope>, root: string): Promise<GlobScope> {
  const cached = cache.get(root);
  if (cached !== undefined) return cached;
  const scope = await createGlobScope(root, { gitignore: false });
  cache.set(root, scope);
  return scope;
}

/* ---------- 適用 ---------- */

function writeAction(rootDir: string, action: Readonly<Sync3Action>): void {
  // content 無しを空ファイルで上書きしない(呼び出し側の絞り込みが緩んでも壊れないように)
  if (action.content === undefined) return;
  const path = join(rootDir, action.file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, action.content);
}

/** U3: PJ がスタンプ行を消していた場合に末尾へ追記する fallback */
function ensureStamp(rootDir: string, tag: string): void {
  const path = join(rootDir, "CLAUDE.md");
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  if (STAMP_RE.test(text)) return;
  const eol = detectEol(text);
  const head = text.endsWith("\n") ? text : `${text}${eol}`;
  writeFileSync(path, `${head}${eol}<!-- standards: ${stampFor(tag)} -->${eol}`);
}

/* ---------- 表示 ---------- */

function formatAction(a: Readonly<Sync3Action>): string | null {
  switch (a.kind) {
    case "merge":
      return `MERGE    ${a.file} (standards change applied cleanly)`;
    case "create":
      return `CREATE   ${a.file} (new in master)`;
    case "conflict":
      return `CONFLICT ${a.file} — ${a.conflicts.length} region(s) at line ${a.conflicts
        .map((c) => c.startLine + 1)
        .join(", ")}`;
    case "skip-deleted":
      return `SKIP     ${a.file} (deleted in project — standards change not applied)`;
    case "removed":
      return `REMOVED  ${a.file} (gone from master — left in place, delete manually if unused)`;
    case "unchanged":
      return null;
  }
}

function summary(plan: Readonly<Sync3Plan>, write: boolean): string {
  const count = (kind: Sync3Kind): number => plan.actions.filter((a) => a.kind === kind).length;
  const head =
    `${count("merge")} merge, ${count("create")} create, ${plan.conflicted.length} conflict, ` +
    `${count("skip-deleted")} skipped, ${count("removed")} removed, ${plan.localOnly.length} project-local`;
  if (plan.conflicted.length > 0) {
    return `${head} — conflicts must be resolved manually (nothing written without --conflict-markers)`;
  }
  const changes = count("merge") + count("create");
  if (changes === 0) return `${head} — already in sync`;
  return write ? `${head} — applied` : `${head} — dry-run (use --write to apply)`;
}

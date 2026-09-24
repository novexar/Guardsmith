/**
 * import-budget — CLAUDE.md と `@` インポート先を合わせた「起動時に常駐する量」を測る check。
 *
 * 行数だけを見る max-lines(claude-md/thin-diff)では、本体が薄くても `@` で複数の文書を
 * 取り込んでいる CLAUDE.md を「軽量」と誤判定する。インポート先は起動時に丸ごと展開されて
 * 常駐するため、本 check は本体 + インポート先の合計文字数を可視化し、上限を任意で課す。
 *
 * ── 公式仕様の確認(2026-09-24 / https://code.claude.com/docs/en/memory の
 *    "Import additional files" 節)─────────────────────────────────────────────
 *  (a) 構文は `@path/to/import`。「reference them with `@` syntax anywhere in your
 *      CLAUDE.md」とあり、行頭に限らず文中・箇条書きの途中でも有効
 *  (b) 相対パスは「the file containing the import」= そのファイルのディレクトリ基準
 *      (カレントディレクトリ基準ではない)
 *  (c) 絶対パスも許可。`@~/.claude/...` のようなホームディレクトリ参照も可。ただし
 *      working directory の外に解決される参照は "external import" 扱いで、Claude Code 側で
 *      ユーザー承認ダイアログの対象になる
 *  (d) 再帰インポートの上限は **4 hops**("with a maximum depth of four hops")
 *  (e) 「Import parsing skips Markdown code spans and fenced code blocks」。
 *      バッククォートで囲めば `@README` は取り込まれない
 *
 * ── コードとして読み飛ばす範囲(公式仕様は「code spans と fenced code blocks」のみ)──
 *  - フェンスドコードブロック: ``` / ~~~ で開き、**インデント量は問わない**(リスト項目の
 *    中に置かれたフェンスが本リポジトリの文書で頻出するため)。閉じは同じマーカー文字・
 *    同じ長さ以上・info string 無しの行
 *  - コードスパン: バッククォートの対応で判定し、**段落(空行区切り)単位**でマスクする。
 *    行をまたぐスパンを扱うためで、段落内に閉じが無いバッククォートはリテラルとして残す
 *  - **インデントコードブロック(4 スペース)はコードとして扱わない**。公式仕様に挙がって
 *    おらず、CLAUDE.md ではネストしたリスト項目が 4 スペース字下げされるため、コード扱いに
 *    すると常駐量を過小計上する
 *
 * 公式仕様に書かれておらず本実装で補った点(いずれも保守的側に倒している):
 *  - パス終端の定義: 空白・引用符・山括弧・`|`・`*`・各種括弧・`,`・`;`、および日本語
 *    ドキュメントで頻出する全角括弧・読点・句点で終端し、末尾の句読点(`.,;:!?`)は落とす
 *    (例: 表セルの `@vitest/coverage-v8(80%ゲート)` を丸ごとパスとして拾わない)
 *  - `@` の直前は「メールアドレスのローカル部でないこと」で判定する(後読み)。日本語では
 *    `詳細は@docs/X.md` のように `@` の前に空白が無いのが普通で、空白必須にすると過小計上で
 *    check が実質無効になるため。`user@example.com` は従来どおり除外される
 *  - 解決できない参照のうち「パス形状でない」もの(`/` も `.` も含まない、または末尾が
 *    非 ASCII = 日本語の助詞等が続いている)は unresolved の info を出さない。また同じ参照は
 *    初出の位置だけ報告する(`@types/node` のようなスコープ付きパッケージ名のノイズ対策)。
 *    `@docs/日本語.md` は末尾が ASCII の `.md` なので報告対象のまま
 *  - 同一ファイルの別名(大文字小文字の違い・root 内のシンボリックリンク経由)は realpath を
 *    キーにして 1 回だけ数える。表示は最初に到達した字句パスを使う
 *  - セキュリティ: root(走査ルート)の外に解決される参照は **読みに行かない**。二重の防御で
 *    封じ込め、いずれも info「outside root, not measured」として報告するに留める:
 *      1. 文字列レベル: `..` での脱出・絶対パス・`~` 始まり・`\` を含む参照を弾く
 *         (`\` は公式仕様の区切りではないうえ、Windows の `path.win32.join` が後段で
 *          区切りとして解釈するため `docs\..\..\secret.md` が root 外へ解決されてしまう)
 *      2. リンクレベル: 読み込み直前に realpath を取り、root の realpath 配下にあることを
 *         区切り付きで確認する(root 内のシンボリックリンクが外を指すケースの対策。
 *          `root2/` を `root/` 配下と誤判定しない)
 */
import { readFileSync, realpathSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { globFiles, type GlobScope } from "./glob.js";
import type { Rule } from "./schema.js";
import type { Finding } from "./lint.js";

/** 公式仕様の再帰インポート上限(four hops) */
export const DEFAULT_IMPORT_MAX_DEPTH = 4;

/** 内訳に列挙するファイル数の上限(超過分は others にまとめる) */
const BREAKDOWN_LIMIT = 10;

/** 粗いトークン換算(実測ではない目安): 1 token ≒ 4 chars */
const CHARS_PER_TOKEN = 4;

/* ---------- インポート参照の抽出 ---------- */

export interface ImportRef {
  /** `@` に続く生の参照文字列 */
  readonly ref: string;
  /** 1 起点の行番号 */
  readonly line: number;
}

/** フェンス行。インデント量は問わない。m[2] = マーカー、m[3] = info string */
const FENCE = /^(\s*)(`{3,}|~{3,})(.*)$/;

/**
 * `@<path>`。直前がメールアドレスのローカル部を構成する文字でなければインポートとみなす。
 *
 * 空白必須にしないのは、日本語ドキュメントでは `詳細は@docs/X.md` のように `@` の前に空白が
 * 入らないのが普通で、空白必須だと大半のインポートを取りこぼし check が実質無効になるため。
 * `user@example.com` は直前が `r` なので従来どおり除外される。
 *
 * 括弧・引用符・区切り記号・`*`(強調記法)で終端する。全角括弧・読点・句点も終端に含める
 * のは、日本語ドキュメントの「@pkg(補足)」を丸ごと拾わないため(全角スペースは `\s`)。
 */
const IMPORT = /(?<![A-Za-z0-9_.+-])@([^\s`"'<>|*(){}[\],;、。「」『』（）]+)/g;

/** 末尾の句読点はパスの一部とみなさない */
const TRAILING_PUNCT = /[.,;:!?]+$/;

/** 末尾が非 ASCII(日本語の助詞などが続いている可能性が高い) */
const NON_ASCII_TAIL = /[^ -\u007f]$/;

/**
 * unresolved として報告する価値がある「パス形状」の参照か。
 * `@types`(区切りも拡張子も無い)や `@docs/Y.mdを参照`(助詞が付いた)は報告しない。
 * `@docs/日本語.md` は末尾が ASCII の `.md` なので報告対象のまま。
 */
export function isPathShaped(ref: string): boolean {
  if (!ref.includes("/") && !ref.includes(".")) return false;
  return !NON_ASCII_TAIL.test(ref);
}

/**
 * Markdown から `@` インポート参照を抽出する。
 * フェンスドコードブロックは丸ごと、コードスパンは段落単位で読み飛ばす。
 */
export function extractImportRefs(text: string): ImportRef[] {
  const refs: ImportRef[] = [];
  const lines = text.split(/\r?\n/);
  let fence: string | null = null;
  let chunk: string[] = [];
  let chunkStart = 1;

  const flush = (): void => {
    if (chunk.length > 0) collectChunk(chunk, chunkStart, refs);
    chunk = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = FENCE.exec(line);
    if (fence !== null) {
      if (m !== null && isClosingFence(m[2], m[3], fence)) fence = null;
      continue;
    }
    if (m !== null) {
      flush();
      fence = m[2];
      continue;
    }
    if (line.trim() === "") {
      flush(); // 段落の区切り。未閉のバッククォートを次の段落へ持ち越さない
      continue;
    }
    if (chunk.length === 0) chunkStart = i + 1;
    chunk.push(line);
  }
  flush();
  return refs;
}

/** 閉じフェンスは同じ文字・同じ長さ以上・info string 無し */
function isClosingFence(marker: string, rest: string, open: string): boolean {
  return marker[0] === open[0] && marker.length >= open.length && rest.trim() === "";
}

/** 1段落分をまとめてマスクしてから行ごとに走査する(行をまたぐコードスパン対策) */
function collectChunk(lines: readonly string[], startLine: number, out: ImportRef[]): void {
  const masked = maskCodeSpans(lines.join("\n")).split("\n");
  for (let i = 0; i < masked.length; i++) {
    for (const ref of refsInLine(masked[i])) out.push({ ref, line: startLine + i });
  }
}

function refsInLine(line: string): string[] {
  const out: string[] = [];
  IMPORT.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = IMPORT.exec(line)) !== null) {
    const ref = m[1].replace(TRAILING_PUNCT, "");
    if (ref.length > 0) out.push(ref);
  }
  return out;
}

/** 改行以外を空白に潰す(行番号と行長を保つ) */
function blankOut(text: string): string {
  return text.replace(/[^\n]/g, " ");
}

/**
 * コードスパン(`...` / ``...``)を同じ長さの空白へ置き換える。改行は保つので、
 * 段落をまとめて渡せば行をまたぐスパンも扱える。
 * 閉じが見つからないバッククォートはコードスパンではないので原文のまま残す。
 */
export function maskCodeSpans(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    if (text[i] !== "`") {
      out += text[i];
      i++;
      continue;
    }
    const n = runLength(text, i);
    const close = findClosingRun(text, i + n, n);
    if (close < 0) {
      out += text.slice(i, i + n);
      i += n;
      continue;
    }
    out += blankOut(text.slice(i, close + n));
    i = close + n;
  }
  return out;
}

/** 位置 start から続くバッククォートの数 */
function runLength(text: string, start: number): number {
  let n = 0;
  while (start + n < text.length && text[start + n] === "`") n++;
  return n;
}

/** ちょうど n 個のバッククォート連続の開始位置(無ければ -1) */
function findClosingRun(text: string, from: number, n: number): number {
  let j = from;
  while (j < text.length) {
    if (text[j] !== "`") {
      j++;
      continue;
    }
    const k = runLength(text, j);
    if (k === n) return j;
    j += k;
  }
  return -1;
}

/* ---------- パス解決 ---------- */

/** 絶対パス(POSIX / Windows ドライブ / UNC) */
const ABSOLUTE = /^(\/|[A-Za-z]:[/\\]|\\\\)/;

/**
 * インポート参照を root 相対の posix パスへ解決する。
 * root の外(`..` での脱出・絶対パス・`~/`)は null を返し、呼び出し側は読みに行かない。
 *
 * バックスラッシュを含む参照も null にする。公式仕様のパス区切りは `/` のみであり、
 * かつ `\` をリテラル文字として通すと Windows 側の `path.win32.join` が後段で区切りとして
 * 解釈し、`docs\..\..\secret.md` が root の外へ解決されてしまうため(保守的に不採用とする)。
 */
export function resolveImportRef(ref: string, fromRel: string): string | null {
  if (ref.startsWith("~") || ref.includes("\\") || ABSOLUTE.test(ref)) return null;
  const slash = fromRel.lastIndexOf("/");
  const dir = slash < 0 ? "" : fromRel.slice(0, slash);
  return normalizeRelative(dir === "" ? ref : `${dir}/${ref}`);
}

/** `.` / `..` を畳み、root を脱出するパスは null にする */
function normalizeRelative(path: string): string | null {
  const out: string[] = [];
  for (const seg of path.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (out.length === 0) return null;
      out.pop();
      continue;
    }
    out.push(seg);
  }
  return out.length === 0 ? null : out.join("/");
}

/* ---------- ファイル解決(root 封じ込め) ---------- */

/** 解決結果。outside は root 外、missing は通常ファイルとして存在しない */
type Found =
  | { readonly kind: "real"; readonly real: string }
  | { readonly kind: "outside" }
  | { readonly kind: "missing" };

const OUTSIDE: Found = { kind: "outside" };
const MISSING: Found = { kind: "missing" };

/**
 * realpath を取る。`native` を使うのは、Windows / macOS の大文字小文字を区別しない
 * ファイルシステムで表記ゆれ(`docs/a.md` と `docs/A.MD`)を同一キーに正規化するため
 * (JS 実装の realpathSync は与えられた表記をそのまま返す)。
 */
function canonical(abs: string): string {
  return realpathSync.native(abs);
}

/** realpath 解決済みの root(シンボリックリンク経由の脱出を判定する基準) */
export function realRoot(root: string): string {
  const abs = resolve(root);
  try {
    return canonical(abs);
  } catch {
    return abs;
  }
}

/** abs が rootReal の配下にあるか。`root2/` を `root/` の配下と誤判定しないよう区切り付きで判定 */
export function isInsideRoot(rootReal: string, abs: string): boolean {
  const prefix = rootReal.endsWith(sep) ? rootReal : rootReal + sep;
  return abs.startsWith(prefix);
}

/**
 * root 相対パスを realpath へ解決する。二重の防御:
 *  1. resolveImportRef が `..` / 絶対パス / `~` / `\` を弾く(文字列レベル)
 *  2. ここで realpath を取り、root の realpath 配下にあることを確認する(リンクレベル)
 * 返す realpath は重複計上を防ぐキーにもなる(大文字小文字の別名・リンク別名を同一視)。
 */
function resolveInsideRoot(rootReal: string, rel: string): Found {
  let real: string;
  try {
    real = canonical(join(rootReal, rel));
  } catch {
    return MISSING; // 存在しない = unresolved
  }
  if (!isInsideRoot(rootReal, real)) return OUTSIDE;
  try {
    if (!statSync(real).isFile()) return MISSING;
  } catch {
    return MISSING;
  }
  return { kind: "real", real };
}

function readTextFile(abs: string): string | null {
  try {
    return readFileSync(abs, "utf8");
  } catch {
    return null;
  }
}

/* ---------- 走査 ---------- */

/** 走査中に持ち回る状態。キーはすべて realpath(別名の二重計上を防ぐ) */
interface Walk {
  readonly ruleId: string;
  readonly rootReal: string;
  readonly maxDepth: number;
  /** realpath -> 文字数 */
  readonly sizes: Map<string, number>;
  /** realpath -> 表示名(最初に到達した字句パス) */
  readonly names: Map<string, string>;
  /** realpath -> 測定したときの最小深さ */
  readonly depths: Map<string, number>;
  readonly notes: Finding[];
  /** 既に報告した unresolved の参照文字列 */
  readonly reported: Set<string>;
  /** 深さ上限で打ち切った参照。別の浅い経路で測れた場合は報告しない */
  readonly overDepth: { key: string; finding: Finding }[];
}

function info(ruleId: string, message: string, file: string, line?: number): Finding {
  return { ruleId, severity: "info", file, ...(line === undefined ? {} : { line }), message };
}

function note(w: Walk, message: string, file: string, line: number): void {
  w.notes.push(info(w.ruleId, message, file, line));
}

/** 同じ参照は初出だけ報告し、パス形状でないものは報告しない */
function noteUnresolved(w: Walk, ref: string, where: string, file: string, line: number): void {
  if (!isPathShaped(ref) || w.reported.has(ref)) return;
  w.reported.add(ref);
  note(w, `unresolved import: ${ref} ${where}`, file, line);
}

function walk(
  w: Walk,
  fromRel: string,
  body: string,
  depth: number,
  stack: readonly string[],
): void {
  for (const { ref, line } of extractImportRefs(body)) {
    visitRef(w, fromRel, ref, line, depth, stack);
  }
}

function visitRef(
  w: Walk,
  fromRel: string,
  ref: string,
  line: number,
  depth: number,
  stack: readonly string[],
): void {
  const where = `(from ${fromRel}:${line})`;
  const outside = (): void =>
    note(w, `import outside root, not measured: ${ref} ${where}`, fromRel, line);

  const target = resolveImportRef(ref, fromRel);
  if (target === null) return outside();
  const found = resolveInsideRoot(w.rootReal, target);
  if (found.kind === "outside") return outside();
  if (found.kind === "missing") return noteUnresolved(w, ref, where, fromRel, line);

  const key = found.real;
  if (stack.includes(key)) return note(w, `import cycle detected: ${ref} ${where}`, fromRel, line);
  const childDepth = depth + 1;
  // 同じかより浅い深さで探索済みなら打ち切る。深い経路で先に到達していた場合は子を
  // 取りこぼしているため降り直す(深さ優先の探索順に結果が依存しないようにする)
  const seen = w.depths.get(key);
  if (seen !== undefined && seen <= childDepth) return;
  if (childDepth > w.maxDepth) {
    const message = `import depth limit exceeded (max_depth: ${w.maxDepth}): ${ref} ${where}`;
    w.overDepth.push({ key, finding: info(w.ruleId, message, fromRel, line) });
    return;
  }
  const text = readTextFile(key);
  if (text === null) return noteUnresolved(w, ref, where, fromRel, line);
  if (!w.sizes.has(key)) {
    w.sizes.set(key, text.length); // 合計への加算は初回のみ
    w.names.set(key, target);
  }
  w.depths.set(key, childDepth);
  walk(w, target, text, childDepth, [...stack, key]);
}

/* ---------- check 本体 ---------- */

type ImportBudgetRule = Extract<Rule, { check: "import-budget" }>;

export async function checkImportBudget(
  rule: ImportBudgetRule,
  root: string,
  scope: GlobScope,
): Promise<Finding[]> {
  // 起点の列挙だけが ignore / .gitignore に追従する。インポート先は明示参照なので常に読む
  const entries = await globFiles(scope, [rule.with.path]);
  if (entries.length === 0) {
    return [
      {
        ruleId: rule.id,
        severity: "info",
        message: `no files matched '${rule.with.path}' (import-budget skipped)`,
      },
    ];
  }
  const rootReal = realRoot(root);
  return entries.flatMap((entry) => measureEntry(rule, rootReal, entry));
}

function measureEntry(rule: ImportBudgetRule, rootReal: string, entry: string): Finding[] {
  const found = resolveInsideRoot(rootReal, entry);
  if (found.kind !== "real") {
    const message =
      found.kind === "outside"
        ? `entry file resolves outside root, not measured: ${entry}`
        : `unreadable file: ${entry}`;
    return [info(rule.id, message, entry)];
  }
  const text = readTextFile(found.real);
  if (text === null) return [info(rule.id, `unreadable file: ${entry}`, entry)];

  const w: Walk = {
    ruleId: rule.id,
    rootReal,
    maxDepth: rule.with.max_depth ?? DEFAULT_IMPORT_MAX_DEPTH,
    sizes: new Map([[found.real, text.length]]),
    names: new Map([[found.real, entry]]),
    depths: new Map([[found.real, 0]]),
    notes: [],
    reported: new Set(),
    overDepth: [],
  };
  walk(w, entry, text, 0, [found.real]);
  // 後から浅い経路で測れたものは「深すぎる」ではないので落とす
  w.notes.push(...w.overDepth.filter((d) => !w.sizes.has(d.key)).map((d) => d.finding));
  return buildFindings(rule, entry, w);
}

function buildFindings(rule: ImportBudgetRule, entry: string, w: Walk): Finding[] {
  const total = [...w.sizes.values()].reduce((a, b) => a + b, 0);
  const summary =
    `resident context: ${w.sizes.size} files, ${total} chars ` +
    `(≈${Math.ceil(total / CHARS_PER_TOKEN)} tokens, rough estimate)\n` +
    formatBreakdown(w);
  const findings: Finding[] = [info(rule.id, summary, entry), ...w.notes];
  const max = rule.with.max_chars;
  if (max !== undefined && total > max) {
    findings.push({
      ruleId: rule.id,
      severity: rule.severity,
      file: entry,
      message: `resident context ${total} chars exceeds max_chars ${max} (${w.sizes.size} files)`,
    });
  }
  return findings;
}

/** ファイル別内訳(大きい順)。BREAKDOWN_LIMIT を超える分は件数と合計だけ示す */
function formatBreakdown(w: Walk): string {
  const rows = [...w.sizes]
    .map(([key, chars]) => ({ name: w.names.get(key) ?? key, chars }))
    .sort((a, b) => b.chars - a.chars || a.name.localeCompare(b.name));
  const lines = rows.slice(0, BREAKDOWN_LIMIT).map((r) => `  - ${r.name}: ${r.chars} chars`);
  const rest = rows.slice(BREAKDOWN_LIMIT);
  if (rest.length > 0) {
    const restChars = rest.reduce((a, r) => a + r.chars, 0);
    lines.push(`  ... and ${rest.length} others (${restChars} chars)`);
  }
  return lines.join("\n");
}

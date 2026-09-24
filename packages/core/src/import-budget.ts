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
 * 公式仕様に書かれておらず本実装で補った点(いずれも保守的側に倒している):
 *  - パス終端の定義: 空白・引用符・山括弧・`|`・`*`・各種括弧・`,`・`;`、および日本語
 *    ドキュメントで頻出する全角括弧・読点・句点で終端し、末尾の句読点(`.,;:!?`)は落とす
 *    (例: 表セルの `@vitest/coverage-v8(80%ゲート)` を丸ごとパスとして拾わない)
 *  - `@` の直前は「メールアドレスのローカル部でないこと」で判定する(後読み)。日本語では
 *    `詳細は@docs/X.md` のように `@` の前に空白が無いのが普通で、空白必須にすると過小計上で
 *    check が実質無効になるため。`user@example.com` は従来どおり除外される
 *  - 解決できない参照のうち「パス形状でない」もの(`/` も `.` も含まない、または末尾が
 *    非 ASCII = 日本語の助詞等が続いている)は unresolved の info を出さない。終端文字集合を
 *    完璧にする代わりの措置で、`@docs/日本語.md`(末尾は ASCII の `.md`)は壊さない
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

/** フェンス行(``` / ~~~)。info string は m[2] */
const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;

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
 * フェンスドコードブロックとコードスパンは公式仕様どおり読み飛ばす。
 */
export function extractImportRefs(text: string): ImportRef[] {
  const refs: ImportRef[] = [];
  let fence: string | null = null;
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = FENCE.exec(line);
    if (fence !== null) {
      if (m !== null && isClosingFence(m[1], m[2], fence)) fence = null;
      continue;
    }
    if (m !== null) {
      fence = m[1];
      continue;
    }
    for (const ref of refsInLine(maskCodeSpans(line))) refs.push({ ref, line: i + 1 });
  }
  return refs;
}

/** 閉じフェンスは同じ文字・同じ長さ以上・info string 無し */
function isClosingFence(marker: string, rest: string, open: string): boolean {
  return marker[0] === open[0] && marker.length >= open.length && rest.trim() === "";
}

function refsInLine(line: string): string[] {
  const out: string[] = [];
  IMPORT.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = IMPORT.exec(line)) !== null) {
    const ref = m[1].replace(TRAILING_PUNCT, "");
    if (ref.length > 0) out.push(ref);
    IMPORT.lastIndex = m.index + m[0].length;
  }
  return out;
}

/**
 * コードスパン(`...` / ``...``)を同じ長さの空白へ置き換える。
 * 位置と行長を保つため、インポート抽出の前処理としてそのまま使える。
 * 閉じが見つからないバッククォートはコードスパンではないので原文のまま残す。
 */
export function maskCodeSpans(line: string): string {
  let out = "";
  let i = 0;
  while (i < line.length) {
    if (line[i] !== "`") {
      out += line[i];
      i++;
      continue;
    }
    const n = runLength(line, i);
    const close = findClosingRun(line, i + n, n);
    if (close < 0) {
      out += line.slice(i, i + n);
      i += n;
      continue;
    }
    out += " ".repeat(close + n - i);
    i = close + n;
  }
  return out;
}

/** 位置 start から続くバッククォートの数 */
function runLength(line: string, start: number): number {
  let n = 0;
  while (start + n < line.length && line[start + n] === "`") n++;
  return n;
}

/** ちょうど n 個のバッククォート連続の開始位置(無ければ -1) */
function findClosingRun(line: string, from: number, n: number): number {
  let j = from;
  while (j < line.length) {
    if (line[j] !== "`") {
      j++;
      continue;
    }
    const k = runLength(line, j);
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

/* ---------- ファイル読み込み(root 封じ込め) ---------- */

/** 読み込み結果。outside は root 外、missing は解決できない参照 */
type Loaded =
  | { readonly kind: "ok"; readonly text: string }
  | { readonly kind: "outside" }
  | { readonly kind: "missing" };

const OUTSIDE: Loaded = { kind: "outside" };
const MISSING: Loaded = { kind: "missing" };

/** realpath 解決済みの root(シンボリックリンク経由の脱出を判定する基準) */
export function realRoot(root: string): string {
  const abs = resolve(root);
  try {
    return realpathSync(abs);
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
 * root 相対パスを読み込む。二重の防御:
 *  1. resolveImportRef が `..` / 絶対パス / `~` / `\` を弾く(文字列レベル)
 *  2. ここで realpath を取り、root の realpath 配下にあることを確認する(リンクレベル)
 * root 配下のシンボリックリンクが外を指していても、2 で outside として弾かれる。
 */
function loadInsideRoot(rootReal: string, rel: string): Loaded {
  let real: string;
  try {
    real = realpathSync(join(rootReal, rel));
  } catch {
    return MISSING; // 存在しない = unresolved
  }
  if (!isInsideRoot(rootReal, real)) return OUTSIDE;
  try {
    if (!statSync(real).isFile()) return MISSING;
    return { kind: "ok", text: readFileSync(real, "utf8") };
  } catch {
    return MISSING;
  }
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
  const loaded = loadInsideRoot(rootReal, entry);
  if (loaded.kind !== "ok") {
    const reason =
      loaded.kind === "outside"
        ? `entry file resolves outside root, not measured: ${entry}`
        : `unreadable file: ${entry}`;
    return [{ ruleId: rule.id, severity: "info", file: entry, message: reason }];
  }
  const text = loaded.text;
  const sizes = new Map<string, number>([[entry, text.length]]);
  /** そのファイルを測ったときの最小深さ。より浅い経路で再到達したら降り直す */
  const depths = new Map<string, number>([[entry, 0]]);
  const notes: Finding[] = [];
  /** 深さ上限で打ち切った参照。別の浅い経路で測れた場合は報告しない */
  const overDepth: { target: string; finding: Finding }[] = [];
  const maxDepth = rule.with.max_depth ?? DEFAULT_IMPORT_MAX_DEPTH;

  const info = (message: string, file: string, line: number): Finding => ({
    ruleId: rule.id,
    severity: "info",
    file,
    line,
    message,
  });
  const note = (message: string, file: string, line: number): void => {
    notes.push(info(message, file, line));
  };

  const visit = (rel: string, body: string, depth: number, stack: readonly string[]): void => {
    for (const { ref, line } of extractImportRefs(body)) {
      const from = `(from ${rel}:${line})`;
      const target = resolveImportRef(ref, rel);
      if (target === null) {
        note(`import outside root, not measured: ${ref} ${from}`, rel, line);
        continue;
      }
      if (stack.includes(target)) {
        note(`import cycle detected: ${ref} ${from}`, rel, line);
        continue;
      }
      const childDepth = depth + 1;
      // 同じかより浅い深さで探索済みなら打ち切る。深い経路で先に到達していた場合は
      // 子を取りこぼしているため降り直す(深さ優先の探索順に依存しないようにする)
      const seen = depths.get(target);
      if (seen !== undefined && seen <= childDepth) continue;
      if (childDepth > maxDepth) {
        overDepth.push({
          target,
          finding: info(
            `import depth limit exceeded (max_depth: ${maxDepth}): ${ref} ${from}`,
            rel,
            line,
          ),
        });
        continue;
      }
      const content = loadInsideRoot(rootReal, target);
      if (content.kind === "outside") {
        // 文字列レベルでは root 内だが、シンボリックリンクが外を指しているケース
        note(`import outside root, not measured: ${ref} ${from}`, rel, line);
        continue;
      }
      if (content.kind === "missing") {
        // パス形状でない参照(助詞が続いた等)はノイズになるため報告しない
        if (isPathShaped(ref)) note(`unresolved import: ${ref} ${from}`, rel, line);
        continue;
      }
      if (!sizes.has(target)) sizes.set(target, content.text.length); // 合計は1回だけ
      depths.set(target, childDepth);
      visit(target, content.text, childDepth, [...stack, target]);
    }
  };
  visit(entry, text, 0, [entry]);
  // 後から浅い経路で測れたものは「深すぎる」ではないので落とす
  notes.push(...overDepth.filter((d) => !sizes.has(d.target)).map((d) => d.finding));

  const total = [...sizes.values()].reduce((a, b) => a + b, 0);
  const findings: Finding[] = [
    {
      ruleId: rule.id,
      severity: "info",
      file: entry,
      message:
        `resident context: ${sizes.size} files, ${total} chars ` +
        `(≈${Math.ceil(total / CHARS_PER_TOKEN)} tokens, rough estimate)\n` +
        formatBreakdown(sizes),
    },
    ...notes,
  ];
  const max = rule.with.max_chars;
  if (max !== undefined && total > max) {
    findings.push({
      ruleId: rule.id,
      severity: rule.severity,
      file: entry,
      message: `resident context ${total} chars exceeds max_chars ${max} (${sizes.size} files)`,
    });
  }
  return findings;
}

/** ファイル別内訳(大きい順)。BREAKDOWN_LIMIT を超える分は件数と合計だけ示す */
function formatBreakdown(sizes: ReadonlyMap<string, number>): string {
  const rows = [...sizes].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const lines = rows.slice(0, BREAKDOWN_LIMIT).map(([f, c]) => `  - ${f}: ${c} chars`);
  const rest = rows.slice(BREAKDOWN_LIMIT);
  if (rest.length > 0) {
    const restChars = rest.reduce((a, [, c]) => a + c, 0);
    lines.push(`  ... and ${rest.length} others (${restChars} chars)`);
  }
  return lines.join("\n");
}

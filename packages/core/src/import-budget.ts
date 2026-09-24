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
 *  - パス終端の定義: 空白・引用符・山括弧・`|`・各種括弧・`,`・`;`、および日本語ドキュメントで
 *    頻出する全角括弧・読点・句点で終端し、末尾の句読点(`.,;:!?`)は落とす
 *    (例: 表セルの `@vitest/coverage-v8(80%ゲート)` を丸ごとパスとして拾わない)
 *  - `@` の直前は行頭・空白・`|`(表セル)のみ有効とする。`user@example.com` のような
 *    メールアドレスを誤ってインポートと解釈しないため
 *  - セキュリティ: root(走査ルート)の外に解決される参照は **読みに行かない**。
 *    `..` での脱出・絶対パス・`~/` は info で「outside root, not measured」と報告する
 */
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
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
 * 行頭・空白・表セル区切り(`|`)の直後に現れる `@<path>`。
 * 括弧・引用符・区切り記号で終端する。全角括弧・読点・句点も終端に含めるのは、日本語
 * ドキュメントの「@pkg(補足)」を丸ごとパスとして拾わないため(全角スペースは `\s` が拾う)。
 */
const IMPORT = /(?:^|[\s|])@([^\s`"'<>|(){}[\],;、。「」『』（）]+)/g;

/** 末尾の句読点はパスの一部とみなさない */
const TRAILING_PUNCT = /[.,;:!?]+$/;

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
    // 直前の1文字を消費しているため、隣接する参照を取りこぼさないよう1つ戻す
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
 */
export function resolveImportRef(ref: string, fromRel: string): string | null {
  if (ref.startsWith("~") || ABSOLUTE.test(ref)) return null;
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

/** 通常ファイルとして読めれば本文、読めなければ null(= unresolved) */
function readTextFile(abs: string): string | null {
  try {
    if (!statSync(abs).isFile()) return null;
    return readFileSync(abs, "utf8");
  } catch {
    return null;
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
  return entries.flatMap((entry) => measureEntry(rule, root, entry));
}

function measureEntry(rule: ImportBudgetRule, root: string, entry: string): Finding[] {
  const text = readTextFile(join(root, entry));
  if (text === null) {
    return [
      { ruleId: rule.id, severity: "info", file: entry, message: `unreadable file: ${entry}` },
    ];
  }
  const sizes = new Map<string, number>([[entry, text.length]]);
  const notes: Finding[] = [];
  const maxDepth = rule.with.max_depth ?? DEFAULT_IMPORT_MAX_DEPTH;

  const note = (message: string, file: string, line: number): void => {
    notes.push({ ruleId: rule.id, severity: "info", file, line, message });
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
      if (sizes.has(target)) continue; // 同一ファイルは1回だけ数える
      if (depth + 1 > maxDepth) {
        note(`import depth limit exceeded (max_depth: ${maxDepth}): ${ref} ${from}`, rel, line);
        continue;
      }
      const content = readTextFile(join(root, target));
      if (content === null) {
        note(`unresolved import: ${ref} ${from}`, rel, line);
        continue;
      }
      sizes.set(target, content.length);
      visit(target, content, depth + 1, [...stack, target]);
    }
  };
  visit(entry, text, 0, [entry]);

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

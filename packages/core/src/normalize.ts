/**
 * マスター正規化 — 配布テンプレート(standards/)を「PJ に具体化された状態」へ寄せる。
 *
 * 3-way マージの base / theirs は、同じ vars で同じ手順で正規化した旧・新マスターである
 * 必要がある。手順がずれると全行が差分になるため、順序をここに固定する:
 *
 *   ① CRLF → LF           EOL 差は差分ではない
 *   ② gen コメント除去     生成指示。完成版には残らない
 *   ③ 未初期化警告ブロック除去
 *   ④ スタンプ行を対象タグへ書換
 *   ⑤ プレースホルダ描画   vars に無いキーはリテラルのまま残す(sync 全体を止めない)
 *
 * ②が③④⑤より先なのは、gen コメント内の説明文に `{{PLACEHOLDER}}` 等が含まれ、
 * 先に描画すると説明文まで置換されてしまうため。
 */
import { normalizeEol } from "./checks.js";

/** `{{KEY}}` トークン。キーは `ORG/REPO` や `単一システム | モノレポ` のような任意文字列 */
export const PLACEHOLDER_RE = /\{\{([^{}\r\n]+)\}\}/g;

/**
 * CLAUDE.md 末尾の standards バージョンスタンプ。
 * タグは vars の `standards` と同じく `vX.Y.Z` 固定(TAG_RE と同じ形)。緩めると
 * `v..` のような値がタグとして読み出され、マスターのパス組み立てに混入する。
 */
export const STAMP_RE = /<!-- standards: novexar\/[\w-]+ v\d+\.\d+\.\d+ -->/;
/** スタンプのタグ部分をキャプチャする版 */
export const STAMP_CAPTURE_RE = /<!-- standards: novexar\/[\w-]+ (v\d+\.\d+\.\d+) -->/;

/** スタンプに書く owner/repo。`guard new` が PJ へ書くものと一致させる */
export const STANDARDS_STAMP_REPO = "novexar/guardsmith";

/** 未初期化テンプレートであることを示す引用ブロック(初期化時に削除される) */
const UNINITIALIZED_WARNING_RE = /^> \*\*⚠️ 未初期化テンプレート\*\*\r?\n(?:>.*\r?\n)*(?:\r?\n)?/m;

export interface NormalizeOptions {
  vars: Readonly<Record<string, string>>;
  /** スタンプ行を書き換える先。例 "novexar/guardsmith v0.6.0" */
  stamp?: string;
}

export interface NormalizeResult {
  text: string;
  /** vars に無く描画できなかったキー(重複排除・出現順) */
  unresolved: string[];
}

/** 正規化パイプライン一式 */
export function normalizeMaster(text: string, opts: NormalizeOptions): NormalizeResult {
  let out = normalizeEol(text);
  out = stripGenComments(out);
  out = stripUninitializedWarning(out);
  if (opts.stamp !== undefined) out = rewriteStamp(out, opts.stamp);
  return renderPlaceholders(out, opts.vars);
}

/** `${STANDARDS_STAMP_REPO} ${tag}` 形式のスタンプ本文を組み立てる */
export function stampFor(tag: string): string {
  return `${STANDARDS_STAMP_REPO} ${tag}`;
}

/**
 * `gen:` を含む HTML コメントだけを削除する。
 *
 * 正規表現一発ではなくスパン走査で実装する理由: standards には複数行バナー・行内・
 * 2 行にまたがる形態が混在し、単一行想定の正規表現では取りこぼす。逆に `[\s\S]*?` の
 * 貪欲でない一発置換は「gen: を含まないコメント」までまとめて巻き込みうる。
 * `gen:` を含まないコメント(ISSUE_TEMPLATE の説明・DESIGN.md の出典)は保持する。
 */
export function stripGenComments(text: string): string {
  const parts: string[] = [];
  /** 未出力のテキストの開始位置 */
  let kept = 0;
  /** 次にコメントを探し始める位置(保持したコメントは読み飛ばすだけ) */
  let scan = 0;
  for (;;) {
    const open = text.indexOf("<!--", scan);
    if (open < 0) break;
    if (inCodeSpan(text, open)) {
      // 「書式は `<!-- gen: ... -->` のように書く」の引用を開始位置に採ると、
      // そこから次の `-->` までの **本文** を削除してしまう(standards/README.md に同型)
      scan = open + 4;
      continue;
    }
    const close = findCommentClose(text, open + 4);
    if (close < 0) break; // 閉じていないコメントは本文として扱う
    const end = close + 3;
    if (!/\bgen:/.test(text.slice(open + 4, close))) {
      scan = end;
      continue;
    }
    parts.push(text.slice(kept, open));
    // 削除した行が空行として残らないよう、直後の改行 1 個も落とす
    kept = text[end] === "\n" ? end + 1 : end;
    scan = kept;
  }
  parts.push(text.slice(kept));
  return collapseBlankRuns(parts.join(""));
}

/**
 * コメントの終端 `-->` を探す。
 *
 * 素朴に最短の `-->` を採ると standards/CLAUDE.md の生成規約バナーを切り損ねる。
 * あのバナーは gen コメントの書式そのものを `` `<!-- gen: ... -->` `` と例示しており、
 * 引用された `-->` を終端と誤認すると **バナーの後半が本文へ漏れ出す**。
 * そこでインラインコードスパン内の `-->` は終端とみなさない。
 */
function findCommentClose(text: string, from: number): number {
  let at = text.indexOf("-->", from);
  while (at >= 0) {
    if (!inCodeSpan(text, at)) return at;
    at = text.indexOf("-->", at + 3);
  }
  return -1;
}

/** 同じ行の先行バックティックが奇数個なら、その位置はインラインコードスパンの中 */
function inCodeSpan(text: string, index: number): boolean {
  const lineStart = text.lastIndexOf("\n", index) + 1;
  let ticks = 0;
  for (let i = lineStart; i < index; i++) if (text[i] === "`") ticks++;
  return ticks % 2 === 1;
}

/** 空行が 3 連続以上になったら 2 連続へ畳む(gen コメント除去の後始末) */
function collapseBlankRuns(text: string): string {
  return text.replace(/\n{4,}/g, "\n\n\n");
}

/** `> **⚠️ 未初期化テンプレート**` で始まる引用ブロックを削除する */
export function stripUninitializedWarning(text: string): string {
  return text.replace(UNINITIALIZED_WARNING_RE, "");
}

/**
 * スタンプ行を指定の owner/repo + タグへ書き換える。スタンプが無ければ無変更。
 * 置換は関数で行う(文字列を渡すと `$&` などが置換パターンとして解釈される)。
 */
export function rewriteStamp(text: string, stamp: string): string {
  return text.replace(STAMP_RE, () => `<!-- standards: ${stamp} -->`);
}

/** `{{KEY}}` を vars で描画する。未登録キーはリテラルのまま残し unresolved に積む */
export function renderPlaceholders(
  text: string,
  vars: Readonly<Record<string, string>>,
): NormalizeResult {
  const unresolved: string[] = [];
  const rendered = text.replace(PLACEHOLDER_RE, (token, raw: string) => {
    const key = raw.trim();
    // `{{ }}`(空キー)は vars のキーになれない(YAML に書いても読み戻せない)。
    // プレースホルダとして扱わず、リテラルのまま残す
    if (key === "") return token as string;
    const value = Object.hasOwn(vars, key) ? vars[key] : undefined;
    if (value === undefined) {
      if (!unresolved.includes(key)) unresolved.push(key);
      return token as string;
    }
    return value;
  });
  return { text: rendered, unresolved };
}

/** テキストに含まれるプレースホルダキー(重複排除・出現順) */
export function extractPlaceholderKeys(text: string): string[] {
  const keys: string[] = [];
  for (const m of text.matchAll(PLACEHOLDER_RE)) {
    const key = m[1].trim();
    if (key !== "" && !keys.includes(key)) keys.push(key);
  }
  return keys;
}

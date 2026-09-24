/**
 * 3-way マージ — node-diff3 の唯一のラッパー。
 *
 * node-diff3 は文字列を渡すと `stringSeparator` の既定 `/\s+/` で **単語単位** に
 * マージする。行の途中で他方の変更が差し込まれた壊れたファイルが静かに書き出されるため、
 * ここでは必ず `string[]`(行配列)で呼ぶ。この制約をモジュール内に封じ込めるため、
 * `node-diff3` の直接 import は ESLint の no-restricted-imports で本ファイル以外禁止。
 *
 * また node-diff3 は EOL を一切正規化しない。ours の EOL を検出し、LF で計算して
 * 元の EOL で join し直す(マーカー行だけ LF になるのを防ぐ)。
 */
import { diff3Merge, diffIndices, mergeDiff3, type MergeRegion } from "node-diff3";

export type Eol = "\n" | "\r\n";

export interface ConflictRegion {
  /** ours 側の 0 起点開始行 */
  startLine: number;
  ours: string[];
  base: string[];
  theirs: string[];
}

export interface Merge3Labels {
  ours: string;
  base: string;
  theirs: string;
}

export interface Merge3Options {
  /** 衝突箇所をマーカー付きで出力するか(既定 false = merged を返さない) */
  markers?: boolean;
  labels?: Readonly<Merge3Labels>;
}

export interface Merge3Result {
  /** markers:false かつ衝突ありのときは undefined(呼び出し側が無変更を選べる) */
  merged?: string;
  conflicts: ConflictRegion[];
  /** 入力 ours から検出した EOL。出力の join に使う */
  eol: Eol;
  /** merged が ours と異なるか(merged が無いときは false) */
  changed: boolean;
}

/** ours / base / theirs の 3-way マージ。行単位で計算する */
export function merge3(
  ours: string,
  base: string,
  theirs: string,
  opts: Readonly<Merge3Options> = {},
): Merge3Result {
  const eol = detectEol(ours);
  /**
   * 末尾改行の有無は「最後の行の中身」ではなく文書全体の属性。3 者で食い違うと、
   * 行配列の最後の空要素の差として現れ、本文とは無関係な衝突になる。
   * 食い違うときだけ 3 者から末尾改行を外して比較し、出力は標準側(theirs)に揃える。
   * 3 者が一致している通常のケースでは何もしない(既存の往復保存をそのまま保つ)。
   */
  const trailingNl = {
    ours: endsWithNewline(ours),
    base: endsWithNewline(base),
    theirs: endsWithNewline(theirs),
  };
  const asymmetric = trailingNl.ours !== trailingNl.base || trailingNl.base !== trailingNl.theirs;
  // 揃え方は「末尾改行あり」側に寄せる。末尾の空要素は EOF のアンカーとして働くので、
  // 落とす向きに揃えると「PJ が末尾へ追記」と「標準が最終行を変更」が隣接して衝突する
  const split = (text: string): string[] => (asymmetric ? padTrailingBlank(text) : toLines(text));
  const oursLines = split(ours);
  const baseLines = split(base);
  const theirsLines = split(theirs);

  const regions = diff3Merge<string>(oursLines, baseLines, theirsLines, {
    excludeFalseConflicts: true,
  });
  const conflicts = collectConflicts(regions);

  if (conflicts.length > 0 && opts.markers !== true) {
    return { conflicts, eol, changed: false };
  }

  const lines =
    conflicts.length === 0
      ? regions.flatMap((r) => r.ok ?? [])
      : mergeDiff3<string>(oursLines, baseLines, theirsLines, {
          excludeFalseConflicts: true,
          label: toDiff3Label(opts.labels),
        }).result.map(String);

  // 揃えた分を戻す: 末尾改行の有無は標準側(theirs)に従う
  if (asymmetric && !trailingNl.theirs && lines.at(-1) === "") lines.pop();
  const merged = lines.join(eol);
  return { merged, conflicts, eol, changed: merged !== ours };
}

/** `MergeRegion` は判別可能 union ではないため ok / conflict の順で絞る */
function collectConflicts(regions: readonly MergeRegion<string>[]): ConflictRegion[] {
  const conflicts: ConflictRegion[] = [];
  for (const r of regions) {
    if (r.ok) continue;
    if (!r.conflict) continue;
    conflicts.push({
      startLine: r.conflict.aIndex,
      ours: [...r.conflict.a],
      base: [...r.conflict.o],
      theirs: [...r.conflict.b],
    });
  }
  return conflicts;
}

function toDiff3Label(labels: Readonly<Merge3Labels> | undefined) {
  return labels === undefined ? {} : { a: labels.ours, o: labels.base, b: labels.theirs };
}

/**
 * ours に CRLF が 1 つでもあれば CRLF ファイルとみなす。
 * EOL 混在ファイルは出力が CRLF へ揃うため、変更行以外も差分になる点に注意
 * (混在はそもそも事故であり、揃える方が望ましいと判断している)。
 */
export function detectEol(text: string): Eol {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

/**
 * LF 正規化して行配列にする。末尾改行は最後の空要素として表現されるため、
 * `join(eol)` で往復すると末尾改行の有無がそのまま保存される。
 */
export function toLines(text: string): string[] {
  return text.replaceAll("\r\n", "\n").split("\n");
}

/** LF 正規化後に末尾改行で終わるか(空文字列は「終わらない」) */
export function endsWithNewline(text: string): boolean {
  return text.endsWith("\n");
}

/**
 * 末尾改行があるものとして揃えた行配列(末尾の空要素を必ず 1 つ持つ)。
 * 末尾改行の有無を行の内容として diff させないための前処理。
 */
function padTrailingBlank(text: string): string[] {
  const lines = toLines(text);
  if (!endsWithNewline(text)) lines.push("");
  return lines;
}

/** 2 バッファ間の不一致チャンク(一致部分は LCS で対応付け済み) */
export interface DiffChunk {
  left: string[];
  right: string[];
}

/**
 * 不一致チャンクだけを取り出す(`--init-vars` の行対応付け用)。
 * node-diff3 の呼び出しを本ファイルへ封じ込める制約は 3-way と同じ理由で共通。
 */
export function diffChunks(left: readonly string[], right: readonly string[]): DiffChunk[] {
  return diffIndices<string>([...left], [...right]).map((r) => ({
    left: [...r.buffer1Content],
    right: [...r.buffer2Content],
  }));
}

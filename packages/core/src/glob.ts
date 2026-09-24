/**
 * glob ヘルパー — lint / sync の全ファイル走査をここに集約する。
 *
 * 採用方式: fast-glob の `ignore` で走査を枝刈りし、結果を ignore パッケージ(kaelzhang)で
 *           最終フィルタする(= .gitignore と同じ意味論で判定する)。
 *
 * 検討して不採用にした案: globby の `gitignore: true`
 *   globby は内部で fast-glob を走らせた「結果」を ignore パッケージでフィルタする実装で、
 *   走査そのものは枝刈りされない。5,000 ファイルの疑似 .venv を含む fixture の実測では
 *   ignore 無し 8.6ms に対し globby 30.5ms(全階層の .gitignore 探索が加わるため逆に遅い)、
 *   本方式 0.7ms。本対応の主目的が「巨大な無関係ディレクトリを走査しないこと」のため不採用。
 *
 * 正確性の優先順位:
 *   1. git が追跡するファイルを誤って除外しない → 判定の正は ignore パッケージによる最終フィルタ
 *   2. 走査の枝刈り(速度)                       → 安全に変換できる行だけを fast-glob へ渡す
 *
 * 枝刈りと否定(`!`)の関係:
 *   深い階層の .gitignore の否定は、浅い階層の除外行を打ち消しうる。打ち消される可能性がある
 *   行から枝刈りパターンを作ると、git が追跡するファイルを走査前に落としてしまう(最終フィルタ
 *   では救えない)。そこで、除外行 L(ファイル F)について **F 自身と F 配下の .gitignore の
 *   否定行 N** を集め、N が「L がマッチするパスそのものを再包含しうる」なら L から枝刈り
 *   パターンを一切作らない。判定は最終セグメント(パスの最後の要素)の互換性で行う:
 *     - 双方リテラル      → 完全一致で衝突
 *     - 片方だけ glob     → micromatch.isMatch(リテラル, glob) で衝突判定
 *     - 双方 glob         → 保守的に衝突とみなす
 *   F より上位(ancestor)の否定は、より深い F の除外行が勝つため無視してよい。
 *   例:
 *     - ルート `build` + `sub/.gitignore` の `!build` → 衝突。git は sub/build を追跡するので
 *       枝刈りしてはいけない
 *     - ルート `out/` + `deep/.gitignore` の `!out/keep` → 非衝突(`out` ≠ `keep`)。git は
 *       『除外されたディレクトリ配下は再包含できない』ため deep/out/keep を追跡しない
 *     - ルート `node_modules/` + `standards/.gitignore` の `!.env.example` → 非衝突。
 *       本リポジトリの枝刈りは維持される
 *
 * その他の制約(いずれも「枝刈りしない」に倒れるだけで、除外判定の正確性は最終フィルタが担保する):
 *   - `{} () \` を含む行は gitignore と fast-glob(micromatch)で意味が異なりうるため使わない。
 *   - ネストした .gitignore の探索自体もルート .gitignore 由来の枝刈りパターンで行う。
 *     git も除外済みディレクトリには降りず、その配下の .gitignore を読まないため挙動は一致する。
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import fg from "fast-glob";
import ignoreFactory from "ignore";
import micromatch from "micromatch";

/** git が追跡しないため常に除外するパス */
export const ALWAYS_IGNORED: readonly string[] = ["**/.git/**"];

export interface GlobOptions {
  /** policy の ignore(glob)。fast-glob の ignore にそのまま渡す */
  ignore?: readonly string[];
  /** ローカルの .gitignore を尊重するか(既定 true) */
  gitignore?: boolean;
}

export interface GlobScope {
  /** 走査の基点(絶対パス) */
  readonly root: string;
  /** fast-glob へ渡す ignore(枝刈り用) */
  readonly fgIgnore: readonly string[];
  /** 結果の最終フィルタ(true = 除外)。root 相対の posix パスを受け取る */
  readonly isIgnored: (relPath: string) => boolean;
}

/** .gitignore 1ファイル分。base は root 相対の posix ディレクトリ(ルートは "") */
interface GitignoreFile {
  readonly base: string;
  readonly lines: readonly string[];
}

/**
 * 走査スコープを作る。1回の lint / sync につき1度だけ作り、全ルールで使い回すこと
 * (.gitignore の探索・読込を1回に抑えるため)。
 */
export async function createGlobScope(root: string, options: GlobOptions = {}): Promise<GlobScope> {
  const base = [...ALWAYS_IGNORED, ...(options.ignore ?? [])];
  if (options.gitignore === false) {
    return { root, fgIgnore: base, isIgnored: () => false };
  }

  const files = await collectGitignoreFiles(root, base);
  if (files.length === 0) {
    return { root, fgIgnore: base, isIgnored: () => false };
  }

  const matcher = ignoreFactory().add(
    files.flatMap((f) => f.lines.map((line) => rebaseLine(line, f.base))),
  );
  return {
    root,
    fgIgnore: [...base, ...derivePrunePatterns(files)],
    isIgnored: (relPath) => relPath.length > 0 && matcher.ignores(relPath),
  };
}

/** スコープに従ってファイルを列挙する(root 相対の posix パス) */
export async function globFiles(
  scope: GlobScope,
  patterns: readonly string[],
  options: { onlyFiles?: boolean } = {},
): Promise<string[]> {
  const hits = await fg([...patterns], {
    cwd: scope.root,
    dot: true,
    ignore: [...scope.fgIgnore],
    ...(options.onlyFiles === undefined ? {} : { onlyFiles: options.onlyFiles }),
  });
  return hits.filter((p) => !scope.isIgnored(p));
}

/* ---------- .gitignore の収集 ---------- */

async function collectGitignoreFiles(
  root: string,
  baseIgnore: readonly string[],
): Promise<GitignoreFile[]> {
  const files: GitignoreFile[] = [];
  const rootLines = readGitignore(join(root, ".gitignore"));
  if (rootLines.length > 0) files.push({ base: "", lines: rootLines });

  // ネストした .gitignore の探索も、ルート .gitignore 由来のパターンで枝刈りする
  const found = await fg("**/.gitignore", {
    cwd: root,
    dot: true,
    onlyFiles: true,
    ignore: [...baseIgnore, ...derivePrunePatterns(files)],
  });
  for (const rel of found) {
    const idx = rel.lastIndexOf("/");
    if (idx < 0) continue; // ルートの .gitignore は読み込み済み
    const lines = readGitignore(join(root, rel));
    if (lines.length > 0) files.push({ base: rel.slice(0, idx), lines });
  }
  return files;
}

/** .gitignore を行配列にする(空行・コメント・末尾空白を除去)。存在しなければ空配列 */
function readGitignore(path: string): string[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+$/, ""))
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

/* ---------- 意味論変換 ---------- */

/** ネストした .gitignore の行を root 基準の gitignore パターンへ書き換える */
function rebaseLine(line: string, base: string): string {
  if (base === "") return line;
  const negated = line.startsWith("!");
  const body = negated ? line.slice(1) : line;
  const anchored = isAnchored(body);
  const core = body.startsWith("/") ? body.slice(1) : body;
  // 非アンカーの行は「その .gitignore 配下の任意の深さ」を意味する
  const rebased = anchored ? `${base}/${core}` : `${base}/**/${core}`;
  return negated ? `!${rebased}` : rebased;
}

/** 先頭 `/` があるか、末尾以外に `/` を含む行はアンカー扱い(git の規則) */
function isAnchored(body: string): boolean {
  const withoutTrailingSlash = body.endsWith("/") ? body.slice(0, -1) : body;
  return body.startsWith("/") || withoutTrailingSlash.includes("/");
}

/* ---------- 枝刈りパターンの生成 ---------- */

/** gitignore と fast-glob(micromatch)で解釈が食い違いうる文字 */
const UNSAFE_FOR_FASTGLOB = /[{}()\\]/;

/** 1行から得られる枝刈りパターン */
interface PrunePattern {
  /** マッチしたディレクトリの配下。深い否定に覆されないため常に使える */
  readonly contents: string;
  /** マッチした要素そのもの。深い否定に再包含されうるため条件付きで使う */
  readonly entry?: string;
}

/** パターンの最終セグメント(比較用) */
interface Segment {
  readonly text: string;
  /** glob メタ文字を含まないか */
  readonly literal: boolean;
}

/**
 * 枝刈りパターンを作る。
 * 自身および配下の .gitignore の否定行に打ち消されうる行は、枝刈りに使わない。
 */
function derivePrunePatterns(files: readonly GitignoreFile[]): string[] {
  const patterns: string[] = [];
  for (const file of files) {
    const negations = files
      .filter((f) => isSelfOrDescendant(f.base, file.base))
      .flatMap((f) => f.lines.filter((line) => line.startsWith("!")))
      .map((line) => finalSegment(line.slice(1)));

    for (const line of file.lines) {
      if (line.startsWith("!")) continue;
      const p = toFastGlobIgnore(line, file.base);
      if (p === null) continue;
      const target = finalSegment(line);
      if (negations.some((n) => segmentsCollide(target, n))) continue;
      patterns.push(p.contents);
      if (p.entry !== undefined) patterns.push(p.entry);
    }
  }
  return patterns;
}

/** candidate が ancestor 自身、または ancestor の配下か */
function isSelfOrDescendant(candidate: string, ancestor: string): boolean {
  if (ancestor === "") return true;
  return candidate === ancestor || candidate.startsWith(`${ancestor}/`);
}

/** gitignore パターンの最終セグメントを取り出す(先頭 `/`・末尾 `/` は除去) */
function finalSegment(pattern: string): Segment {
  let body = pattern.endsWith("/") ? pattern.slice(0, -1) : pattern;
  if (body.startsWith("/")) body = body.slice(1);
  const idx = body.lastIndexOf("/");
  const seg = idx < 0 ? body : body.slice(idx + 1);
  return { text: unescapeGitignore(seg), literal: isLiteralSegment(seg) };
}

/** エスケープされていない glob メタ文字を含まないか */
function isLiteralSegment(seg: string): boolean {
  for (let i = 0; i < seg.length; i++) {
    const c = seg[i];
    if (c === "\\") {
      i++;
      continue;
    }
    if ("*?[]{}".includes(c)) return false;
  }
  return true;
}

/** gitignore のエスケープ(`\#` 等)を外す */
function unescapeGitignore(seg: string): string {
  return seg.replace(/\\(.)/g, "$1");
}

/** 除外行の最終セグメントと否定行の最終セグメントが同じパスを指しうるか(保守的判定) */
function segmentsCollide(target: Segment, negation: Segment): boolean {
  if (target.literal && negation.literal) return target.text === negation.text;
  if (target.literal) return micromatch.isMatch(target.text, negation.text, { dot: true });
  if (negation.literal) return micromatch.isMatch(negation.text, target.text, { dot: true });
  return true; // 双方 glob は交差判定が難しいため衝突扱い(= 枝刈りしない)
}

/** .gitignore の1行を fast-glob の ignore パターンへ変換する(安全に変換できない行は null) */
function toFastGlobIgnore(line: string, base: string): PrunePattern | null {
  if (line.startsWith("!") || UNSAFE_FOR_FASTGLOB.test(line)) return null;
  const dirOnly = line.endsWith("/");
  const body = dirOnly ? line.slice(0, -1) : line;
  const anchored = isAnchored(line);
  const core = body.startsWith("/") ? body.slice(1) : body;
  if (core.length === 0) return null;

  const prefix = base === "" ? "" : `${base}/`;
  const head = anchored ? `${prefix}${core}` : `${prefix}**/${core}`;
  // micromatch の `**` は0セグメントにもマッチするため `<head>/**` は <head> 自身も巻き込む。
  // 1セグメント以上を要求する `<head>/**/*` で「配下だけ」を表す。
  // ディレクトリ限定の行は同名ファイルを除外してはならないので entry を持たない。
  return dirOnly ? { contents: `${head}/**/*` } : { contents: `${head}/**/*`, entry: head };
}

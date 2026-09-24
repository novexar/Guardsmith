/**
 * PJ ファイルへの「全部 or 無し」の書き込み。
 *
 * `guard sync --write` / `guard bump` は複数ファイルを同時に書き換える。途中で 1 件でも
 * 失敗したときに「N-1 件だけ適用済み・基準タグは旧のまま」という状態を残すと、次回の
 * 3-way が別のベースで走ることになり、静かに壊れる。そこで 2 相で適用する:
 *
 *   ① 全対象を `<file>.guardsmith.tmp` へ書き切る(ここで失敗したら tmp を消して終わり)
 *   ② 全件を rename で確定する(ここで失敗したら確定済みを元へ戻す)
 *
 * 書き込み先は必ず PJ ルート配下に封じ込める。`guard sync` は glob にマッチしたパスへ
 * 書き込み、policy は remote extends から継承されうるため、`..` を含むパターンは
 * リポジトリ外への書き込み経路になる。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { containedJoin } from "./remote.js";

/** 一時ファイルの接尾辞。2 相適用の途中結果であることが名前で分かるようにする */
export const TMP_SUFFIX = ".guardsmith.tmp";

export interface PendingWrite {
  /** PJ ルート相対のパス */
  file: string;
  content: string;
}

/** glob の結果・計画上のパスを PJ ルート配下に封じ込める */
export function projectPath(rootDir: string, file: string): string {
  try {
    return containedJoin(rootDir, file);
  } catch {
    throw new Error(`refusing to touch '${file}': it resolves outside the project root`);
  }
}

interface Staged {
  tmp: string;
  final: string;
  /** 確定前の中身。undefined = 元々存在しなかった(巻き戻しでは削除する) */
  before?: Buffer;
}

/** 全件を書き切ってから確定する。失敗時は 1 件も適用されていない状態へ戻す */
export function writeAtomically(rootDir: string, writes: readonly PendingWrite[]): void {
  const staged = stage(rootDir, writes);
  const done: Staged[] = [];
  try {
    for (const s of staged) {
      renameSync(s.tmp, s.final);
      done.push(s);
    }
  } catch (e) {
    throw new Error(`${(e as Error).message}${rollback(staged, done)}`);
  }
}

/** ① 一時ファイルへ書き切る。失敗したら tmp を掃除して「何も適用していない」状態で投げる */
function stage(rootDir: string, writes: readonly PendingWrite[]): Staged[] {
  const staged: Staged[] = [];
  try {
    for (const w of writes) {
      const final = projectPath(rootDir, w.file);
      mkdirSync(dirname(final), { recursive: true });
      // 巻き戻し用に元の中身を先に控える(バイナリでも壊さないよう Buffer で持つ)
      const before = existsSync(final) ? readFileSync(final) : undefined;
      const tmp = `${final}${TMP_SUFFIX}`;
      writeFileSync(tmp, w.content);
      staged.push({ tmp, final, before });
    }
    return staged;
  } catch (e) {
    discard(staged);
    const n = staged.length;
    throw new Error(
      `${(e as Error).message}\nnothing was applied` +
        (n > 0 ? ` (${n} staged file(s) discarded)` : ""),
    );
  }
}

/** ② の途中で失敗したときの巻き戻し。確定済みを元に戻し、残りの tmp を掃除する */
function rollback(staged: readonly Staged[], done: readonly Staged[]): string {
  const unrecovered: string[] = [];
  for (const s of done) {
    try {
      if (s.before === undefined) rmSync(s.final, { force: true });
      else writeFileSync(s.final, s.before);
    } catch {
      unrecovered.push(s.final);
    }
  }
  discard(staged);
  const rolled = `\nrolled back ${done.length} file(s) — nothing was applied`;
  return unrecovered.length === 0
    ? rolled
    : `\ncould not restore: ${unrecovered.join(", ")} — check them by hand`;
}

function discard(staged: readonly Staged[]): void {
  for (const s of staged) rmSync(s.tmp, { force: true });
}

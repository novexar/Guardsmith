/**
 * github: リモート参照の取得・キャッシュ
 *  - 取得方式: codeload.github.com の tarball(タグ固定)をダウンロード・展開
 *  - private 対応: GITHUB_TOKEN 環境変数(または opts.token)で Authorization ヘッダ付与
 *  - キャッシュ: ~/.guardsmith/cache/<owner>/<repo>/<tag>/ に展開保存。
 *    タグは不変前提で再取得しない。noCache 指定で強制再取得。
 *  - セキュリティ: パストラバーサル(..・絶対パス)とリンク系エントリを拒否
 */
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { extract } from "tar";

export interface GithubRef {
  owner: string;
  repo: string;
  /** リポジトリ内サブパス(省略時はリポジトリルート) */
  path?: string;
  tag: string;
}

export interface RemoteOptions {
  /** キャッシュルート。既定: ~/.guardsmith/cache */
  cacheDir?: string;
  /** true でキャッシュを破棄して再取得 */
  noCache?: boolean;
  /** GitHub トークン。既定: 環境変数 GITHUB_TOKEN */
  token?: string;
  /** テスト用 fetch 差し替え */
  fetchImpl?: typeof fetch;
}

/** owner / repo / tag に許す文字。URL・ファイルパスの両方に使われるため厳格に制限する */
const SAFE_COMPONENT = /^[\w.-]+$/;

/** github:owner/repo[//path]@tag をパースする(extends / drift source 共通) */
export function parseGithubRef(ref: string): GithubRef {
  const m = /^github:([^/@]+)\/([^/@]+?)(?:\/\/([^@]+))?@(.+)$/.exec(ref);
  if (!m) throw new Error(`invalid github ref '${ref}' (expected github:owner/repo[//path]@tag)`);
  const [, owner, repo, path, tag] = m;
  for (const [label, value] of [
    ["owner", owner],
    ["repo", repo],
    ["tag", tag],
  ] as const) {
    if (!SAFE_COMPONENT.test(value) || value === "." || value === "..") {
      throw new Error(`invalid ${label} in github ref '${ref}': ${value}`);
    }
  }
  return { owner, repo, path, tag };
}

export function defaultCacheDir(): string {
  return join(homedir(), ".guardsmith", "cache");
}

/**
 * root 配下に収まることを保証して sub を結合する。
 * `//path` に ../ を仕込んでキャッシュ外を参照する攻撃を防ぐ。
 */
export function containedJoin(root: string, sub: string): string {
  const abs = resolve(root, sub);
  const rel = relative(root, abs);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`path escapes repository root: ${sub}`);
  }
  return abs;
}

/** タグの展開済みキャッシュディレクトリを返す(未取得なら tarball を取得・展開する) */
export async function ensureRepoCached(ref: GithubRef, opts: RemoteOptions = {}): Promise<string> {
  const cacheRoot = opts.cacheDir ?? defaultCacheDir();
  const dest = join(cacheRoot, ref.owner, ref.repo, ref.tag);
  if (existsSync(dest)) {
    if (!opts.noCache) return dest; // タグは不変前提: 再取得しない
    rmSync(dest, { recursive: true, force: true });
  }

  const url = `https://codeload.github.com/${ref.owner}/${ref.repo}/tar.gz/refs/tags/${ref.tag}`;
  const doFetch = opts.fetchImpl ?? fetch;
  const token = opts.token ?? process.env.GITHUB_TOKEN;
  const res = await doFetch(url, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    const hint =
      res.status === 404 ? " (tag not found, or set GITHUB_TOKEN for private repositories)" : "";
    throw new Error(`failed to fetch ${url}: HTTP ${res.status}${hint}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());

  // 一時ディレクトリへ展開し、成功時のみ最終位置へ rename(壊れたキャッシュを残さない)
  const tmp = `${dest}.tmp-${process.pid}`;
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  const tarball = join(tmp, "__repo.tar.gz");
  writeFileSync(tarball, buf);
  // 危険エントリは filter で記録+スキップし、展開後に明示エラーにする
  // (filter 内での throw は tar のストリームパーサ内で未捕捉例外になるため不可)
  const offenders: string[] = [];
  try {
    // strip: 1 で tarball のトップディレクトリ(<repo>-<tag> 等)を除去。
    // strict: true で node-tar 自身のパス検査警告も例外に昇格させる(多層防御)
    await extract({
      file: tarball,
      cwd: tmp,
      strip: 1,
      strict: true,
      filter: (path, entry) => {
        // extract の filter に渡るのは ReadEntry(型定義上は Stats とのユニオンのため絞り込む)
        const entryType = "type" in entry ? String(entry.type) : "File";
        try {
          return assertSafeEntry(path, entryType);
        } catch {
          offenders.push(path);
          return false;
        }
      },
    });
    if (offenders.length > 0) {
      throw new Error(`tar entry escapes extraction dir (path traversal): ${offenders.join(", ")}`);
    }
  } catch (e) {
    rmSync(tmp, { recursive: true, force: true });
    throw e;
  }
  rmSync(tarball, { force: true });
  rmSync(dest, { recursive: true, force: true });
  renameSync(tmp, dest);
  return dest;
}

/**
 * tar エントリの安全性検査。
 *  - `..` 成分・絶対パスはパストラバーサルとして即エラー(黙ってスキップしない)
 *  - リンク系エントリは展開先外への書き込み経路になり得るため除外(標準配布物に不要)
 */
export function assertSafeEntry(path: string, type: string): boolean {
  if (type === "SymbolicLink" || type === "Link") return false;
  if (isAbsolute(path) || path.split(/[\\/]/).includes("..")) {
    throw new Error(`tar entry escapes extraction dir (path traversal): ${path}`);
  }
  return true;
}

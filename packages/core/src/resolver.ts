/**
 * ポリシー読込と extends 解決 (preset: / file: / github: 対応)
 * マージ規則: extends を宣言順に適用 → ローカル rules が同一idを上書き。
 *   - rules: id をキーに後勝ち上書き(Layer3 > Layer2 > Layer1)
 *   - exemptions: 連結(どの層の例外も有効。期限は必須)
 *   - ignore: 連結(宣言順を保ち重複のみ除去。上書きではない)
 * extends は多段解決する(Layer3 → Layer2 → Layer1 の3層運用)。循環はエラー。
 * drift / drift3 の github: source はキャッシュ取得後に file: へ解決してから返す。
 *
 * drift3 は「旧タグのマスター」と「新タグのマスター」の 2 本を必要とする。旧タグは
 * guardsmith.vars.yaml(無ければ CLAUDE.md スタンプ)が持っているため、解決前の
 * source(`github:...@tag`)を loadPolicyWithMeta が残しておき、buildDrift3Sources が
 * タグ 2 本分のキャッシュを引いて 3-way の入力を組み立てる。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { parsePolicy, type Exemption, type PolicyDocument, type Rule } from "./schema.js";
import {
  containedJoin,
  ensureRepoCached,
  parseGithubRef,
  type GithubRef,
  type RemoteOptions,
} from "./remote.js";
import { ASSET_ROOT } from "./paths.js";
import { TAG_RE } from "./vars.js";

/** guard bump / drift3 が既定で追随する配布元 */
export const DEFAULT_STANDARDS_REPO = "novexar/guardsmith";

export async function loadPolicy(
  policyPath: string,
  opts: PolicyLoadOptions = {},
): Promise<PolicyDocument> {
  return (await loadPolicyWithMeta(policyPath, opts)).policy;
}

/**
 * ポリシー読込のオプション。`headTag` / `repo` は `guard bump <tag>` 用で、
 * 対象リポジトリの drift / drift3 source を **新タグ** で解決させる。
 */
export interface PolicyLoadOptions extends RemoteOptions {
  /** 対象リポジトリの source を解決するタグ(省略時は source 自身のタグ) */
  headTag?: string;
  /** タグ追随の対象リポジトリ(`<owner>/<repo>`)。既定 novexar/guardsmith */
  repo?: string;
}

/** 解決済みポリシーと、解決の過程で失われる情報(drift source の元参照)を併せて返す */
export interface PolicyWithMeta {
  policy: PolicyDocument;
  /**
   * ruleId → `with.source` を file: へ書き換える **前** の参照文字列。
   * drift / drift3 の両方を記録する(drift3 のタグ 2 本解決に必要)。
   */
  driftOrigins: Map<string, string>;
}

/** loadPolicy と同じ解決を行い、drift source の元参照も返す */
export async function loadPolicyWithMeta(
  policyPath: string,
  opts: PolicyLoadOptions = {},
): Promise<PolicyWithMeta> {
  const abs = resolve(policyPath);
  const doc = parseFile(abs);
  const resolved = await resolveDoc(doc, dirname(abs), opts, new Set([`file:${abs}`]));
  const driftOrigins = new Map<string, string>();
  for (const rule of resolved.rules) {
    if (rule.check === "drift" || rule.check === "drift3") {
      driftOrigins.set(rule.id, rule.with.source);
    }
  }
  const rules = await resolveDriftSources(resolved.rules, opts);
  return { policy: { ...resolved, rules }, driftOrigins };
}

/** doc の extends を(多段で)解決し、rules をマージした新しい PolicyDocument を返す */
async function resolveDoc(
  doc: PolicyDocument,
  baseDir: string,
  opts: PolicyLoadOptions,
  seen: Set<string>,
): Promise<PolicyDocument> {
  const merged = new Map<string, Rule>();
  const exemptions: Exemption[] = [];
  const ignore: string[] = [];

  for (const ref of doc.extends ?? []) {
    const loaded = await loadRef(ref, baseDir, opts);
    if (seen.has(loaded.key)) throw new Error(`circular extends detected: ${ref}`);
    if (loaded.doc.target !== doc.target) {
      throw new Error(
        `extends '${ref}' targets '${loaded.doc.target}' but policy targets '${doc.target}'`,
      );
    }
    const base = await resolveDoc(loaded.doc, loaded.baseDir, opts, new Set([...seen, loaded.key]));
    for (const r of base.rules) merged.set(r.id, r);
    exemptions.push(...base.exemptions);
    ignore.push(...base.ignore);
  }
  for (const r of doc.rules) merged.set(r.id, r); // ローカル優先(後勝ち)
  exemptions.push(...doc.exemptions);
  ignore.push(...doc.ignore);

  // ignore は連結。重複だけ除いて宣言順を保つ
  return { ...doc, rules: [...merged.values()], exemptions, ignore: [...new Set(ignore)] };
}

interface LoadedRef {
  doc: PolicyDocument;
  /** このドキュメント内の相対参照の基点 */
  baseDir: string;
  /** 循環検出用の正規化キー */
  key: string;
}

async function loadRef(ref: string, baseDir: string, opts: PolicyLoadOptions): Promise<LoadedRef> {
  if (ref.startsWith("preset:")) {
    const name = ref.slice("preset:".length);
    const candidates = [
      resolve(baseDir, `presets/${name}.yaml`),
      resolve(ASSET_ROOT, `presets/${name}.yaml`),
    ];
    const found = candidates.find((c) => existsSync(c));
    if (!found) throw new Error(`preset not found: ${name} (looked in ${candidates.join(", ")})`);
    return { doc: parseFile(found), baseDir: dirname(found), key: `file:${found}` };
  }
  if (ref.startsWith("file:")) {
    const found = resolve(baseDir, ref.slice("file:".length));
    return { doc: parseFile(found), baseDir: dirname(found), key: `file:${found}` };
  }
  if (ref.startsWith("github:")) {
    const parsed = parseGithubRef(ref);
    // `guard bump <tag>` は **extends も新タグで解決**する。ここを旧タグのままにすると、
    // 新タグの baseline で paths が広がった場合にその bump では新規対象を取りこぼす
    const override = targetsRepo(ref, opts.repo ?? DEFAULT_STANDARDS_REPO)
      ? opts.headTag
      : undefined;
    const gh = { ...parsed, tag: override ?? parsed.tag };
    const repoDir = await ensureRepoCached(gh, opts);
    const file = containedJoin(repoDir, gh.path ?? "guard.policy.yaml");
    if (!existsSync(file)) {
      throw new Error(
        `extends '${ref}': '${gh.path ?? "guard.policy.yaml"}' not found in ` +
          `${gh.owner}/${gh.repo}@${gh.tag}`,
      );
    }
    return { doc: parseFile(file), baseDir: dirname(file), key: `file:${file}` };
  }
  throw new Error(`unsupported extends ref: ${ref} (use preset: / file: / github:)`);
}

/**
 * drift / drift3 ルールの source をキャッシュ取得し file: に解決する(非破壊)。
 *
 * `opts.headTag`(= `guard bump <tag>`)が指定されたときは、**節単位の `drift` も含めて**
 * 対象リポジトリの参照を新タグで解決する。ここを drift3 だけにすると、bump が skills を
 * **旧マスターの内容で**上書きしてしまう(policy のタグだけ新しくなり、次の lint で
 * drift/skills-sync が再発する)。対象外リポジトリの参照は自身の固定タグのまま。
 */
async function resolveDriftSources(rules: Rule[], opts: PolicyLoadOptions): Promise<Rule[]> {
  return Promise.all(
    rules.map(async (rule) => {
      if (rule.check !== "drift" && rule.check !== "drift3") return rule;
      const source = rule.with.source;
      const override = targetsRepo(source, opts.repo ?? DEFAULT_STANDARDS_REPO)
        ? opts.headTag
        : undefined;
      if (source.startsWith("file:")) {
        // ローカル開発用 file: は `{tag}` を描画した先がマスター。
        // タグを持たない参照はどのタグでも同じディレクトリなので、そのまま残す
        const local = parseLocalDriftSource(source);
        const tag = override ?? local.tag;
        if (tag === undefined) return rule;
        return { ...rule, with: { ...rule.with, source: `file:${local.root(tag)}` } };
      }
      if (!source.startsWith("github:")) return rule;
      const gh = parseGithubRef(source);
      const root = await masterRoot({ ...gh, tag: override ?? gh.tag }, opts);
      return { ...rule, with: { ...rule.with, source: `file:${root}` } };
    }),
  );
}

/* ---------------- drift3: タグ2本のマスター解決 ---------------- */

/**
 * 3-way 1 本分の解決結果。sync3.ts の `Drift3Source` と同形だが、resolver → sync3 の
 * 依存を作らないためここで定義する(sync3 側は構造的に受け取れる)。
 */
export interface ResolvedDrift3Source {
  ruleId: string;
  paths: string[];
  baseRoot: string;
  headRoot: string;
  baseTag: string;
  headTag: string;
}

export interface Drift3ResolveOptions extends RemoteOptions {
  /** 新マスターのタグを上書きする(guard bump <tag>)。省略時は source のタグ */
  headTag?: string;
  /** タグ追随の対象リポジトリ(`<owner>/<repo>`)。既定 novexar/guardsmith */
  repo?: string;
}

/** 対象外にした drift3 ルール(vars は単一タグしか持てないため) */
export interface SkippedDrift3 {
  ruleId: string;
  source: string;
}

export interface Drift3Resolution {
  sources: ResolvedDrift3Source[];
  skipped: SkippedDrift3[];
}

/** policy の不整合。取得失敗(ネットワーク等)と区別して即座に落とすために型を分ける */
export class Drift3PolicyError extends Error {}

/**
 * drift3 の元参照から「旧タグ / 新タグ」2 本のマスターを解決する。
 * 旧タグは vars(または CLAUDE.md スタンプ)由来の baseTag。
 * 新タグは source のタグか、opts.headTag の上書き(guard bump)。
 *
 * vars が持つ基準タグは **1 本だけ** なので、対象リポジトリ(既定 novexar/guardsmith)を
 * 指す drift3 のみがタグ追随の対象になる。Layer2 の別リポジトリ標準
 * (例 `github:novexar/guardsmith-private//standards@v3`)に自分のタグを当てると、
 * 存在しないタグで失敗するか、最悪 **同名タグの別組織の標準を黙って適用**してしまう。
 * 対象外のルールは skipped に入れ、呼び出し側が warn を出す。
 */
export async function buildDrift3Sources(
  policy: PolicyDocument,
  driftOrigins: ReadonlyMap<string, string>,
  baseTag: string,
  opts: Drift3ResolveOptions = {},
): Promise<Drift3Resolution> {
  const repo = opts.repo ?? DEFAULT_STANDARDS_REPO;
  const targeted: { ruleId: string; paths: string[]; origin: string }[] = [];
  const skipped: SkippedDrift3[] = [];

  for (const rule of policy.rules) {
    if (rule.check !== "drift3") continue;
    const origin = driftOrigins.get(rule.id) ?? rule.with.source;
    if (targetsRepo(origin, repo)) {
      targeted.push({ ruleId: rule.id, paths: [...rule.with.paths], origin });
    } else {
      skipped.push({ ruleId: rule.id, source: origin });
    }
  }
  if (targeted.length > 1) {
    throw new Drift3PolicyError(
      `drift3 rule for ${repo} must be unique — found ${targeted.length} ` +
        `(${targeted.map((t) => t.ruleId).join(", ")}); ` +
        "the project records a single standards tag, so one rule owns it",
    );
  }

  const sources: ResolvedDrift3Source[] = [];
  for (const t of targeted) {
    const pair = await resolveMasterPair(t.origin, baseTag, opts);
    sources.push({ ruleId: t.ruleId, paths: t.paths, ...pair });
  }
  return { sources, skipped };
}

/**
 * source がタグ追随の対象リポジトリを指すか。
 * `file:` はローカル開発用でリポジトリの概念を持たないため常に対象とする。
 */
function targetsRepo(origin: string, repo: string): boolean {
  if (origin.startsWith("file:")) return true;
  if (!origin.startsWith("github:")) return false;
  const gh = parseGithubRef(origin);
  return `${gh.owner}/${gh.repo}`.toLowerCase() === repo.toLowerCase();
}

/**
 * ruleId → 旧マスターの解決済みディレクトリ(3-way の base 側だけが必要な呼び出し用)。
 * 新タグ側は取得しない(`--init-vars` は旧マスターしか見ないため、不要な tarball 取得で
 * ネットワーク往復を増やさない)。
 */
export async function resolveBaseMasters(
  driftOrigins: ReadonlyMap<string, string>,
  baseTag: string,
  opts: RemoteOptions = {},
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const [ruleId, origin] of driftOrigins) {
    if (origin.startsWith("file:")) {
      const dir = parseLocalDriftSource(origin).root(baseTag);
      if (!existsSync(dir)) {
        throw new Error(`drift3 source '${origin}': base master not found at ${dir}`);
      }
      out.set(ruleId, dir);
    } else if (origin.startsWith("github:")) {
      out.set(ruleId, await masterRoot({ ...parseGithubRef(origin), tag: baseTag }, opts));
    }
  }
  return out;
}

async function resolveMasterPair(
  origin: string,
  baseTag: string,
  opts: Drift3ResolveOptions,
): Promise<{ baseRoot: string; headRoot: string; baseTag: string; headTag: string }> {
  if (origin.startsWith("file:")) {
    const local = parseLocalDriftSource(origin);
    const headTag = opts.headTag ?? local.tag ?? baseTag;
    const roots = { baseRoot: local.root(baseTag), headRoot: local.root(headTag) };
    // github: は ensureRepoCached が存在を保証するが file: は保証が無い。
    // 存在しないディレクトリを黙って空マスターとして扱うと「全ファイルがマスターから
    // 消えた」と誤判定し、bump が何も適用せずタグだけ進めてしまう
    for (const [label, dir] of [
      ["base", roots.baseRoot],
      ["head", roots.headRoot],
    ] as const) {
      if (!existsSync(dir)) {
        throw new Error(`drift3 source '${origin}': ${label} master not found at ${dir}`);
      }
    }
    return { ...roots, baseTag, headTag };
  }
  const gh = parseGithubRef(origin);
  const headTag = opts.headTag ?? gh.tag;
  return {
    baseRoot: await masterRoot({ ...gh, tag: baseTag }, opts),
    headRoot: await masterRoot({ ...gh, tag: headTag }, opts),
    baseTag,
    headTag,
  };
}

/** タグのキャッシュを確保し、//path 配下(キャッシュ内に収まること)を返す */
async function masterRoot(gh: GithubRef, opts: RemoteOptions): Promise<string> {
  const repoDir = await ensureRepoCached(gh, opts);
  const root = gh.path ? containedJoin(repoDir, gh.path) : repoDir;
  return root.replaceAll("\\", "/");
}

/**
 * `file:<dir>[@<tag>]` を分解する。`<dir>` 内の `{tag}` はタグで置換する。
 * タグを持たない旧来の `file:<dir>` はどのタグでも同じディレクトリを指す(= 差分なし)。
 */
function parseLocalDriftSource(source: string): { root: (tag: string) => string; tag?: string } {
  const body = source.slice("file:".length);
  const m = /^(.*)@(v\d+\.\d+\.\d+)$/.exec(body);
  const dir = m ? m[1] : body;
  return {
    root: (tag: string) => {
      // タグはパスへ埋め込まれる。`v..` のような値を通すとディレクトリを遡れてしまう
      if (!TAG_RE.test(tag)) throw new Error(`drift3 source '${source}': invalid tag '${tag}'`);
      return dir.replaceAll("{tag}", tag);
    },
    tag: m?.[2],
  };
}

function parseFile(path: string): PolicyDocument {
  const r = parsePolicy(parseYaml(readFileSync(path, "utf8")));
  if (!r.ok) throw new Error(`invalid policy ${path}:\n  ${r.errors.join("\n  ")}`);
  return r.policy;
}

/* ---------------- SARIF 2.1.0 ---------------- */
import type { LintResult } from "./lint.js";

export function toSarif(result: LintResult, policy: PolicyDocument): string {
  const levels = { error: "error", warn: "warning", info: "note" } as const;
  const ruleIds = [...new Set(result.findings.map((f) => f.ruleId))];
  const sarif = {
    $schema:
      "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "guardsmith",
            informationUri: "https://github.com/novexar/Guardsmith",
            version: "0.6.1",
            rules: ruleIds.map((id) => {
              const rule = policy.rules.find((r) => r.id === id);
              return {
                id,
                shortDescription: { text: rule?.description ?? id },
              };
            }),
          },
        },
        results: result.findings.map((f) => ({
          ruleId: f.ruleId,
          level: levels[f.severity],
          message: { text: f.message },
          ...(f.suppressed
            ? { suppressions: [{ kind: "inSource", justification: "policy exemption" }] }
            : {}),
          locations: [
            {
              physicalLocation: {
                artifactLocation: { uri: f.file ?? "guard.policy.yaml" },
                ...(f.line ? { region: { startLine: f.line } } : {}),
              },
            },
          ],
        })),
      },
    ],
  };
  return JSON.stringify(sarif, null, 2);
}

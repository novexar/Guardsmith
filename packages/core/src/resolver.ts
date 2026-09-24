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

export async function loadPolicy(
  policyPath: string,
  opts: RemoteOptions = {},
): Promise<PolicyDocument> {
  return (await loadPolicyWithMeta(policyPath, opts)).policy;
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
  opts: RemoteOptions = {},
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
  opts: RemoteOptions,
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

async function loadRef(ref: string, baseDir: string, opts: RemoteOptions): Promise<LoadedRef> {
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
    const gh = parseGithubRef(ref);
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

/** drift / drift3 ルールの source をキャッシュ取得し file: に解決する(非破壊) */
async function resolveDriftSources(rules: Rule[], opts: RemoteOptions): Promise<Rule[]> {
  return Promise.all(
    rules.map(async (rule) => {
      if (rule.check !== "drift" && rule.check !== "drift3") return rule;
      const source = rule.with.source;
      if (rule.check === "drift3" && source.startsWith("file:")) {
        // ローカル開発用 file: は、自身のタグで `{tag}` を描画した先が新マスター。
        // タグを持たない参照はどのタグでも同じディレクトリなので、そのまま残す
        const local = parseLocalDriftSource(source);
        if (local.tag === undefined) return rule;
        return { ...rule, with: { ...rule.with, source: `file:${local.root(local.tag)}` } };
      }
      if (!source.startsWith("github:")) return rule;
      const gh = parseGithubRef(source);
      return { ...rule, with: { ...rule.with, source: `file:${await masterRoot(gh, opts)}` } };
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
}

/**
 * drift3 の元参照から「旧タグ / 新タグ」2 本のマスターを解決する。
 * 旧タグは vars(または CLAUDE.md スタンプ)由来の baseTag。
 * 新タグは source のタグか、opts.headTag の上書き(guard bump)。
 */
export async function buildDrift3Sources(
  policy: PolicyDocument,
  driftOrigins: ReadonlyMap<string, string>,
  baseTag: string,
  opts: Drift3ResolveOptions = {},
): Promise<ResolvedDrift3Source[]> {
  const out: ResolvedDrift3Source[] = [];
  for (const rule of policy.rules) {
    if (rule.check !== "drift3") continue;
    const origin = driftOrigins.get(rule.id) ?? rule.with.source;
    const pair = await resolveMasterPair(origin, baseTag, opts);
    out.push({ ruleId: rule.id, paths: [...rule.with.paths], ...pair });
  }
  return out;
}

/** ruleId → 旧マスターの解決済みディレクトリ(3-way の base 側だけが必要な呼び出し用) */
export async function resolveBaseMasters(
  driftOrigins: ReadonlyMap<string, string>,
  baseTag: string,
  opts: RemoteOptions = {},
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const [ruleId, origin] of driftOrigins) {
    if (!origin.startsWith("github:") && !origin.startsWith("file:")) continue;
    out.set(ruleId, (await resolveMasterPair(origin, baseTag, opts)).baseRoot);
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
  const m = /^(.*)@(v[\w.-]+)$/.exec(body);
  const dir = m ? m[1] : body;
  return { root: (tag: string) => dir.replaceAll("{tag}", tag), tag: m?.[2] };
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
            version: "0.6.0",
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

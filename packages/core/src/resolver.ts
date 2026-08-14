/**
 * ポリシー読込と extends 解決 (preset: / file: / github: 対応)
 * マージ規則: extends を宣言順に適用 → ローカル rules が同一idを上書き。exemptionsは連結。
 * extends は多段解決する(Layer3 → Layer2 → Layer1 の3層運用)。循環はエラー。
 * drift の github: source はキャッシュ取得後に file: へ解決してから返す。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { parsePolicy, type Exemption, type PolicyDocument, type Rule } from "./schema.js";
import { containedJoin, ensureRepoCached, parseGithubRef, type RemoteOptions } from "./remote.js";
import { ASSET_ROOT } from "./paths.js";

export async function loadPolicy(
  policyPath: string,
  opts: RemoteOptions = {},
): Promise<PolicyDocument> {
  const abs = resolve(policyPath);
  const doc = parseFile(abs);
  const resolved = await resolveDoc(doc, dirname(abs), opts, new Set([`file:${abs}`]));
  const rules = await resolveDriftSources(resolved.rules, opts);
  return { ...resolved, rules };
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
  }
  for (const r of doc.rules) merged.set(r.id, r); // ローカル優先(後勝ち)
  exemptions.push(...doc.exemptions);

  return { ...doc, rules: [...merged.values()], exemptions };
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

/** drift ルールの github: source をキャッシュ取得し file: に解決する(非破壊) */
async function resolveDriftSources(rules: Rule[], opts: RemoteOptions): Promise<Rule[]> {
  return Promise.all(
    rules.map(async (rule) => {
      if (rule.check !== "drift" || !rule.with.source.startsWith("github:")) return rule;
      const gh = parseGithubRef(rule.with.source);
      const repoDir = await ensureRepoCached(gh, opts);
      const srcRoot = gh.path ? containedJoin(repoDir, gh.path) : repoDir;
      return {
        ...rule,
        with: { ...rule.with, source: `file:${srcRoot.replaceAll("\\", "/")}` },
      };
    }),
  );
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
            version: "0.2.2",
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

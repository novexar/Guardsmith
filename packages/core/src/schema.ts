/**
 * aidev-guard policy schema v0.1
 * guard.policy.yaml / preset YAML の型定義とバリデーション。
 * 設計方針:
 *  - check種別ごとに `with` を discriminated union で厳密化
 *  - 未知キーは strict() で拒否(タイポをエラーにする=ガバナンスツールの信頼性)
 *  - アダプタ(target)は enum で管理し、将来 power-platform 等を追加
 */
import { z } from "zod";

/* ---------- 共通プリミティブ ---------- */

export const RULE_ID = z
  .string()
  .regex(
    /^[a-z0-9-]+\/[a-z0-9-]+$/,
    "rule id must be '<category>/<kebab-name>' (e.g. claude-md/thin-diff)",
  );

export const Severity = z.enum(["error", "warn", "info"]);
export type Severity = z.infer<typeof Severity>;

export const Target = z.enum([
  "claude-code",
  // 予約: "cursor", "codex", "power-platform"
]);
export type Target = z.infer<typeof Target>;

/** preset:<name> | github:<owner>/<repo>[//path]@<tag> */
export const ExtendsRef = z.union([
  z.string().regex(/^preset:[a-z0-9-]+$/, "local preset ref: preset:<name>"),
  z.string().regex(/^file:.+\.ya?ml$/, "local file ref: file:./path/to/policy.yaml"),
  z
    .string()
    .regex(
      /^github:[\w.-]+\/[\w.-]+(\/\/[\w./-]+)?@[\w.-]+$/,
      "remote ref must pin a tag: github:owner/repo[//path]@tag",
    ),
]);

/**
 * drift / drift3 の source: github:owner/repo[//path]@tag (タグ固定必須) または
 * file:<dir> (ローカル開発用)。
 * //path はマスターがリポジトリのサブディレクトリにある場合に指定(例: guardsmith の standards/)。
 *
 * drift3 は旧タグ・新タグの 2 本のマスターを必要とする。ローカル開発用の file: では
 * `file:<dir>[@<tag>]` と書き、`<dir>` に含まれる `{tag}` をタグで置換して両方を得る
 * (例: `file:./fixtures/{tag}/standards@v0.7.0`)。詳細は resolver.ts を参照。
 */
export const DriftSource = z.union([
  z
    .string()
    .regex(
      /^github:[\w.-]+\/[\w.-]+(\/\/[\w./-]+)?@[\w.-]+$/,
      "drift source: github:owner/repo[//path]@tag",
    ),
  z.string().regex(/^file:.+$/, "local drift source: file:./path/to/master"),
]);

const NonEmpty = z.string().min(1);
const Paths = z.array(NonEmpty).min(1);

/* ---------- ルール共通フィールド ---------- */

/**
 * 全 check 共通のフィールド。各 check ブランチへ直接展開する。
 *
 * 重要: 以前は `discriminatedUnion(...).and(RuleBase)` で合成していたが、zod の intersection
 * を通すとブランチ側 `.strict()` の未知キー拒否が失われ、`with` のタイポ(`limt` 等)が
 * 黙って捨てられていた。「タイポはエラー」を守るため共通フィールドを各ブランチへ平坦化し、
 * discriminatedUnion 1段だけで Rule を構成する。
 */
const RULE_BASE = {
  id: RULE_ID,
  severity: Severity,
  description: NonEmpty.optional(),
};

/* ---------- check種別ごとの with ---------- */

const FileExists = z
  .object({
    ...RULE_BASE,
    check: z.literal("file-exists"),
    with: z.object({ paths: Paths }).strict(),
  })
  .strict();

const FileAbsent = z
  .object({
    ...RULE_BASE,
    check: z.literal("file-absent"),
    with: z.object({ paths: Paths }).strict(),
  })
  .strict();

const ContentMatch = z
  .object({
    ...RULE_BASE,
    check: z.literal("content-match"),
    with: z
      .object({
        path: NonEmpty, // glob可
        must: z.array(NonEmpty).optional(),
        must_not: z.array(NonEmpty).optional(),
      })
      .strict()
      .refine((w) => (w.must?.length ?? 0) + (w.must_not?.length ?? 0) > 0, {
        message: "content-match requires at least one of must / must_not",
      }),
  })
  .strict();

const MaxLines = z
  .object({
    ...RULE_BASE,
    check: z.literal("max-lines"),
    with: z.object({ path: NonEmpty, limit: z.number().int().positive() }).strict(),
  })
  .strict();

/**
 * import-budget: CLAUDE.md 本体 + `@` インポート先の常駐量を測る。
 * max_depth の既定は公式仕様の上限(four hops)= DEFAULT_IMPORT_MAX_DEPTH。
 */
const ImportBudget = z
  .object({
    ...RULE_BASE,
    check: z.literal("import-budget"),
    with: z
      .object({
        path: NonEmpty, // glob可(通常は CLAUDE.md)
        /** 本体 + インポート先の合計文字数の上限。超過で rule の severity の finding */
        max_chars: z.number().int().positive().optional(),
        /** 再帰インポートを追う深さの上限(省略時 4) */
        max_depth: z.number().int().positive().optional(),
      })
      .strict(),
  })
  .strict();

const Frontmatter = z
  .object({
    ...RULE_BASE,
    check: z.literal("frontmatter"),
    with: z
      .object({
        paths: Paths,
        required: z.array(NonEmpty).min(1),
        /** キーごとの値制約(regex)。v0.1では文字列regexのみ */
        schema: z.record(NonEmpty, NonEmpty).optional(),
      })
      .strict(),
  })
  .strict();

const JsonPathOp = z.enum(["eq", "ne", "matches", "not-matches", "exists", "absent"]);

const JsonPath = z
  .object({
    ...RULE_BASE,
    check: z.literal("json-path"),
    with: z
      .object({
        path: NonEmpty,
        assert: z
          .array(
            z
              .object({
                query: NonEmpty, // JSONPath式 ($.permissions.allow[*] 等)
                op: JsonPathOp,
                value: z.union([z.string(), z.number(), z.boolean()]).optional(),
              })
              .strict()
              .refine((a) => ["exists", "absent"].includes(a.op) || a.value !== undefined, {
                message: "value is required unless op is exists/absent",
              }),
          )
          .min(1),
      })
      .strict(),
  })
  .strict();

const Drift = z
  .object({
    ...RULE_BASE,
    check: z.literal("drift"),
    with: z
      .object({
        source: DriftSource,
        paths: Paths,
        /** 見出し(## 〜)単位で編集を許可する範囲 */
        allow_sections: z.array(NonEmpty).optional(),
      })
      .strict(),
  })
  .strict();

/**
 * drift3: vars 駆動の 3-way 追随検査。
 *
 * 既存 `drift`(節単位・マスターが正)とは `with` の意味がまったく違うため、同じ check に
 * 同居させず別 check にしている(§1.2 U1)。`allow_sections` は 3-way では不要なので
 * **持たせない**(誤用防止)。旧 CLI は未知 check として明確に拒否する。
 */
const Drift3 = z
  .object({
    ...RULE_BASE,
    check: z.literal("drift3"),
    with: z
      .object({
        source: DriftSource,
        paths: Paths,
      })
      .strict(),
  })
  .strict();

const SecretScan = z
  .object({
    ...RULE_BASE,
    check: z.literal("secret-scan"),
    with: z
      .object({
        paths: Paths,
        extra_patterns: z.array(NonEmpty).optional(),
      })
      .strict(),
  })
  .strict();

/* ---------- ルール本体 ---------- */

export const Rule = z.discriminatedUnion("check", [
  FileExists,
  FileAbsent,
  ContentMatch,
  MaxLines,
  ImportBudget,
  Frontmatter,
  JsonPath,
  Drift,
  Drift3,
  SecretScan,
]);
export type Rule = z.infer<typeof Rule>;

/* ---------- 例外・出力 ---------- */

export const Exemption = z
  .object({
    rule: RULE_ID,
    reason: NonEmpty,
    expires: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expires must be YYYY-MM-DD"),
    approved_by: NonEmpty,
  })
  .strict();
export type Exemption = z.infer<typeof Exemption>;

export const OutputFormat = z.enum(["console", "sarif", "json"]);

/* ---------- ポリシードキュメント ---------- */

export const PolicyDocument = z
  .object({
    version: z.literal(1),
    target: Target,
    extends: z.array(ExtendsRef).optional(),
    /**
     * 走査対象から除外する glob。extends では「連結」される(rules のような後勝ち上書きではない)。
     * 巨大な無関係ディレクトリ(エージェント用 worktree・.venv 等)の走査を止める用途。
     */
    ignore: z.array(NonEmpty).default([]),
    rules: z.array(Rule).default([]),
    exemptions: z.array(Exemption).default([]),
    output: z
      .object({ formats: z.array(OutputFormat).min(1) })
      .strict()
      .optional(),
  })
  .strict();
export type PolicyDocument = z.infer<typeof PolicyDocument>;

/* ---------- パースAPI ---------- */

export type ParseResult = { ok: true; policy: PolicyDocument } | { ok: false; errors: string[] };

export function parsePolicy(data: unknown): ParseResult {
  const r = PolicyDocument.safeParse(data);
  if (r.success) {
    const dup = findDuplicateRuleIds(r.data.rules);
    if (dup.length > 0) return { ok: false, errors: dup.map((d) => `duplicate rule id: ${d}`) };
    return { ok: true, policy: r.data };
  }
  return {
    ok: false,
    errors: r.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
  };
}

function findDuplicateRuleIds(rules: Rule[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const r of rules) (seen.has(r.id) ? dup : seen).add(r.id);
  return [...dup];
}

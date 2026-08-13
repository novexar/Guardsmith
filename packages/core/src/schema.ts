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
 * drift の source: github:owner/repo[//path]@tag (タグ固定必須) または file:<dir> (ローカル開発用)
 * //path はマスターがリポジトリのサブディレクトリにある場合に指定(例: guardsmith の standards/)
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

/* ---------- check種別ごとの with ---------- */

const FileExists = z.object({
  check: z.literal("file-exists"),
  with: z.object({ paths: Paths }).strict(),
});

const FileAbsent = z.object({
  check: z.literal("file-absent"),
  with: z.object({ paths: Paths }).strict(),
});

const ContentMatch = z.object({
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
});

const MaxLines = z.object({
  check: z.literal("max-lines"),
  with: z.object({ path: NonEmpty, limit: z.number().int().positive() }).strict(),
});

const Frontmatter = z.object({
  check: z.literal("frontmatter"),
  with: z
    .object({
      paths: Paths,
      required: z.array(NonEmpty).min(1),
      /** キーごとの値制約(regex)。v0.1では文字列regexのみ */
      schema: z.record(NonEmpty, NonEmpty).optional(),
    })
    .strict(),
});

const JsonPathOp = z.enum(["eq", "ne", "matches", "not-matches", "exists", "absent"]);

const JsonPath = z.object({
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
});

const Drift = z.object({
  check: z.literal("drift"),
  with: z
    .object({
      source: DriftSource,
      paths: Paths,
      /** 見出し(## 〜)単位で編集を許可する範囲 */
      allow_sections: z.array(NonEmpty).optional(),
    })
    .strict(),
});

const SecretScan = z.object({
  check: z.literal("secret-scan"),
  with: z
    .object({
      paths: Paths,
      extra_patterns: z.array(NonEmpty).optional(),
    })
    .strict(),
});

/* ---------- ルール本体 ---------- */

const RuleBase = z.object({
  id: RULE_ID,
  severity: Severity,
  description: NonEmpty.optional(),
});

export const Rule = z
  .discriminatedUnion("check", [
    FileExists,
    FileAbsent,
    ContentMatch,
    MaxLines,
    Frontmatter,
    JsonPath,
    Drift,
    SecretScan,
  ])
  .and(RuleBase);
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

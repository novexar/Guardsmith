/**
 * guardsmith.vars.yaml — standards テンプレートの置換値(PJ ルート・コミット対象)。
 *
 * 3-way 取り込み(sync3)は「マスターを PJ の値で具体化したもの」を base / theirs として使う。
 * その置換値の唯一の出どころが本ファイルで、基準タグ(`standards`)も併せて持つ。
 * vars が無い PJ は CLAUDE.md 末尾スタンプからタグだけ読む(値は復元できないため節単位へ退避)。
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { STAMP_CAPTURE_RE } from "./normalize.js";

export const VARS_FILENAME = "guardsmith.vars.yaml";

/** タグ固定(@vX.Y.Z)は本ツールの根幹制約。ここでも緩めない */
export const TAG_RE = /^v\d+\.\d+\.\d+$/;
const TAG_MESSAGE = "standards must pin a tag: vX.Y.Z";

export const VarsDocument = z
  .object({
    version: z.literal(1).default(1),
    /** 生成・同期の基準タグ。vX.Y.Z 固定 */
    standards: z.string().regex(TAG_RE, TAG_MESSAGE),
    vars: z.record(z.string().min(1), z.string()).default({}),
  })
  .strict();
export type VarsDocument = z.infer<typeof VarsDocument>;

/** 基準タグの解決結果。`stampTag` は vars と食い違うスタンプ(呼び出し側が warn を出す) */
export interface BaseTagResolution {
  tag: string;
  from: "vars" | "stamp";
  stampTag?: string;
}

/** PJ ルートの vars を読む。存在しなければ null、壊れていれば throw */
export function loadVars(rootDir: string): VarsDocument | null {
  const path = join(rootDir, VARS_FILENAME);
  if (!existsSync(path)) return null;
  return parseVars(readFileSync(path, "utf8"));
}

/** YAML テキストから vars を作る(検証込み)。テスト・CLI からの直接利用も想定 */
export function parseVars(text: string): VarsDocument {
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (e) {
    throw new Error(`${VARS_FILENAME}: invalid YAML: ${(e as Error).message}`);
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`${VARS_FILENAME}: expected a mapping at the document root`);
  }
  const parsed = VarsDocument.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`${VARS_FILENAME}: ${formatIssues(parsed.error)}`);
  }
  return parsed.data;
}

/** 不変更新。`standards` だけ差し替えた新オブジェクトを返す(入力は変更しない) */
export function withStandardsTag(doc: Readonly<VarsDocument>, tag: string): VarsDocument {
  if (!TAG_RE.test(tag)) throw new Error(`${TAG_MESSAGE} (got '${tag}')`);
  return { version: doc.version, standards: tag, vars: { ...doc.vars } };
}

/** 先頭に説明コメント付きで書き出す(キーは昇順、キー・値は必ずクォート) */
export function writeVars(rootDir: string, doc: Readonly<VarsDocument>): void {
  writeFileSync(join(rootDir, VARS_FILENAME), serializeVars(doc));
}

/** writeVars が書き出す YAML テキスト */
export function serializeVars(doc: Readonly<VarsDocument>): string {
  const lines = [
    `# ${VARS_FILENAME} — standards テンプレートの置換値(コミット対象)`,
    "# 値は PM が確認して確定すること。TODO が残っている間 guard bump は失敗する。",
    "# 秘密情報(APIキー・パスワード・トークン)は絶対に書かない。",
    `version: ${doc.version}`,
    `standards: ${quote(doc.standards)}`,
    "vars:",
  ];
  const keys = Object.keys(doc.vars).sort();
  if (keys.length === 0) lines[lines.length - 1] = "vars: {}";
  for (const key of keys) lines.push(`  ${quote(key)}: ${quote(doc.vars[key])}`);
  return `${lines.join("\n")}\n`;
}

/** vars → CLAUDE.md スタンプ → null の優先順で基準タグを決める */
export function resolveBaseTag(rootDir: string): BaseTagResolution | null {
  const claudeMdPath = join(rootDir, "CLAUDE.md");
  const stampTag = existsSync(claudeMdPath)
    ? readStampTag(readFileSync(claudeMdPath, "utf8"))
    : null;
  const vars = loadVars(rootDir);
  if (vars !== null) {
    // D2: 食い違いは vars を採用し、呼び出し側が warn を出せるよう差分を返す
    return stampTag !== null && stampTag !== vars.standards
      ? { tag: vars.standards, from: "vars", stampTag }
      : { tag: vars.standards, from: "vars" };
  }
  return stampTag === null ? null : { tag: stampTag, from: "stamp" };
}

/** CLAUDE.md 本文の末尾スタンプからタグを取り出す */
export function readStampTag(claudeMd: string): string | null {
  return STAMP_CAPTURE_RE.exec(claudeMd)?.[1] ?? null;
}

/** YAML の二重引用符スカラは JSON のエスケープ規則と互換 */
function quote(value: string): string {
  return JSON.stringify(value);
}

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((i) => `${i.path.length > 0 ? `${i.path.join(".")}: ` : ""}${i.message}`)
    .join("; ");
}

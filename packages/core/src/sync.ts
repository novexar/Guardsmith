/**
 * guard sync — drift ルールの source から標準ファイルを復元する。
 *  - allow_sections に列挙された見出しのセクションだけ PJ ローカルの内容を残し、
 *    それ以外はマスター内容へ復元する(見出し単位のマージ)
 *  - マスターに存在して PJ に無いファイルは新規作成
 *  - マスターに無い PJ ローカルファイルには触れない
 *  - 既定は dry-run(差分表示のみ)。--write で実書き込み
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import fg from "fast-glob";
import { normalizeEol, splitSections } from "./checks.js";
import type { PolicyDocument } from "./schema.js";

export interface SyncAction {
  file: string;
  kind: "create" | "restore";
  /** restore で マスター内容に戻るセクション見出し(先頭部は "(preamble)") */
  sections: string[];
  /** 適用後のファイル全内容 */
  content: string;
}

export interface SyncPlan {
  actions: SyncAction[];
  /** マスターに存在しない PJ ローカルファイル(維持) */
  localOnly: string[];
}

/** 復元計画を作る。policy は loadPolicy 済み(= drift source が file: 解決済み)であること */
export async function planSync(policy: PolicyDocument, rootDir: string): Promise<SyncPlan> {
  const actions: SyncAction[] = [];
  const localOnly: string[] = [];

  for (const rule of policy.rules) {
    if (rule.check !== "drift") continue;
    const src = rule.with.source;
    if (!src.startsWith("file:")) {
      throw new Error(`drift source is not resolved to file:: ${src}`);
    }
    const srcRoot = src.slice("file:".length);
    const allow = new Set(rule.with.allow_sections ?? []);

    const masterFiles = await fg(rule.with.paths, { cwd: srcRoot, dot: true });
    for (const file of masterFiles) {
      // EOL(CRLF/LF)差は drift 検査と同様に差分とみなさない
      const master = normalizeEol(readFileSync(join(srcRoot, file), "utf8"));
      const localPath = join(rootDir, file);
      if (!existsSync(localPath)) {
        actions.push({ file, kind: "create", sections: [], content: master });
        continue;
      }
      const local = normalizeEol(readFileSync(localPath, "utf8"));
      if (local === master) continue;
      const { content, restored } = mergeSections(master, local, allow);
      if (content !== local) {
        actions.push({ file, kind: "restore", sections: restored, content });
      }
    }

    const localFiles = await fg(rule.with.paths, { cwd: rootDir, dot: true });
    for (const file of localFiles) {
      if (!existsSync(join(srcRoot, file))) localOnly.push(file);
    }
  }
  return { actions, localOnly };
}

/** 計画を実ファイルへ適用する */
export function applySync(plan: SyncPlan, rootDir: string): void {
  for (const a of plan.actions) {
    const path = join(rootDir, a.file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, a.content);
  }
}

/** dry-run / 適用結果の表示 */
export function formatPlan(plan: SyncPlan, write: boolean): string {
  const lines: string[] = [];
  for (const a of plan.actions) {
    if (a.kind === "create") {
      lines.push(`CREATE   ${a.file} (missing locally — copied from master)`);
    } else {
      lines.push(`RESTORE  ${a.file} — sections: ${a.sections.join(", ")}`);
    }
  }
  for (const f of plan.localOnly) {
    lines.push(`KEEP     ${f} (project-local, not in master)`);
  }
  const creates = plan.actions.filter((a) => a.kind === "create").length;
  const restores = plan.actions.length - creates;
  lines.push(
    `\n${creates} create, ${restores} restore, ${plan.localOnly.length} project-local` +
      (plan.actions.length === 0
        ? " — already in sync"
        : write
          ? " — applied"
          : " — dry-run (use --write to apply)"),
  );
  return lines.join("\n");
}

/**
 * master の構成を正とし、allow_sections のセクションだけ local の内容を残すマージ。
 *  - master に無い local-only セクション: allow なら末尾に温存、それ以外は削除(=復元)
 */
function mergeSections(
  master: string,
  local: string,
  allow: Set<string>,
): { content: string; restored: string[] } {
  const mSec = splitSections(master);
  const lSec = splitSections(local);
  const restored: string[] = [];
  const parts: string[] = [];

  for (const [heading, mContent] of mSec) {
    const lContent = lSec.get(heading);
    const useLocal = allow.has(heading) && lContent !== undefined;
    if (!useLocal && (lContent ?? mContent) !== mContent) {
      restored.push(heading === "" ? "(preamble)" : heading);
    }
    const content = useLocal ? lContent : mContent;
    parts.push(heading === "" ? content : `${heading}\n${content}`);
  }
  for (const [heading, lContent] of lSec) {
    if (mSec.has(heading)) continue;
    if (allow.has(heading)) {
      parts.push(`${heading}\n${lContent}`); // PJ固有の許可セクションは温存
    } else {
      restored.push(`${heading} (removed)`);
    }
  }
  return { content: parts.join("\n"), restored };
}

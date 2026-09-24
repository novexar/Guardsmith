/**
 * 2 相適用の巻き戻し(レビュー MEDIUM 1)。
 *
 * 確定フェーズ(rename)の途中で失敗したとき、確定済みのファイルを元へ戻さないと
 * 「1 件目だけ新しい・残りは旧」という状態が残る。rename の失敗は環境依存で作れないため、
 * node:fs の renameSync をモックして N 回目だけ失敗させる。
 */
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeFixtureDir, write } from "./helpers.js";

/** vi.mock はファイル先頭へ巻き上げられるため、共有状態は vi.hoisted で作る */
const state = vi.hoisted(() => ({ calls: 0, failAt: 0 }));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    renameSync: (from: string, to: string) => {
      state.calls += 1;
      if (state.failAt > 0 && state.calls === state.failAt) {
        throw new Error("EPERM: simulated rename failure");
      }
      return actual.renameSync(from, to);
    },
  };
});

const { writeAtomically, TMP_SUFFIX } = await import("../src/atomic.js");

const dirs: string[] = [];
function fixtureDir(prefix: string): string {
  const d = makeFixtureDir(prefix);
  dirs.push(d);
  return d;
}

beforeEach(() => {
  state.calls = 0;
  state.failAt = 0;
});
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe("writeAtomically", () => {
  it("全件成功すれば全部書かれる", () => {
    const root = fixtureDir("gs-atomic-ok");
    write(root, "a.md", "旧 A\n");
    writeAtomically(root, [
      { file: "a.md", content: "新 A\n" },
      { file: "docs/b.md", content: "新 B\n" },
    ]);
    expect(readFileSync(join(root, "a.md"), "utf8")).toBe("新 A\n");
    expect(readFileSync(join(root, "docs/b.md"), "utf8")).toBe("新 B\n");
    expect(existsSync(join(root, `a.md${TMP_SUFFIX}`))).toBe(false);
  });

  it("2 件目の rename が失敗したら 1 件目を元に戻す", () => {
    const root = fixtureDir("gs-atomic-rename");
    write(root, "a.md", "旧 A\n");
    write(root, "b.md", "旧 B\n");
    state.failAt = 2;

    expect(() =>
      writeAtomically(root, [
        { file: "a.md", content: "新 A\n" },
        { file: "b.md", content: "新 B\n" },
      ]),
    ).toThrow(/rolled back 1 file\(s\) — nothing was applied/);

    expect(readFileSync(join(root, "a.md"), "utf8")).toBe("旧 A\n");
    expect(readFileSync(join(root, "b.md"), "utf8")).toBe("旧 B\n");
    expect(existsSync(join(root, `a.md${TMP_SUFFIX}`))).toBe(false);
    expect(existsSync(join(root, `b.md${TMP_SUFFIX}`))).toBe(false);
  });

  it("新規作成だったファイルは巻き戻しで削除される", () => {
    const root = fixtureDir("gs-atomic-create");
    write(root, "keep.md", "旧\n");
    state.failAt = 2;

    expect(() =>
      writeAtomically(root, [
        { file: "docs/NEW.md", content: "新規\n" },
        { file: "keep.md", content: "更新\n" },
      ]),
    ).toThrow(/nothing was applied/);

    expect(existsSync(join(root, "docs/NEW.md"))).toBe(false);
    expect(readFileSync(join(root, "keep.md"), "utf8")).toBe("旧\n");
  });

  it("root 外への書き込みは stage 前に落ちる", () => {
    const parent = fixtureDir("gs-atomic-escape");
    const root = join(parent, "proj");
    write(parent, "victim.md", "触ってはいけない\n");
    write(root, "a.md", "旧 A\n");

    expect(() =>
      writeAtomically(root, [
        { file: "a.md", content: "新 A\n" },
        { file: "../victim.md", content: "上書き\n" },
      ]),
    ).toThrow(/outside the project root/);

    expect(readFileSync(join(parent, "victim.md"), "utf8")).toBe("触ってはいけない\n");
    expect(readFileSync(join(root, "a.md"), "utf8")).toBe("旧 A\n");
    expect(existsSync(join(root, `a.md${TMP_SUFFIX}`))).toBe(false);
  });
});

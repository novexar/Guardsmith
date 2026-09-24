/** 3-way マージラッパー — 行単位 / EOL 保存 / 衝突マーカー */
import { describe, expect, it } from "vitest";
import { detectEol, merge3, toLines } from "../src/merge3.js";

describe("merge3", () => {
  // 11
  it("applies a base→theirs change cleanly onto ours", () => {
    const base = "a\nb\nc\n";
    const ours = "a\nb\nc\nPJ 固有の追記\n";
    const theirs = "a\nB-updated\nc\n";
    const res = merge3(ours, base, theirs);
    expect(res.conflicts).toEqual([]);
    expect(res.merged).toBe("a\nB-updated\nc\nPJ 固有の追記\n");
    expect(res.changed).toBe(true);
  });

  // 11: 単語単位マージになっていないことの明示検証
  it("merges line by line, never word by word", () => {
    const base = "one two three\n";
    const ours = "ONE two three\n";
    const theirs = "one two THREE\n";
    const res = merge3(ours, base, theirs);
    // 単語単位なら "ONE two THREE" がクリーンに出てしまう
    expect(res.merged).toBeUndefined();
    expect(res.conflicts).toHaveLength(1);
    expect(res.conflicts[0].ours).toEqual(["ONE two three"]);
    expect(res.conflicts[0].theirs).toEqual(["one two THREE"]);
    expect(res.conflicts[0].base).toEqual(["one two three"]);
  });

  // 12
  it("reports a conflict and withholds merged when both sides differ at the same place", () => {
    const res = merge3("a\nours\nc\n", "a\nbase\nc\n", "a\ntheirs\nc\n");
    expect(res.merged).toBeUndefined();
    expect(res.changed).toBe(false);
    expect(res.conflicts).toHaveLength(1);
    expect(res.conflicts[0].startLine).toBe(1);
  });

  // 13
  it("does not conflict when both sides made the identical change", () => {
    const res = merge3("a\nsame\nc\n", "a\nbase\nc\n", "a\nsame\nc\n");
    expect(res.conflicts).toEqual([]);
    expect(res.merged).toBe("a\nsame\nc\n");
    expect(res.changed).toBe(false);
  });

  it("returns unchanged when neither side moved", () => {
    const res = merge3("a\nb\n", "a\nb\n", "a\nb\n");
    expect(res.merged).toBe("a\nb\n");
    expect(res.changed).toBe(false);
  });

  // 14
  it("keeps CRLF from ours, including on conflict marker lines", () => {
    const ours = "a\r\nours\r\nc\r\n";
    const base = "a\nbase\nc\n";
    const theirs = "a\ntheirs\nc\n";
    const res = merge3(ours, base, theirs, {
      markers: true,
      labels: { ours: "ours (project)", base: "base (v0.5.1)", theirs: "theirs (v0.6.0)" },
    });
    expect(res.eol).toBe("\r\n");
    expect(res.merged).toContain("<<<<<<< ours (project)\r\n");
    expect(res.merged).not.toMatch(/[^\r]\n/);
  });

  it("keeps LF when ours is LF even if the masters use CRLF", () => {
    const res = merge3("a\nb\n", "a\r\nb\r\n", "a\r\nB\r\n");
    expect(res.eol).toBe("\n");
    expect(res.merged).toBe("a\nB\n");
  });

  // 15
  it("emits all four diff3 markers with labels when markers is on", () => {
    const res = merge3("a\nours\n", "a\nbase\n", "a\ntheirs\n", {
      markers: true,
      labels: { ours: "OURS", base: "BASE", theirs: "THEIRS" },
    });
    expect(res.merged).toContain("<<<<<<< OURS");
    expect(res.merged).toContain("||||||| BASE");
    expect(res.merged).toContain("=======");
    expect(res.merged).toContain(">>>>>>> THEIRS");
    expect(res.conflicts).toHaveLength(1);
  });

  it("emits bare markers when no labels are supplied", () => {
    const res = merge3("a\nours\n", "a\nbase\n", "a\ntheirs\n", { markers: true });
    expect(res.merged).toContain("<<<<<<<\n");
    expect(res.merged).toContain(">>>>>>>\n");
  });

  // 16
  it("preserves the presence or absence of a trailing newline", () => {
    const withNl = merge3("a\nb\n", "a\nb\n", "a\nB\n");
    expect(withNl.merged).toBe("a\nB\n");
    const withoutNl = merge3("a\nb", "a\nb", "a\nB");
    expect(withoutNl.merged).toBe("a\nB");
  });

  // 17
  it("survives empty and single-line inputs", () => {
    expect(merge3("", "", "").merged).toBe("");
    expect(merge3("", "", "x\n").merged).toBe("x\n");
    expect(merge3("only\n", "only\n", "only\n").merged).toBe("only\n");
    expect(merge3("only", "only", "changed").merged).toBe("changed");
  });
});

// M5: 末尾改行の有無は文書全体の属性。行の内容として diff すると本文と無関係に衝突する
describe("末尾改行の非対称", () => {
  const BASE = "# A\n\n標準の本文。\n";
  const THEIRS = "# A\n\n標準の本文(更新)。\n";

  it("ours だけ末尾改行が無くても衝突せず、出力は標準側に揃う", () => {
    const ours = "# A\n\n標準の本文。"; // PJ が末尾改行を落としている
    const res = merge3(ours, BASE, THEIRS);
    expect(res.conflicts).toEqual([]);
    expect(res.merged).toBe(THEIRS);
  });

  it("ours だけ末尾改行があり標準側に無い場合は標準側(改行なし)に揃う", () => {
    const res = merge3("# A\n\n標準の本文。\n", "# A\n\n標準の本文。", "# A\n\n標準の本文(更新)。");
    expect(res.conflicts).toEqual([]);
    expect(res.merged).toBe("# A\n\n標準の本文(更新)。");
  });

  it("非対称でも PJ の追記は保たれる", () => {
    const ours = "# A\n\n標準の本文。\n\nPJ の追記。"; // 末尾改行なし
    const res = merge3(ours, BASE, THEIRS);
    expect(res.conflicts).toEqual([]);
    expect(res.merged).toBe("# A\n\n標準の本文(更新)。\n\nPJ の追記。\n");
  });

  it("3 者が一致していれば従来どおり末尾改行の有無を往復保存する", () => {
    expect(merge3("a\nb", "a\nb", "a\nc").merged).toBe("a\nc");
    expect(merge3("a\nb\n", "a\nb\n", "a\nc\n").merged).toBe("a\nc\n");
  });

  it("CRLF の ours でも非対称を解消して CRLF で出力する", () => {
    const res = merge3("# A\r\n\r\n標準の本文。", BASE, THEIRS);
    expect(res.conflicts).toEqual([]);
    expect(res.merged).toBe("# A\r\n\r\n標準の本文(更新)。\r\n");
  });
});

describe("toLines / detectEol", () => {
  it("round-trips through join", () => {
    for (const text of ["", "a", "a\n", "a\nb\n", "a\r\nb\r\n"]) {
      expect(toLines(text).join("\n")).toBe(text.replaceAll("\r\n", "\n"));
    }
  });

  it("detects CRLF only when present", () => {
    expect(detectEol("a\r\nb")).toBe("\r\n");
    expect(detectEol("a\nb")).toBe("\n");
    expect(detectEol("")).toBe("\n");
  });
});

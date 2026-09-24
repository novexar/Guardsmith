/** guardsmith.vars.yaml のスキーマ / 読み書き / 基準タグ解決 */
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  VARS_FILENAME,
  loadVars,
  readStampTag,
  resolveBaseTag,
  withStandardsTag,
  writeVars,
} from "../src/vars.js";
import { makeFixtureDir, write } from "./helpers.js";

const dirs: string[] = [];
function fixture(): string {
  const d = makeFixtureDir("gs-vars");
  dirs.push(d);
  return d;
}
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
});

const STAMPED = "# CLAUDE.md\n\n<!-- standards: novexar/guardsmith v0.4.2 -->\n";

describe("loadVars", () => {
  // 18
  it("reads a valid vars document", () => {
    const root = fixture();
    write(
      root,
      VARS_FILENAME,
      'version: 1\nstandards: "v0.5.1"\nvars:\n  PROJECT_NAME: "Acme"\n  "ORG/REPO": "novexar/acme"\n',
    );
    const doc = loadVars(root);
    expect(doc).not.toBeNull();
    expect(doc?.standards).toBe("v0.5.1");
    expect(doc?.vars.PROJECT_NAME).toBe("Acme");
    expect(doc?.vars["ORG/REPO"]).toBe("novexar/acme");
  });

  it("returns null when the file is absent", () => {
    expect(loadVars(fixture())).toBeNull();
  });

  // 18
  it("rejects a standards value that is not a pinned tag", () => {
    const root = fixture();
    write(root, VARS_FILENAME, "version: 1\nstandards: main\nvars: {}\n");
    expect(() => loadVars(root)).toThrow(/vX\.Y\.Z/);
  });

  // 19
  it("rejects unknown top-level keys (strict)", () => {
    const root = fixture();
    write(root, VARS_FILENAME, 'version: 1\nstandards: "v0.5.1"\nvars: {}\nextra: nope\n');
    expect(() => loadVars(root)).toThrow(/extra|Unrecognized/i);
  });

  it("defaults version and vars", () => {
    const root = fixture();
    write(root, VARS_FILENAME, 'standards: "v0.5.1"\n');
    const doc = loadVars(root);
    expect(doc?.version).toBe(1);
    expect(doc?.vars).toEqual({});
  });

  it("reports the filename when the YAML is not a mapping", () => {
    const root = fixture();
    write(root, VARS_FILENAME, "- a\n- b\n");
    expect(() => loadVars(root)).toThrow(/guardsmith\.vars\.yaml/);
  });
});

describe("withStandardsTag", () => {
  // 20
  it("returns a new object and never mutates the input", () => {
    const doc = { version: 1 as const, standards: "v0.5.1", vars: { A: "1" } };
    const frozen = Object.freeze({ ...doc, vars: Object.freeze({ ...doc.vars }) });
    const next = withStandardsTag(frozen, "v0.6.0");
    expect(next.standards).toBe("v0.6.0");
    expect(frozen.standards).toBe("v0.5.1");
    expect(next).not.toBe(frozen);
    expect(next.vars).not.toBe(frozen.vars);
    expect(next.vars).toEqual({ A: "1" });
  });

  it("rejects a tag that is not pinned", () => {
    const doc = { version: 1 as const, standards: "v0.5.1", vars: {} };
    expect(() => withStandardsTag(doc, "0.6.0")).toThrow(/vX\.Y\.Z/);
  });
});

describe("writeVars", () => {
  // 21
  it("round-trips through loadVars", () => {
    const root = fixture();
    const doc = {
      version: 1 as const,
      standards: "v0.6.0",
      vars: { ZED: "last", "ORG/REPO": "novexar/acme", "単一システム | モノレポ": "モノレポ" },
    };
    writeVars(root, doc);
    expect(loadVars(root)).toEqual(doc);
  });

  it("writes a leading comment and sorts keys ascending", () => {
    const root = fixture();
    writeVars(root, { version: 1, standards: "v0.6.0", vars: { B: "2", A: "1" } });
    const text = readFileSync(join(root, VARS_FILENAME), "utf8");
    expect(text.startsWith("#")).toBe(true);
    expect(text.indexOf('"A"')).toBeLessThan(text.indexOf('"B"'));
    expect(text).toContain('standards: "v0.6.0"');
  });
});

describe("readStampTag", () => {
  it("extracts the tag from the stamp comment", () => {
    expect(readStampTag(STAMPED)).toBe("v0.4.2");
    expect(readStampTag("# CLAUDE.md\n")).toBeNull();
  });
});

describe("resolveBaseTag", () => {
  // 22
  it("prefers vars over the stamp and reports the mismatch", () => {
    const root = fixture();
    write(root, VARS_FILENAME, 'standards: "v0.5.1"\n');
    writeFileSync(join(root, "CLAUDE.md"), STAMPED);
    expect(resolveBaseTag(root)).toEqual({ tag: "v0.5.1", from: "vars", stampTag: "v0.4.2" });
  });

  it("does not report a mismatch when both agree", () => {
    const root = fixture();
    write(root, VARS_FILENAME, 'standards: "v0.4.2"\n');
    writeFileSync(join(root, "CLAUDE.md"), STAMPED);
    expect(resolveBaseTag(root)).toEqual({ tag: "v0.4.2", from: "vars" });
  });

  it("falls back to the CLAUDE.md stamp when vars is absent", () => {
    const root = fixture();
    writeFileSync(join(root, "CLAUDE.md"), STAMPED);
    expect(resolveBaseTag(root)).toEqual({ tag: "v0.4.2", from: "stamp" });
  });

  it("returns null when neither vars nor a stamp exists", () => {
    expect(resolveBaseTag(fixture())).toBeNull();
  });
});

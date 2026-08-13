/** ポリシースキーマ検証(旧 validate.ts のアサーションを移行) */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { parsePolicy } from "../src/schema.js";
import { REPO_ROOT } from "./helpers.js";

const bad = (over: object) => parsePolicy({ version: 1, target: "claude-code", ...over });

describe("policy schema", () => {
  it("parses presets/baseline.yaml", () => {
    const doc = parse(readFileSync(resolve(REPO_ROOT, "presets/baseline.yaml"), "utf8"));
    const r = parsePolicy(doc);
    expect(r.ok, r.ok ? "" : r.errors.join("; ")).toBe(true);
    if (r.ok) expect(r.policy.rules.length).toBeGreaterThan(0);
  });

  it("rejects unknown check", () => {
    expect(bad({ rules: [{ id: "a/b", severity: "error", check: "nope", with: {} }] }).ok).toBe(
      false,
    );
  });

  it("rejects bad rule id", () => {
    expect(
      bad({
        rules: [
          { id: "BadId", severity: "error", check: "max-lines", with: { path: "x", limit: 1 } },
        ],
      }).ok,
    ).toBe(false);
  });

  it("rejects unpinned remote extends", () => {
    expect(bad({ extends: ["github:novexar/claude-standards"] }).ok).toBe(false);
  });

  it("rejects content-match without must/must_not", () => {
    expect(
      bad({
        rules: [{ id: "a/b", severity: "error", check: "content-match", with: { path: "x" } }],
      }).ok,
    ).toBe(false);
  });

  it("rejects exemption without expires", () => {
    expect(bad({ exemptions: [{ rule: "a/b", reason: "x", approved_by: "tech-lead" }] }).ok).toBe(
      false,
    );
  });

  it("rejects duplicate rule ids", () => {
    expect(
      bad({
        rules: [
          { id: "a/b", severity: "error", check: "max-lines", with: { path: "x", limit: 1 } },
          { id: "a/b", severity: "warn", check: "max-lines", with: { path: "y", limit: 2 } },
        ],
      }).ok,
    ).toBe(false);
  });

  it("rejects typo key (strict)", () => {
    expect(
      bad({
        rules: [
          { id: "a/b", severity: "error", check: "max-lines", with: { path: "x", limits: 1 } },
        ],
      }).ok,
    ).toBe(false);
  });

  it("accepts pinned github extends and file drift source", () => {
    const r = bad({
      extends: ["github:novexar/guardsmith//presets/baseline.yaml@v0.1.0"],
      rules: [
        {
          id: "a/b",
          severity: "warn",
          check: "drift",
          with: { source: "file:./master", paths: ["x/**"] },
        },
      ],
    });
    expect(r.ok).toBe(true);
  });
});

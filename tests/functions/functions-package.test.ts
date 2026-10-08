// @vitest-environment node
// Security gate (PR #6 hardening): the Functions source archive that the
// repo-pinned firebase-tools would upload must never contain local secret
// files (functions/.secret.local) nor node_modules. Packaging is local-only.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Functions deploy package", () => {
  it("firebase.json declara functions.ignore con los defaults oficiales y .secret.local", () => {
    const cfg = JSON.parse(readFileSync("firebase.json", "utf8"));
    expect(cfg.functions.ignore).toEqual(
      expect.arrayContaining(["node_modules", ".git", "firebase-debug.log", "firebase-debug.*.log", "*.local", ".secret.local"]),
    );
  });

  it("el archivo que prepararía firebase-tools no incluye secretos locales y sí todo el código", () => {
    const out = execFileSync("node", ["scripts/verify-functions-package.mjs"], { encoding: "utf8" });
    expect(out).toContain("forbidden entries: none");
    expect(out).toContain("missing required: none");
    expect(out).toContain("RESULT: PASS");
  }, 60_000);
});

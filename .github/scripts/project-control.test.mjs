
import test from "node:test";
import assert from "node:assert/strict";
import { replaceBlock, normalize, buildBlock } from "./project-control.mjs";

test("preserva texto humano y reemplaza solo AUTO", () => {
  const a = replaceBlock("HUMANO", "AUTO");
  const b = replaceBlock(a, "AUTO2");
  assert.match(b, /^HUMANO/);
  assert.match(b, /AUTO2/);
  assert.doesNotMatch(b, /\nAUTO\n/);
});

test("normalización ignora metadata de auditoría", () => {
  const a = "- **Sync:** A\n- **Consistencia:** A\n- **Motivo:** A\n- **HEAD:** abc";
  const b = "- **Sync:** B\n- **Consistencia:** B\n- **Motivo:** B\n- **HEAD:** abc";
  assert.equal(normalize(a), normalize(b));
});

test("bloque es factual y no decide roadmap", () => {
  const block = buildBlock({
    branch: "main",
    headSha: "abcdef123",
    headMessage: "fix",
    actionStatus: "CI · SUCCESS",
    openPulls: [{ number: 4, draft: true }],
    latestMerged: { number: 3, title: "merge" }
  }, { syncedAt: "x", consistency: "✅ ALINEADO", reason: "manual" });
  assert.match(block, /abcdef1/);
  assert.match(block, /#4 draft/);
  assert.doesNotMatch(block, /prioridad|roadmap|debe mergear|deploy/i);
});

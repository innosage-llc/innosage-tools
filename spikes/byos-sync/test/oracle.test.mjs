import test from "node:test";
import assert from "node:assert/strict";
import { intentOracle } from "../src/oracle.mjs";
const a = { body: "intent-A", editIds: ["intent-A"] },
  b = { body: "intent-B", editIds: ["intent-B"] };
test("equal LWW replicas do not imply intent preservation", () => {
  const r = intentOracle(["intent-A", "intent-B"], [[a], [a]]);
  assert.equal(r.silent_lost_edit_count, 1);
  assert.equal(r.intent_preservation_rate, 0.5);
});
test("unpropagated durable intent is not silently lost", () => {
  const r = intentOracle(["intent-A", "intent-B"], [[a, b], [a]]);
  assert.equal(r.silent_lost_edit_count, 0);
  assert.equal(r.durable_unpropagated_count, 1);
});
test("redacted journal IDs are not recoverable conflict bodies", () => {
  assert.equal(
    intentOracle(["intent-B"], [[a], [a]], [[{ id: "intent-B" }]])
      .durably_preserved_conflict_count,
    0,
  );
  assert.equal(
    intentOracle(["intent-B"], [[a], [a]], [[{ local: b }]])
      .durably_preserved_conflict_count,
    1,
  );
});
test("IDs without matching content and duplicate expected IDs cannot inflate preservation", () => {
  const r = intentOracle(
    ["intent-A", "intent-A"],
    [[{ body: "lost", editIds: ["intent-A"] }]],
  );
  assert.equal(r.acknowledged_edit_count, 1);
  assert.equal(r.silent_lost_edit_count, 1);
});

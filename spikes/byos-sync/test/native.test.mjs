import test from "node:test";
import assert from "node:assert/strict";
import { trial } from "../src/trial.mjs";
for (const [engine, provider] of [
  ["rxdb", "drive"],
  ["selfstore", "drive"],
  ["selfstore", "webdav"],
])
  test(`${engine}/${provider} native initial + incremental + persistent reopen`, async () => {
    const r = await trial({
      engine,
      provider,
      scenario: "single-edit",
      scale: 10,
      seed: 7,
    });
    assert.equal(r.status, "PASS", JSON.stringify(r.error));
    assert.equal(r.merged_or_applied_count, 1);
    assert.equal(r.unsupported.length, 0);
  });
for (const [engine, provider] of [
  ["rxdb", "drive"],
  ["selfstore", "drive"],
  ["selfstore", "webdav"],
])
  test(`${engine}/${provider} oracle detects native same-page loss after reopen`, async () => {
    const r = await trial({
      engine,
      provider,
      scenario: "same-page",
      scale: 10,
      seed: 84,
    });
    assert.equal(r.status, "FAIL");
    assert.equal(r.acknowledged_edit_count, 2);
    assert.equal(r.silent_lost_edit_count, 1);
    assert.equal(r.durably_preserved_conflict_count, 0);
  });
test("RxDB equal-time checkpoint stalls without calling durable local edits lost", async () => {
  const r = await trial({
    engine: "rxdb",
    scenario: "same-time-boundary",
    scale: 30,
    seed: 84,
  });
  assert.equal(r.status, "FAIL");
  assert.equal(r.merged_or_applied_count, 16);
  assert.equal(r.durable_unpropagated_count, 14);
  assert.equal(r.silent_lost_edit_count, 0);
});
for (const scenario of ["fault-unknown-success", "fault-wal-unknown-success"])
  test(`native RxDB ${scenario} exercises payload not lease`, async () => {
    const r = await trial({
      engine: "rxdb",
      provider: "drive",
      scenario,
      scale: 10,
      seed: 7,
    });
    const f = r.faults[0];
    assert.equal(f.used, true);
    assert.equal(f.matched.file_name, f.fileName);
    assert.notEqual(f.matched.file_name, "transaction.json");
    assert.equal(f.matched.mutation_applied, true);
    assert.equal(f.matched.stored_body_matches_request, true);
    assert.equal(f.matched.response_delivered, false);
    assert.equal(r.status, "PASS");
    assert.equal(r.recovered_within_bounded_test_count, 1);
  });

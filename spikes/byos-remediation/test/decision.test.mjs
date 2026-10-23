import test from "node:test";
import assert from "node:assert/strict";
import { diagnosticCells, distribution, loadLatest } from "../src/decision.mjs";
import { digest } from "../src/evidence.mjs";

test("nearest-rank percentiles reject empty, missing and nonfinite values", () => {
  assert.deepEqual(distribution(Array.from({ length: 30 }, (_, i) => 30 - i)), { n: 30, p50: 15, p95: 29, min: 1, max: 30 });
  for (const values of [[], [undefined], [NaN], [Infinity], [-1]]) assert.throws(() => distribution(values));
});
test("latest failure, corrupt evidence and changed runtime cannot reuse a PASS", async () => {
  const manifest = Object.fromEntries(["package.json", "package-lock.json", "src/protocol.mjs", "src/store.mjs", "src/revisions.mjs", "src/hierarchy.mjs", "../byos-sync/src/mock.mjs"].map((p) => [p, digest(p)]));
  const sourceDigest = digest(JSON.stringify(manifest));
  const data = Buffer.from(JSON.stringify({ id: "A4", result: "PASS", source: { sourceDigest, manifest }, output: { passed: true } }));
  const pass = { attempt: "A4", result: "PASS", evidence: "fixture", evidenceSha256: digest(data), sourceDigest };
  const load = async () => data, current = async (p) => p;
  assert.equal((await loadLatest([pass], "A4", load, current)).proof.result, "PASS");
  for (const [records, loader, runtime] of [
    [[pass, { ...pass, result: "FAIL" }], load, current],
    [[pass], async () => Buffer.from("altered"), current],
    [[pass], load, async () => "new runtime"],
    [[], load, current],
  ]) assert.equal((await loadLatest(records, "A4", loader, runtime)).proof.result, "NOT_ACCEPTED");
});
function fixture() {
  const results = [], proofs = [{ id: "A5", evidenceSha256: "safety" }, { id: "A6", evidenceSha256: "browser" }];
  for (const provider of ["drive", "webdav"]) for (const scale of [10, 1000]) for (let seed = 1; seed <= 30; seed++) {
    const phase = { elapsedMs: seed, harnessCpuMs: 1, requests: 2, bytesUp: 10, bytesDown: 20, userBodyBytes: 5, transferAmplification: 6, endpoints: { "GET /fixture": 2 } };
    results.push({ provider, scale, seed, fixtureDigest: `${scale}:${seed}`, status: "PASS", silentLostEditCount: 0, falseStateCount: 0, acknowledgedEditCount: 3, appliedOrDurablyRecoverableEditCount: 3, expectedDigest: "full", remoteDigest: "full", observations: [{}], phases: { cold: { ...phase }, incremental: { ...phase }, reconnect: { ...phase } }, mergedOrAppliedCount: 1, durableManualConflictCount: 2, autoMergedCount: 0, localInitializationMs: 1, coldSecondDeviceHydrationMs: 2, conflictDetectionMs: 3, runtimeMs: 4, harnessCpuMs: 2, coldRemoteBytes: 5, finalRemoteBytes: 6 });
  }
  return { output: { passed: true, pairedFixturesVerified: true, results, safetyProofs: { A5: { evidenceSha256: "safety" }, A6: { evidenceSha256: "browser" } } }, proofs };
}
test("normal diagnostics require 30 unique paired successful trials and current safety receipts", () => {
  const f = fixture(); const cells = diagnosticCells(f.output, f.proofs);
  assert.equal(cells.length, 4); assert.equal(cells[0].acknowledgedEdits, 90); assert.equal(cells[0].durableManualConflictEdits, 60);
  for (const mutate of [
    (o) => o.results.pop(),
    (o) => { o.results[0].status = "TIMEOUT"; },
    (o) => { o.results[0].seed = 2; },
    (o) => { o.results[0].fixtureDigest = "different"; },
    (o) => { o.results[0].falseStateCount = 1; },
    (o) => { o.results[0].phases.cold.elapsedMs = NaN; },
    (o) => { o.safetyProofs.A6.evidenceSha256 = "stale"; },
  ]) { const g = fixture(); mutate(g.output); assert.throws(() => diagnosticCells(g.output, g.proofs)); }
});

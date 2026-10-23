import test from "node:test";
import assert from "node:assert/strict";
import { safetyCoverage, buildReport } from "../src/report.mjs";
import { digest } from "../src/evidence.mjs";

function trials(distinct = true) {
  let serial = 0;
  return ["drive", "webdav"].flatMap((provider) =>
    [10, 1000].flatMap((scale) =>
      Array.from({ length: 25 }, (_, i) => ({
        provider, scale, seed: distinct ? ++serial : i + 1, status: "PASS",
      })),
    ),
  );
}

test("100 passing combinations with 25 seeds cannot satisfy the 100-seed requirement", () => {
  const result = safetyCoverage({ passed: true, results: trials(false) });
  assert.equal(result.trialCount, 100);
  assert.equal(result.passedTrials, 100);
  assert.equal(result.distinctCombinations, 100);
  assert.equal(result.distinctSeeds, 25);
  assert.equal(result.seedCoverageMet, false);
  assert.equal(result.fullR5Acceptance, false);
});

test("100 distinct seeds meet only seed coverage, leaving other R5 gates separate", () => {
  const result = safetyCoverage({ passed: true, results: trials() });
  assert.equal(result.distinctSeeds, 100);
  assert.equal(result.seedCoverageMet, true);
  assert.equal(result.fullR5Acceptance, false);
});

test("duplicates, failures, invalid identities and missing scale/provider cells fail closed", () => {
  const samples = [
    [...trials(), trials()[0]],
    trials().map((r, i) => i === 0 ? { ...r, status: "FAIL" } : r),
    trials().map((r, i) => i === 0 ? { ...r, seed: "1000" } : r),
    trials().map((r) => ({ ...r, provider: "drive" })),
    [],
  ];
  for (const results of samples) {
    assert.equal(safetyCoverage({ passed: true, results }).seedCoverageMet, false);
  }
  assert.equal(safetyCoverage({ passed: false, results: trials() }).seedCoverageMet, false);
  assert.equal(safetyCoverage(null).seedCoverageMet, false);
});

function inversion(provider) {
  return { provider, passed: true, receipts: [
    { operation: 1, method: "GET", status: 200, deliveryOrder: 4, capturedEtag: '"v1"', capturedBodySha256: "a".repeat(64) },
    { operation: 2, method: "GET", status: 200, deliveryOrder: 1, capturedEtag: '"v1"', capturedBodySha256: "a".repeat(64) },
  ], requests: [{ status: 412, if_match: '"v1"' }] };
}
test("inversion credit requires successful coherent GETs and explicit strong conditional validation", () => {
  const baseline = [inversion("drive"), inversion("webdav")];
  assert.equal(safetyCoverage({ inversions: baseline }).inversionVerified, true);
  for (const etag of [undefined, null, 'W/"v1"', "v1", ""]) {
    const rows = structuredClone(baseline);
    for (const r of rows) {
      for (const receipt of r.receipts) receipt.capturedEtag = etag;
      r.requests[0].if_match = etag;
    }
    assert.equal(safetyCoverage({ inversions: rows }).inversionVerified, false);
  }
  for (const mutate of [
    (r) => { r.receipts[0].status = 503; },
    (r) => { r.receipts[1].status = 401; },
    (r) => { delete r.requests[0].if_match; },
    (r) => { r.receipts[1].deliveryOrder = 0; },
  ]) {
    const rows = structuredClone(baseline); mutate(rows[0]);
    assert.equal(safetyCoverage({ inversions: rows }).inversionVerified, false);
  }
});

async function reportWithA5(sourceDigest, result = "PASS") {
  const records = [], files = new Map();
  for (const attempt of ["A1", "A2", "A3", "A5"]) {
    const source = attempt === "A5" ? sourceDigest : "b".repeat(64);
    const recordedResult = attempt === "A5" ? result : "PASS";
    const output = attempt === "A5" ? { passed: true, results: trials() }
      : { results: [{ requests: [] }], stateObservationCount: 2, falseStateCount: 0 };
    const bytes = Buffer.from(JSON.stringify({ id: attempt, result: recordedResult, source: { sourceDigest: source }, output }));
    const evidence = `fixture/${attempt}.json`; files.set(evidence, bytes);
    records.push({ attempt, result: recordedResult, sourceDigest: source, evidence, evidenceSha256: digest(bytes) });
  }
  return buildReport(records, async (file) => files.get(file));
}
test("A5 missing or malformed provenance cannot compare equal and admit coverage", async () => {
  for (const source of [undefined, null, "short", "G".repeat(64)]) {
    const report = await reportWithA5(source);
    assert.equal(report.summary.safetyCoverage.status, "INVALID_EVIDENCE");
    assert.equal(report.summary.safetyCoverage.seedCoverageMet, false);
  }
});
test("non-PASS A5 cannot retain a seed-coverage-met status", async () => {
  const report = await reportWithA5("c".repeat(64), "FAIL");
  assert.equal(report.summary.safetyCoverage.status, "RECORDED_RUN_NOT_PASS");
  assert.equal(report.summary.safetyCoverage.seedCoverageMet, false);
});

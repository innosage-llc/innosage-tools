import test from "node:test";
import assert from "node:assert/strict";
import { buildReport } from "../src/report.mjs";
import { digest } from "../src/evidence.mjs";

function fixture() {
  const records = [],
    files = new Map();
  const append = (attempt, result = "PASS", output) => {
    const sourceDigest = digest(`source:${attempt}:${records.length}`);
    const evidence = `fixture/${attempt}-${records.length}.json`;
    const data = {
      id: attempt,
      result,
      source: { sourceDigest },
      output:
        output ??
        (attempt === "A3" && result === "PASS"
          ? {
              results: [{ requests: [{ method: "GET", path: "/fixture" }] }],
              stateObservationCount: 2,
              falseStateCount: 0,
            }
          : { synthetic: true }),
    };
    const bytes = Buffer.from(JSON.stringify(data));
    const record = {
      attempt,
      result,
      sourceDigest,
      evidence,
      evidenceSha256: digest(bytes),
    };
    files.set(evidence, bytes);
    records.push(record);
    return record;
  };
  for (const id of ["A1", "A2", "A3"]) append(id);
  const load = async (file) => {
    if (!files.has(file))
      throw Object.assign(new Error("Fixture evidence not found"), {
        code: "ENOENT",
      });
    return files.get(file);
  };
  return { records, files, append, report: () => buildReport(records, load) };
}
function assertNotPassing(report) {
  assert.equal(report.summary.foundationPass, false);
  assert.equal(report.summary.status, "FOUNDATION_NOT_PASS");
  assert.match(report.overview, /Foundation acceptance is NOT PASS/);
  assert.match(report.scorecard, /Foundation acceptance is NOT PASS/);
  assert.doesNotMatch(report.overview, /passes all required focused/);
}

test("report admits only latest hash-verified PASS for every required witness", async () => {
  const f = fixture();
  const report = await f.report();
  assert.equal(report.summary.foundationPass, true);
  assert.equal(report.summary.current.length, 3);
  assert.equal(report.summary.a3.stateObservations, 2);
  assert.match(
    report.overview,
    /Latest hash-verified evidence passes all required/,
  );
  assert.equal(report.summary.responseOrderInversion, "NOT_RUN");
  assert.match(report.overview, /only a single sequential GET delayed 250 ms/);
});
for (const id of ["A1", "A2", "A3"])
  test(`later ${id} FAIL supersedes earlier PASS without fallback`, async () => {
    const f = fixture();
    f.append(id, "FAIL");
    const report = await f.report();
    assertNotPassing(report);
    assert.equal(
      report.summary.current.find((r) => r.attempt === id).result,
      "FAIL",
    );
    assert.equal(
      report.summary.historicalPasses.filter((r) => r.attempt === id).length,
      1,
    );
    assert.match(report.scorecard, /Recorded historical PASS/);
    if (id === "A3") {
      assert.equal(report.summary.a3.status, "UNAVAILABLE_FROM_LATEST_A3");
      assert.equal(report.summary.a3.stateObservations, undefined);
    }
  });
for (const result of ["BLOCKED", "TIMEOUT", "NOT_RUN"])
  test(`latest A3 ${result} cannot reuse earlier successful metrics`, async () => {
    const f = fixture();
    f.append("A3", result);
    const report = await f.report();
    assertNotPassing(report);
    assert.equal(report.summary.current[2].result, result);
    assert.equal(report.summary.a3.status, "UNAVAILABLE_FROM_LATEST_A3");
  });
for (const id of ["A1", "A2"])
  test(`missing ${id} blocks foundation even with a valid A3 PASS`, async () => {
    const f = fixture();
    f.records.splice(
      f.records.findIndex((r) => r.attempt === id),
      1,
    );
    const report = await f.report();
    assertNotPassing(report);
    assert.equal(
      report.summary.current.find((r) => r.attempt === id).result,
      "MISSING",
    );
  });
for (const condition of [
  "missing-file",
  "hash-mismatch",
  "invalid-json",
  "envelope-mismatch",
])
  test(`latest evidence ${condition} fails closed and cannot expose previous A3 metrics`, async () => {
    const f = fixture();
    const latest = f.append("A3");
    if (condition === "missing-file") f.files.delete(latest.evidence);
    if (condition === "hash-mismatch")
      f.files.set(latest.evidence, Buffer.from("different bytes"));
    if (condition === "invalid-json") {
      const bytes = Buffer.from("not JSON");
      f.files.set(latest.evidence, bytes);
      latest.evidenceSha256 = digest(bytes);
    }
    if (condition === "envelope-mismatch") {
      const data = JSON.parse(f.files.get(latest.evidence));
      data.result = "FAIL";
      const bytes = Buffer.from(JSON.stringify(data));
      f.files.set(latest.evidence, bytes);
      latest.evidenceSha256 = digest(bytes);
    }
    const report = await f.report();
    assertNotPassing(report);
    assert.equal(report.summary.current[2].result, "INVALID_EVIDENCE");
    assert.equal(report.summary.a3.status, "UNAVAILABLE_FROM_LATEST_A3");
    assert.equal(report.summary.historicalPasses.length, 1);
  });
test("PASS label cannot conceal absent metrics or observed false states", async () => {
  for (const output of [
    {},
    {
      results: [{ requests: [] }],
      stateObservationCount: 2,
      falseStateCount: 1,
    },
  ]) {
    const f = fixture();
    f.append("A3", "PASS", output);
    const report = await f.report();
    assertNotPassing(report);
    assert.equal(report.summary.current[2].result, "INVALID_EVIDENCE");
    assert.equal(report.summary.a3.status, "UNAVAILABLE_FROM_LATEST_A3");
  }
});

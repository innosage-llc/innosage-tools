import assert from "node:assert/strict";
import { digest } from "./evidence.mjs";

const providers = ["drive", "webdav"], scales = [10, 1000];
const core = ["package.json", "package-lock.json", "src/protocol.mjs", "src/store.mjs", "src/revisions.mjs", "../byos-sync/src/mock.mjs"];
const runtime = {
  A4: [...core, "src/hierarchy.mjs"],
  A5: [...core, "src/safety.mjs", "src/trial-schedule.mjs", "src/matrix.mjs", "src/test-support.mjs"],
  A6: [...core, "src/browser.mjs", "src/browser-entry.mjs", "src/matrix.mjs"],
  A7: [...core, "src/diagnostics.mjs", "src/matrix.mjs", "src/test-support.mjs"],
};
const sum = (rows, key) => rows.reduce((n, r) => n + r[key], 0);
const finite = (x) => typeof x === "number" && Number.isFinite(x) && x >= 0;
const noFalse = (rows) => rows.every((r) => Array.isArray(r.observations) && r.observations.length > 0 && r.observations.every((o) => !o.falseLocal && !o.falseVerified && !o.falsePending));
export function distribution(values) {
  assert.ok(values.length > 0 && values.every(finite), "Invalid measurement sample");
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q) => sorted[Math.ceil(q * sorted.length) - 1];
  return { n: sorted.length, p50: at(0.5), p95: at(0.95), min: sorted[0], max: sorted.at(-1) };
}

// The latest attempt always wins, including a failed or invalid attempt. Runtime
// equivalence is per executed dependency; report-only edits do not forge a new run.
export async function loadLatest(records, id, load, currentFile) {
  const record = records.findLast((r) => r.attempt === id);
  const proof = { id, result: record?.result ?? "MISSING", evidence: record?.evidence, evidenceSha256: record?.evidenceSha256, sourceDigest: record?.sourceDigest };
  try {
    assert.ok(record, `Missing ${id}`);
    assert.equal(record.result, "PASS", `Latest ${id} is ${record.result}`);
    const bytes = await load(record.evidence);
    assert.equal(digest(bytes), record.evidenceSha256, "Evidence hash mismatch");
    const data = JSON.parse(bytes.toString());
    assert.equal(data.id, id); assert.equal(data.result, "PASS"); assert.equal(data.output.passed, true);
    assert.equal(data.source.sourceDigest, record.sourceDigest);
    assert.equal(digest(JSON.stringify(data.source.manifest)), record.sourceDigest, "Source manifest digest mismatch");
    for (const file of runtime[id]) {
      assert.equal(digest(await currentFile(file)), data.source.manifest[file], `Executed runtime changed: ${id} ${file}`);
    }
    proof.hashVerified = true; proof.runtimeEquivalent = true;
    return { proof, output: data.output };
  } catch (error) { proof.result = "NOT_ACCEPTED"; proof.reason = error.message; return { proof }; }
}

export function validateSafety(a4, a5, a6, coverage) {
  assert.ok(a4?.passed && a4.results.length === 2 && a4.results.every((r) => r.passed), "A4 recovery visibility missing");
  assert.ok(a5?.passed && coverage.seedCoverageMet && coverage.inversionVerified, "A5 seed/inversion coverage incomplete");
  assert.equal(a5.results.length, 100);
  assert.ok(a5.results.every((r) => r.status === "PASS" && r.lostIntentCount === 0 && r.falseStateCount === 0 && r.appliedIntentCount === r.intentCount && finite(r.stableRecoveryMs) && r.stableRecoveryMs < 16000));
  assert.ok(noFalse(a5.results));
  assert.ok(a5.causal?.passed && a5.causal.causalCycleRejected, "Causal validation missing");
  assert.equal(a5.lifecycle?.length, 2); assert.ok(providers.every((p) => a5.lifecycle.some((r) => r.provider === p && r.passed)));
  for (const provider of providers) for (const scale of scales) {
    const rows = a5.results.filter((r) => r.provider === provider && r.scale === scale);
    assert.equal(rows.length, 25);
    assert.equal(new Set(rows.map((r) => r.scenario)).size, 4);
    assert.equal(new Set(rows.map((r) => r.fault)).size, 7);
  }
  const boundaries = ["after-local-ack", "before-remote-mutation", "after-mutation-before-response", "after-write-response", "before-receipt", "after-receipt"];
  assert.ok(a6?.passed && a6.results.length === 12 && noFalse(a6.results), "Browser matrix incomplete");
  for (const provider of providers) for (const boundary of boundaries) {
    const rows = a6.results.filter((r) => r.provider === provider && r.boundary === boundary);
    assert.equal(rows.length, 1); const r = rows[0];
    assert.ok(r.status === "PASS" && r.rendererCrashed && r.storageProof?.factory === "IDBFactory" && r.storageProof.nativeOpen && r.falseStateCount === 0 && r.acknowledgedEditCount === r.recoveredEditCount && r.externalRequestsBlocked.length === 0);
    if (boundary !== "after-local-ack") {
      assert.ok(r.faultReceipt?.used);
      assert.equal(r.faultReceipt.matched.mutation_applied, boundary !== "before-remote-mutation");
      assert.equal(r.faultReceipt.matched.response_delivered, !["before-remote-mutation", "after-mutation-before-response"].includes(boundary));
    }
    if (["after-write-response", "before-receipt", "after-receipt"].includes(boundary)) assert.equal(r.browserBarrier?.point, boundary);
  }
  return {
    seededTrials: a5.results.length, distinctSeeds: new Set(a5.results.map((r) => r.seed)).size,
    acknowledgedEdits: sum(a5.results, "intentCount"), preservedFullEdits: sum(a5.results, "appliedIntentCount"), lostEdits: sum(a5.results, "lostIntentCount"),
    sampledStates: sum(a5.results.map((r) => ({ n: r.observations.length })), "n"), falseStates: sum(a5.results, "falseStateCount"),
    stableRecoveryMs: distribution(a5.results.map((r) => r.stableRecoveryMs)), rendererCases: a6.results.length,
    rendererAcknowledgedEdits: sum(a6.results, "acknowledgedEditCount"), rendererRecoveredEdits: sum(a6.results, "recoveredEditCount"),
    rendererSampledStates: sum(a6.results.map((r) => ({ n: r.observations.length })), "n"), rendererFalseStates: sum(a6.results, "falseStateCount"),
    rendererRecoveryMs: distribution(a6.results.map((r) => r.stableRecoveryMs)), inversionProviders: 2, lifecycleProviders: 2,
  };
}

export function diagnosticCells(output, proofs) {
  assert.ok(output?.passed && output.pairedFixturesVerified && output.results.length === 120, "Diagnostics incomplete");
  for (const id of ["A5", "A6"]) assert.equal(output.safetyProofs?.[id]?.evidenceSha256, proofs.find((p) => p.id === id)?.evidenceSha256, `Diagnostic safety proof is stale: ${id}`);
  const cells = [];
  for (const provider of providers) for (const scale of scales) {
    const rows = output.results.filter((r) => r.provider === provider && r.scale === scale);
    assert.equal(rows.length, 30); assert.equal(new Set(rows.map((r) => r.seed)).size, 30);
    assert.ok(rows.every((r) => r.status === "PASS" && r.silentLostEditCount === 0 && r.falseStateCount === 0 && r.acknowledgedEditCount === r.appliedOrDurablyRecoverableEditCount && r.expectedDigest === r.remoteDigest));
    assert.ok(noFalse(rows));
    for (const r of rows) {
      const partner = output.results.find((p) => p.provider !== provider && p.scale === scale && p.seed === r.seed);
      assert.ok(partner && partner.fixtureDigest === r.fixtureDigest, "Unpaired normal fixture");
    }
    const phases = {};
    for (const name of ["cold", "incremental", "reconnect"]) {
      for (const row of rows) {
        const phase = row.phases[name];
        assert.ok(phase && [phase.elapsedMs, phase.harnessCpuMs, phase.requests, phase.bytesUp, phase.bytesDown].every(finite));
        if (name !== "cold") assert.ok(finite(phase.transferAmplification) && phase.userBodyBytes > 0);
      }
      const endpoints = {};
      for (const row of rows) for (const [key, count] of Object.entries(row.phases[name].endpoints)) endpoints[key] = (endpoints[key] ?? 0) + count;
      phases[name] = { elapsedMs: distribution(rows.map((r) => r.phases[name].elapsedMs)), harnessCpuMs: distribution(rows.map((r) => r.phases[name].harnessCpuMs)), requests: distribution(rows.map((r) => r.phases[name].requests)), bytesUp: distribution(rows.map((r) => r.phases[name].bytesUp)), bytesDown: distribution(rows.map((r) => r.phases[name].bytesDown)), amplification: name === "cold" ? null : distribution(rows.map((r) => r.phases[name].transferAmplification)), endpoints, quotaUnits: provider === "drive" ? "UNKNOWN_MEDIA_METHOD_WEIGHTS" : "NOT_APPLICABLE" };
    }
    cells.push({ provider, scale, trials: 30, failures: 0, timeouts: 0, acknowledgedEdits: sum(rows, "acknowledgedEditCount"), appliedEdits: sum(rows, "mergedOrAppliedCount"), durableManualConflictEdits: sum(rows, "durableManualConflictCount"), autoMergedEdits: sum(rows, "autoMergedCount"), lostEdits: sum(rows, "silentLostEditCount"), falseStates: sum(rows, "falseStateCount"), phases, localInitializationMs: distribution(rows.map((r) => r.localInitializationMs)), coldHydrationMs: distribution(rows.map((r) => r.coldSecondDeviceHydrationMs)), conflictDetectionMs: distribution(rows.map((r) => r.conflictDetectionMs)), runtimeMs: distribution(rows.map((r) => r.runtimeMs)), harnessCpuMs: distribution(rows.map((r) => r.harnessCpuMs)), coldRemoteBytes: distribution(rows.map((r) => r.coldRemoteBytes)), finalRemoteBytes: distribution(rows.map((r) => r.finalRemoteBytes)) });
  }
  return cells;
}

export async function buildDecision(records, load, currentFile, foundation) {
  const stages = await Promise.all(["A4", "A5", "A6", "A7"].map((id) => loadLatest(records, id, load, currentFile)));
  const proofs = stages.map((s) => s.proof), gaps = [];
  let safety, cells;
  try {
    assert.equal(foundation.foundationPass, true, "Foundation not accepted");
    assert.ok(stages.slice(0, 3).every((s) => s.output), "Missing valid safety stage");
    safety = validateSafety(...stages.slice(0, 3).map((s) => s.output), foundation.safetyCoverage);
  } catch (e) { gaps.push(e.message); }
  if (safety) {
    try { cells = diagnosticCells(stages[3].output, proofs); } catch (e) { gaps.push(e.message); }
  } else gaps.push("Latency comparison ineligible before hard safety gates");
  const passed = Boolean(safety && cells && gaps.length === 0);
  const decision = passed ? "OFFLINE_CANDIDATE_PASSES_ENGINEERING_EVIDENCE" : "HOLD_INCOMPLETE_EVIDENCE";
  const summary = { decision, passed, safety, cells, proofs, gaps, definitions: stages[3].output?.definitions, historicalAttempts: records.map(({ attempt, kind, result, evidence, evidenceSha256, sourceDigest }) => ({ attempt, kind, result, evidence, evidenceSha256, sourceDigest })), baseline: foundation.baselineCommit, baselineVerdict: "NO_SAFE_WINNER_UNCHANGED", reviewAndIntegration: "See final exact-head review/native-CI/merged-PR acceptance packet; data evidence is not independent approval", deployment: "NOT_AUTHORIZED_NOT_RUN" };
  const pair = (d) => `${d.p50.toFixed(1)} / ${d.p95.toFixed(1)}`;
  const table = cells?.map((c) => `| ${c.provider} | ${c.scale} | ${c.trials} | ${pair(c.phases.cold.elapsedMs)} | ${pair(c.phases.incremental.elapsedMs)} | ${pair(c.phases.reconnect.elapsedMs)} | ${pair(c.phases.incremental.amplification)} | ${c.lostEdits} / ${c.falseStates} |`).join("\n") ?? "| — | — | — | INELIGIBLE | INELIGIBLE | INELIGIBLE | — | — |";
  const proofTable = proofs.map((p) => `| ${p.id} | ${p.result} | [raw](${p.evidence?.replace("spikes/byos-remediation/", "") ?? "evidence/decision-summary.json"}) | ${p.reason ?? p.evidenceSha256} |`).join("\n");
  const outcome = passed ? "A bounded custom immutable-revision/CAS prototype resolves the three original blockers under the documented offline transport contract. RECOMMEND FOR REAL-PROVIDER VALIDATION after Founder offline acceptance and separate live-test authority. The next separately authorized smoke must verify coherent complete GET/strongETag/atomicIf-Match, competing412/full-body recovery, browserCORS and scoped authentication in a disposable namespace. Real-provider feasibility remains UNKNOWN; this is not production adoption or deployment approval. Snapshot amplification makes this a correctness reference, not an efficiency winner or a scalable production architecture." : `Do not accept or rank the candidate: ${gaps.join("; ")}.`;
  const numeric = safety ? `${safety.seededTrials} safety trials / ${safety.distinctSeeds} distinct seeds: ${safety.preservedFullEdits}/${safety.acknowledgedEdits} acknowledged complete edits preserved, ${safety.lostEdits} lost, ${safety.falseStates}/${safety.sampledStates} false sampled states. Recovery after stable transport: p50/p95 ${pair(safety.stableRecoveryMs)} ms, maximum ${safety.stableRecoveryMs.max.toFixed(1)} ms (declared bound16000ms). Actual response delivery inversion and lifecycle/manual resolution pass on both providers. Real Chromium native IndexedDB renderer crashes: ${safety.rendererCases}/12, ${safety.rendererRecoveredEdits}/${safety.rendererAcknowledgedEdits} edits recovered, ${safety.rendererFalseStates}/${safety.rendererSampledStates} false sampled states.` : "Hard safety gate is incomplete.";
  const scorecard = `# Offline remediation decision\n\n**${decision}**\n\n${outcome}\n\n${numeric}\n\nNormal-network diagnostics use30 paired trials per provider/scale; p50 / p95 below use nearest-rank, include settlement inspection, and are synthetic loopback measurements (8ms RTT,2ms jitter). Failed/censored rows are retained and disable percentile eligibility.\n\n| Mock provider | Pages | n | Cold ms | Incremental ms | Reconnect/conflict ms | Incremental body-byte amplification | Lost / false |\n| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |\n${table}\n\nThe [machine scorecard](evidence/decision-summary.json) includes all three phases' requests/methods, uploaded/downloaded body bytes, amplification, cold hydration/local initialization, CPU, runtime, remote object footprint, exact source/evidence hashes and historical attempts. Each successful normal trial acknowledges3 edits:1 applied and2 retained as durable manual conflict heads;0 automatic merges. Manual conflicts require explicit user resolution. Header/TLS bytes are excluded; amplification divides transfer bodies by full replacement Markdown UTF8 bytes. Drive method quota weights/cost are UNKNOWN; WebDAV has no comparable provider quota in this mock. No cost or performance winner is inferred between mocked APIs.\n\n| Latest stage | Result | Evidence | Hash / reason |\n| --- | --- | --- | --- |\n${proofTable}\n\nRuntime equivalence verifies executed protocol/store/revision/fixture/dependency hashes against this checkout; report-only source edits do not relabel old runs. All failed and superseded runs remain in the append-only ledger; A4 exposed a real recovery-visibility defect and the first new A5 exposed an incorrect test expectation of state priority. The earlier25-seed/100-combination run remains partial historical evidence.\n\nLimits: complete coherent GET/strongETag/atomicIf-Match are required. Only127.0.0.1 mocks; real Drive/WebDAV/OAuth/CORS not tested. Node diagnostics use fake-indexeddb; crash correctness separately uses native Chromium IndexedDB. Whole-browser/OS/power loss, cross-tab writers, migration and history GC are unsupported. Full snapshots amplify every edit and grow with history. Fresh clients cannot detect omitted unknown revisions. Original RxDB/selfstore [baseline scorecard](../byos-sync/SCORECARD.md) is unchanged and remains NO SAFE WINNER. This custom candidate is separate. Final independent review, native CI, exact merged SHAs and Hub pin are recorded in the delivery acceptance packet. Master remains OPEN for Founder offline acceptance. No deployment.\n`;
  return { summary, scorecard, overview: `# Offline remediation result\n\n**${decision}**\n\n${outcome}\n\n${numeric}\n\nSee the [numeric scorecard](SCORECARD.md), [replay/contract](README.md), [machine evidence](evidence/decision-summary.json), and [delivery packet](../../docs/sessions/20261023-byos-remediation/task.md). The original study remains unchanged. Master stays OPEN; no real provider or deployment activity.\n` };
}

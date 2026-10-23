import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fixture, assertPreserved, remoteRevisions } from "./test-support.mjs";
import { revision, canonical } from "./revisions.mjs";
import { treeFixture, audit, requestMetrics, sha, sorted } from "./matrix.mjs";
import { root, session, digest } from "./evidence.mjs";

export async function requireSafety() {
  const records = (await readFile(path.join(session, "attempts.jsonl"), "utf8")).trim().split("\n").map(JSON.parse);
  const proofs = {};
  for (const id of ["A5", "A6"]) {
    const record = records.findLast((r) => r.attempt === id);
    assert.equal(record?.result, "PASS", `Latest ${id} must pass before measurements`);
    const bytes = await readFile(path.resolve(root, "../..", record.evidence));
    assert.equal(digest(bytes), record.evidenceSha256);
    const data = JSON.parse(bytes);
    assert.equal(data.id, id); assert.equal(data.source.sourceDigest, record.sourceDigest);
    for (const file of ["src/protocol.mjs", "src/store.mjs", "src/revisions.mjs"]) {
      assert.equal(digest(await readFile(path.join(root, file))), data.source.manifest[file], `Runtime changed since ${id}: ${file}`);
    }
    proofs[id] = { evidence: record.evidence, evidenceSha256: record.evidenceSha256, sourceDigest: record.sourceDigest };
    assert.equal(data.output.passed, true);
    if (id === "A5") {
      assert.equal(data.output.results.length, 100);
      assert.equal(new Set(data.output.results.map((r) => r.seed)).size, 100);
      assert.ok(data.output.results.every((r) => r.status === "PASS" && r.lostIntentCount === 0 && r.falseStateCount === 0));
      assert.equal(data.output.lifecycle.length, 2); assert.ok(data.output.lifecycle.every((r) => r.passed));
    } else {
      assert.equal(data.output.results.length, 12);
      assert.ok(data.output.results.every((r) => r.status === "PASS" && r.rendererCrashed && r.storageProof.nativeOpen && r.falseStateCount === 0));
    }
  }
  return proofs;
}

export async function diagnosticTrial(provider, scale, seed) {
  const f = await fixture(provider, { seed, network: "normal" });
  const row = { provider, scale, seed, status: "RUNNING", fixture: "binary-tree-v1", network: { contract: "byos-loopback-v2", name: "normal", rttMs: 8, jitterMs: 2 }, phases: {}, observations: [] };
  const began = performance.now(), cpu = process.cpuUsage();
  const observed = async (store, expected, phase) => { const item = await audit(f, store, expected, phase); row.observations.push(item); return item; };
  const check = async (expected, conflictIds) => {
    for (const store of [f.a, f.b]) {
      const rows = await store.read(); assertPreserved(rows, expected); assert.equal(rows.length, expected.length);
      const state = await store.status(f.destination.id); assert.equal(state.pending.length, 0);
      assert.equal(state.remote, "verified-revision-set");
      if (conflictIds) {
        const page = state.projection.find((p) => p.pageId === "page-5");
        assert.deepEqual(page.heads.map((r) => r.revisionId).sort(), [...conflictIds].sort());
        assert.equal(state.local, "conflict");
      }
    }
  };
  const phase = async (name, changeBytes, operation) => {
    const index = f.remote.requests.length, start = performance.now(), beforeCpu = process.cpuUsage();
    await operation();
    const elapsedMs = performance.now() - start, usage = process.cpuUsage(beforeCpu);
    const metrics = requestMetrics(f.remote.requests.slice(index));
    metrics.quotaUnits = provider === "drive" ? "UNKNOWN_MEDIA_METHOD_WEIGHTS" : "NOT_APPLICABLE";
    metrics.unknownWeightRequests = provider === "drive" ? metrics.requests : "NOT_APPLICABLE";
    row.phases[name] = { elapsedMs, harnessCpuMs: (usage.user + usage.system) / 1000, ...metrics, userBodyBytes: changeBytes, transferAmplification: changeBytes ? (metrics.bytesUp + metrics.bytesDown) / changeBytes : null };
  };
  try {
    const roots = await treeFixture(scale, seed);
    row.fixtureDigest = sha(sorted(roots));
    const localStart = performance.now(); await f.a.append(roots);
    row.localInitializationMs = performance.now() - localStart;
    await observed(f.a, roots, "initial-local-ack");
    await phase("cold", null, async () => {
      assert.equal((await f.connect(f.a).sync()).outcome, "verified");
      const hydration = performance.now();
      assert.equal((await f.connect(f.b).sync()).outcome, "verified");
      row.coldSecondDeviceHydrationMs = performance.now() - hydration;
      await check(roots);
    });
    for (const store of [f.a, f.b]) await observed(store, roots, "cold-settled");
    row.coldRemoteBytes = [...f.remote.files.values()].reduce((n, x) => n + x.body.length, 0);
    const online = await revision({ ...roots[5], revisionId: `diagnostic-${seed}-online`, parents: [roots[5].revisionId], body: `Complete single-page replacement for paired trial ${seed}.\n${"One page edit. ".repeat(5)}` });
    await f.a.append([online]);
    // The measured boundary begins immediately after the local durability ACK.
    await phase("incremental", Buffer.byteLength(online.body), async () => {
      await f.connect(f.a).sync(); await f.connect(f.b).sync(); await check([...roots, online]);
    });
    for (const store of [f.a, f.b]) await observed(store, [...roots, online], "incremental-settled");
    f.remote.control.offline = true;
    const offline = await Promise.all(["a", "b"].map((owner) => revision({ ...online, revisionId: `diagnostic-${seed}-offline-${owner}`, parents: [online.revisionId], body: `Complete concurrent offline body ${owner}, paired trial ${seed}.\n${"Both versions remain recoverable. ".repeat(4)}` })));
    await f.a.append([offline[0]]); await f.b.append([offline[1]]);
    await observed(f.a, [...roots, online, offline[0]], "offline-local-ack-a");
    await observed(f.b, [...roots, online, offline[1]], "offline-local-ack-b");
    const outageIndex = f.remote.requests.length;
    const outage = await f.connect(f.a, { maxAttempts: 1 }).sync();
    row.offlineOutcome = { outcome: outage.outcome, attempts: outage.attempts, trace: outage.trace };
    row.outageMetrics = requestMetrics(f.remote.requests.slice(outageIndex));
    assert.equal(outage.outcome, "verification-unknown");
    const expected = [...roots, online, ...offline];
    f.remote.control.offline = false;
    await phase("reconnect", offline.reduce((n, r) => n + Buffer.byteLength(r.body), 0), async () => {
      for (const store of [f.a, f.b, f.a]) assert.equal((await f.connect(store).sync()).outcome, "verified");
      await check(expected, offline.map((r) => r.revisionId));
    });
    row.conflictDetectionMs = row.phases.reconnect.elapsedMs;
    for (const store of [f.a, f.b]) await observed(store, expected, "reconnect-conflicts-settled");
    const measuredEnd = f.remote.requests.length;
    f.a = await f.reopen(f.a); f.b = await f.reopen(f.b);
    const cold = await f.add(); assert.equal((await f.connect(cold).sync()).outcome, "verified");
    for (const store of [f.a, f.b, cold]) {
      assertPreserved(await store.read(), expected); await observed(store, expected, "post-measurement-reopen-or-cold-restore");
    }
    assertPreserved(remoteRevisions(f), expected);
    row.finalRemoteBytes = [...f.remote.files.values()].reduce((n, x) => n + x.body.length, 0);
    row.validationMetrics = requestMetrics(f.remote.requests.slice(measuredEnd));
    row.requests = f.remote.requests;
    row.expectedDigest = sha(sorted(expected)); row.remoteDigest = sha(sorted(remoteRevisions(f)));
    const edits = [online, ...offline], actual = new Map(remoteRevisions(f).map((r) => [r.revisionId, canonical(r)]));
    const finalPage = (await f.a.status(f.destination.id)).projection.find((p) => p.pageId === online.pageId);
    const manualIds = new Set(finalPage.conflict ? finalPage.heads.map((r) => r.revisionId) : []);
    const preserved = edits.filter((r) => actual.get(r.revisionId) === canonical(r));
    row.acknowledgedEditCount = new Set(edits.map((r) => r.revisionId)).size;
    row.appliedOrDurablyRecoverableEditCount = preserved.length;
    row.silentLostEditCount = row.acknowledgedEditCount - preserved.length;
    row.durableManualConflictCount = preserved.filter((r) => manualIds.has(r.revisionId)).length;
    row.mergedOrAppliedCount = preserved.length - row.durableManualConflictCount;
    row.autoMergedCount = 0;
    row.falseStateCount = row.observations.filter((o) => o.falseLocal || o.falseVerified || o.falsePending).length;
    row.status = "PASS";
    return row;
  } catch (error) {
    row.status = /deadline|timeout/i.test(error.message) ? "TIMEOUT" : "FAIL";
    row.error = { message: error.message, observation: error.observation }; row.requests = f.remote.requests; return row;
  } finally {
    row.runtimeMs = performance.now() - began;
    const usage = process.cpuUsage(cpu); row.harnessCpuMs = (usage.user + usage.system) / 1000;
    row.observedNodeHeapBytes = process.memoryUsage().heapUsed;
    await f.close();
  }
}

export async function normalDiagnostics() {
  const safetyProofs = await requireSafety(), results = [];
  for (const provider of ["drive", "webdav"]) for (const scale of [10, 1000]) for (let trial = 1; trial <= 30; trial++) {
    const row = await diagnosticTrial(provider, scale, 10000 + trial); results.push(row);
    if (trial % 5 === 0 || row.status !== "PASS") console.log(JSON.stringify({ stage: "normal", provider, scale, trial, status: row.status }));
    if (row.status !== "PASS") return { passed: false, safetyProofs, results, plannedTrials: 120 };
  }
  for (const scale of [10, 1000]) for (let i = 0; i < 30; i++) {
    assert.equal(results.find((r) => r.provider === "drive" && r.scale === scale && r.seed === 10001 + i).fixtureDigest, results.find((r) => r.provider === "webdav" && r.scale === scale && r.seed === 10001 + i).fixtureDigest);
  }
  return { passed: true, safetyProofs, results, plannedTrials: 120, pairedFixturesVerified: true, definitions: {
    timing: "Cold: after initial local fixture ACK through both stores inspected durable and pending settled; incremental: last local edit ACK through both stores inspected durable and pending settled; reconnect: restored connectivity through both stores inspected durable full conflicts and pending settled.",
    hydration: "Second initially empty device imports the complete existing snapshot and commits its verification receipt.",
    bytes: "HTTP body bytes only; headers, TLS and wire framing excluded. Amplification uses UTF8 full replacement Markdown body bytes, not text delta or protocol metadata.",
    backend: "Node native RxDB/Dexie with fake-indexeddb; separate real Chromium IndexedDB crash correctness evidence. Synthetic8ms RTT/2ms jitter, not measured Google/WebDAV latency.",
    cpu: "Node process CPU including harness/oracle work; heap observations are not peak memory or isolated database footprint.",
    failures: "All attempted rows retained. No percentile eligibility with non-PASS rows or fewer than30 completed paired rows per cell. Browser/OS/power-loss and real-provider validation remain separate.",
  } };
}

import assert from "node:assert/strict";
import { revision, canonical, validateRevisions } from "./revisions.mjs";
import { fixture, assertPreserved, remoteRevisions } from "./test-support.mjs";
import { treeFixture, audit, sha, sorted, inversionWitness, requestMetrics } from "./matrix.mjs";
import { safetySchedule, trialPlan } from "./trial-schedule.mjs";

export async function safetyTrial(provider, scale, seed) {
  const f = await fixture(provider, { seed }), observations = [], acknowledged = [];
  const plan = trialPlan(provider, scale, seed);
  const row = { provider, scale, seed, plan, fixture: "binary-tree-v1", scenario: seed % 4, status: "RUNNING", observations };
  const observe = async (store, expected, phase) => { const o = await audit(f, store, expected, phase); observations.push(o); return o; };
  try {
    const roots = await treeFixture(scale, seed); acknowledged.push(...roots);
    await f.a.append(roots); await observe(f.a, roots, "initial-local-ack");
    assert.equal((await f.connect(f.a).sync()).outcome, "verified"); assert.equal((await f.connect(f.b).sync()).outcome, "verified");
    const edit = async (base, owner, extra = {}) => revision({ ...base, revisionId: `s${seed}-${owner}`, parents: [base.revisionId], body: `Complete ${owner} body for seed ${seed}.\n${"Never infer preservation from IDs only. ".repeat(3)}`, metadata: { title: base.pageId, updatedAt: owner.includes("a") ? -86400000 * (seed + 10) : 86400000 * (seed + 50000) }, ...extra });
    const same = await Promise.all([edit(roots[0], "same-a"), edit(roots[0], "same-b")]);
    const different = await Promise.all([edit(roots[plan.differentPageIndices[0]], "different-a"), edit(roots[plan.differentPageIndices[1]], "different-b")]);
    const ownA = [...roots, same[0], different[0]], ownB = [...roots, same[1], different[1]];
    await f.a.append([same[0], different[0]]); await f.b.append([same[1], different[1]]);
    acknowledged.push(...same, ...different);
    if (seed % 4 === 0) {
      const del = await edit(roots[1], "parent-delete", { kind: "delete" });
      const child = await edit(roots[3], "child-edit");
      const leaf = roots.at(-1), tomb = await edit(leaf, "leaf-delete", { kind: "delete" });
      const fresh = await edit(leaf, "recreated", { incarnation: "new", supersedes: ["initial"], parents: [tomb.revisionId] });
      const stale = await edit(leaf, "stale-old");
      await f.a.append([del, tomb, fresh]); await f.b.append([child, stale]);
      ownA.push(del, tomb, fresh); ownB.push(child, stale); acknowledged.push(del, tomb, fresh, child, stale);
      row.requiredRecoveryIds = [child.revisionId, stale.revisionId];
    } else if (seed % 4 === 1) {
      const leaf = roots.at(-1), tomb = await edit(leaf, "shared-delete", { kind: "delete" });
      await f.a.append([tomb]); await f.b.append([tomb]);
      const recreate = await Promise.all(["a", "b"].map((owner) => edit(leaf, `recreate-${owner}`, { incarnation: `new-${owner}`, supersedes: ["initial"], parents: [tomb.revisionId] })));
      await f.a.append([recreate[0]]); await f.b.append([recreate[1]]);
      ownA.push(tomb, recreate[0]); ownB.push(tomb, recreate[1]); acknowledged.push(tomb, ...recreate);
      row.concurrentRecreatedPage = leaf.pageId;
    } else if (seed % 4 === 2) {
      // Both clients have explicitly seen the same two conflict heads, then make
      // independent resolutions. Neither concurrent resolution may disappear.
      await f.a.append(same); await f.b.append(same);
      const resolutions = await Promise.all(["a", "b"].map((owner) => edit(roots[0], `resolution-${owner}`, { parents: same.map((r) => r.revisionId) })));
      await f.a.append([resolutions[0]]); await f.b.append([resolutions[1]]);
      ownA.push(same[1], resolutions[0]); ownB.push(same[0], resolutions[1]); acknowledged.push(...resolutions);
      row.concurrentResolutionIds = resolutions.map((r) => r.revisionId);
    } else {
      const missing = await edit(roots[4], "missing-tree", { parent: { pageId: "missing-tree-parent", incarnation: "initial" } });
      await f.a.append([missing]); ownA.push(missing); acknowledged.push(missing);
      assert.equal((await f.a.status(f.destination.id)).local, "incomplete");
      row.incompleteTreeObserved = true;
      const parent = await revision({ revisionId: `s${seed}-missing-parent-now-present`, pageId: "missing-tree-parent", body: "Full recovered tree parent" });
      await f.a.append([parent]); ownA.push(parent); acknowledged.push(parent);
    }
    await observe(f.a, ownA, "offline-ack-a"); await observe(f.b, ownB, "offline-ack-b");
    const faults = ["unknown-success", "401", "403-denied", "429", "503", "duplicate", "none"];
    row.fault = faults[seed % faults.length];
    let fault;
    if (row.fault === "unknown-success") fault = { method: f.destination.method, kind: "unknown-success" };
    else if (["401", "429", "503"].includes(row.fault)) fault = { method: "GET", status: Number(row.fault) };
    else if (row.fault === "duplicate") fault = { method: "GET", kind: "duplicate-response" };
    else if (row.fault === "403-denied") f.remote.control.status = 403;
    if (fault) f.remote.faults.push(fault);
    row.firstOutcome = await f.connect(f.a, { maxAttempts: 2 }).sync();
    // Retain compact trace/status rather than repeated full fixture projections.
    row.firstOutcome = { outcome: row.firstOutcome.outcome, attempts: row.firstOutcome.attempts, trace: row.firstOutcome.trace };
    if (fault) { assert.equal(fault.used, true); row.faultReceipt = structuredClone(fault); }
    if (row.fault === "unknown-success") assert.equal(fault.matched.mutation_applied, true);
    if (row.fault === "401") assert.equal(row.firstOutcome.outcome, "blocked-reauth");
    if (row.fault === "403-denied") { assert.equal(row.firstOutcome.outcome, "blocked"); assert.equal((await f.connect(f.b).sync()).outcome, "blocked"); await observe(f.b, ownB, "permanent-denial-retains-intent"); }
    await observe(f.a, ownA, "after-fault"); f.remote.control.status = undefined;
    const start = performance.now();
    for (const owner of plan.recoveryOrder) assert.equal((await f.connect(f[owner]).sync()).outcome, "verified");
    row.stableRecoveryMs = performance.now() - start;
    assert.ok(row.stableRecoveryMs < 16000, "four bounded recovery cycles exceeded 16 seconds");
    f.a = await f.reopen(f.a); f.b = await f.reopen(f.b);
    const third = await f.add(); assert.equal((await f.connect(third).sync()).outcome, "verified");
    for (const [i, store] of [f.a, f.b, third].entries()) {
      assertPreserved(await store.read(), acknowledged); assert.equal((await store.read()).length, acknowledged.length);
      const state = await store.status(f.destination.id); assert.equal(state.pending.length, 0);
      if (row.requiredRecoveryIds) for (const id of row.requiredRecoveryIds) assert.ok(state.projection.some((p) => p.recovery.some((item) => item.revision.revisionId === id)), `missing visible recovery ${id}`);
      if (row.concurrentRecreatedPage) assert.equal(state.projection.find((p) => p.pageId === row.concurrentRecreatedPage).active.length, 2);
      if (row.concurrentResolutionIds) assert.deepEqual(state.projection.find((p) => p.pageId === roots[0].pageId).heads.map((r) => r.revisionId).sort(), [...row.concurrentResolutionIds].sort());
      const expectedHeads = row.concurrentResolutionIds ?? same.map((r) => r.revisionId);
      const rootProjection = state.projection.find((p) => p.pageId === roots[0].pageId);
      assert.deepEqual(rootProjection.heads.map((r) => r.revisionId).sort(), [...expectedHeads].sort());
      assert.equal(rootProjection.conflict, true);
      assert.equal(state.local, "conflict");
      await observe(store, acknowledged, `reopen-or-cold-${i}`);
    }
    await f.connect(f.a).sync(); await f.connect(f.b).sync();
    await observe(f.a, acknowledged, "repeated-sync-a"); await observe(f.b, acknowledged, "repeated-sync-b");
    row.fixtureDigest = sha(sorted(roots)); row.expectedDigest = sha(sorted(acknowledged));
    row.acknowledgedBodies = acknowledged.filter((r) => !roots.some((base) => base.revisionId === r.revisionId));
    row.intentCount = acknowledged.length - roots.length; row.expectedRevisionCount = acknowledged.length;
    const remote = remoteRevisions(f); assertPreserved(remote, acknowledged);
    row.remoteDigest = sha(sorted(remote)); row.appliedIntentCount = row.acknowledgedBodies.filter((r) => remote.some((v) => canonical(v) === canonical(r))).length;
    row.lostIntentCount = row.intentCount - row.appliedIntentCount;
    row.falseStateCount = observations.filter((o) => o.falseLocal || o.falseVerified || o.falsePending).length;
    row.metrics = requestMetrics(f.remote.requests); row.requests = f.remote.requests;
    row.status = "PASS"; return row;
  } catch (error) { row.status = "FAIL"; row.error = { message: error.message, observation: error.observation }; row.requests = f.remote.requests; return row; }
  finally { await f.close(); }
}
export async function causalWitnesses() {
  const f = await fixture("drive");
  try {
    const orphan = await revision({ revisionId: "orphan", pageId: "orphan", parents: ["unknown"], body: "Full orphan durable intent" });
    await f.a.append([orphan]); assert.equal((await f.a.status(f.destination.id)).local, "incomplete");
    const blocked = await f.connect(f.a).sync(); assert.equal(blocked.outcome, "blocked");
    assertPreserved(await f.a.read(), [orphan]);
    const cycles = await Promise.all(["a", "b"].map((id) => revision({ revisionId: id, pageId: "cycle", parents: [id === "a" ? "b" : "a"], body: `Causal cycle ${id}` })));
    await assert.rejects(validateRevisions(cycles), /causal cycle/);
    const tree = await Promise.all(["tree-a", "tree-b"].map((id) => revision({ revisionId: id, pageId: id, parent: { pageId: id === "tree-a" ? "tree-b" : "tree-a", incarnation: "initial" }, body: `Full tree cycle ${id}` })));
    await f.b.append(tree); assert.equal((await f.b.status(f.destination.id)).local, "incomplete");
    return { passed: true, missingCausal: { local: blocked.status.local, remote: blocked.outcome, body: orphan }, causalCycleRejected: true, treeCycleLocal: (await f.b.status(f.destination.id)).local, fullTreeBodies: tree };
  } finally { await f.close(); }
}
export async function safetyMatrix() {
  const results = [], inversions = [];
  for (const provider of ["drive", "webdav"]) inversions.push(await inversionWitness(provider));
  const causal = await causalWitnesses();
  for (const { provider, scale, seed } of safetySchedule()) {
    const row = await safetyTrial(provider, scale, seed); results.push(row);
    if (seed % 5 === 0 || row.status !== "PASS") console.log(JSON.stringify({ stage: "safety", provider, scale, seed, status: row.status }));
    if (row.status !== "PASS") return { passed: false, results, inversions, causal, plannedTrials: 100, completedTrials: results.length };
  }
  return { passed: true, results, inversions, causal, plannedTrials: 100, completedTrials: results.length };
}

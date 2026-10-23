import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { openStore } from "./store.mjs";
import { revision, canonical, snapshot } from "./revisions.mjs";
import { fixture, assertPreserved, eventually, rendezvous, remoteRevisions, seedPages } from "./test-support.mjs";

export async function a1() {
  const names = [`aone${Date.now()}a`, `aone${Date.now()}b`];
  let stores = await Promise.all(names.map(openStore));
  const evidence = { scenario: "independent local immutable stores / full conflict bodies / reopen / integrity" };
  try {
    const root = await revision({ revisionId: "root", pageId: "page", body: "Original complete body" });
    const edits = await Promise.all(["A", "B"].map((owner) => revision({ revisionId: `edit-${owner}`, pageId: "page", parents: [root.revisionId], body: `Complete acknowledged body from ${owner}\nUnique second paragraph ${owner}.` })));
    await Promise.all(stores.map((s) => s.append([root])));
    evidence.acks = await Promise.all(stores.map((s, i) => s.append([edits[i]])));
    for (const s of stores) await s.append(edits);
    for (const s of stores) await s.close();
    stores = await Promise.all(names.map(openStore));
    evidence.afterReopen = await Promise.all(stores.map(async (s) => ({ revisions: await s.read(), state: await s.status("offline") })));
    for (const result of evidence.afterReopen) {
      assertPreserved(result.revisions, [root, ...edits]);
      assert.equal(result.state.local, "conflict");
      assert.equal(result.state.remote, "pending");
      assert.equal(result.state.projection[0].heads.length, 2);
      assert.deepEqual(result.state.projection[0].heads.map((r) => r.body).sort(), edits.map((r) => r.body).sort());
    }
    await stores[0].append([edits[0]]);
    assert.equal((await stores[0].read()).length, 3);
    const forged = await revision({ ...edits[0], body: "Different full content using acknowledged ID" });
    await assert.rejects(stores[0].append([forged]), /ID collision/);
    evidence.sameIdMismatch = "REJECTED";
    evidence.idempotentCount = (await stores[0].read()).length;
    const resolution = await revision({ revisionId: "resolution", pageId: "page", parents: edits.map((r) => r.revisionId), body: "Explicit manual resolution containing A and B" });
    await stores[1].append([resolution]);
    assert.equal((await stores[1].status("offline")).local, "local-saved");
    assertPreserved(await stores[1].read(), edits);
    // Prototype-sensitive IDs are legal strings and cannot corrupt projection.
    await stores[1].append([await revision({ revisionId: "prototype-id", pageId: "prototype-page", incarnation: "__proto__", body: "retained" })]);
    assert.equal((await stores[1].status("offline")).projection.length, 2);
    evidence.resolutionRetainsOriginalBodies = true;
    return evidence;
  } finally { for (const store of stores) await store.close(); }
}

export async function a2() {
  const results = [];
  for (const provider of ["drive", "webdav"]) {
    const f = await fixture(provider);
    const evidence = { provider, customTransport: true };
    try {
      const [root] = await seedPages(f.a, 1);
      assert.equal((await f.connect(f.a).sync()).outcome, "verified");
      await f.connect(f.b).sync();
      const edits = await Promise.all(["a", "b"].map((owner) => revision({ revisionId: `race-${owner}`, pageId: root.pageId, parents: [root.revisionId], body: `Whole offline body ${owner}\nMust survive CAS and restart.` })));
      await Promise.all([f.a.append([edits[0]]), f.b.append([edits[1]])]);
      const meet = rendezvous(2), reads = [];
      const barrier = async (point, value) => {
        if (point === "after-read" && value.attempt === 1) { reads.push({ etag: value.etag, revisions: value.revisions.map((r) => r.revisionId) }); await meet(); }
      };
      evidence.racingResults = await Promise.all([f.connect(f.a, { barrier }).sync(), f.connect(f.b, { barrier }).sync()]);
      assert.equal(reads.length, 2); assert.equal(reads[0].etag, reads[1].etag);
      assert.ok(f.remote.requests.some((r) => r.status === 412));
      assert.ok(evidence.racingResults.every((r) => r.outcome === "verified"));
      evidence.sameGetVersionBarrier = reads;
      await f.connect(f.a).sync(); await f.connect(f.b).sync();
      f.a = await f.reopen(f.a); f.b = await f.reopen(f.b);
      const third = await f.add(); await f.connect(third).sync();
      evidence.reopenedAndCold = [];
      for (const s of [f.a, f.b, third]) {
        const records = await s.read(), status = await s.status(f.destination.id);
        assertPreserved(records, [root, ...edits]);
        assert.equal(status.local, "conflict"); assert.equal(status.pending.length, 0);
        evidence.reopenedAndCold.push({ records, status });
      }
      const first = await revision({ revisionId: "held-remote", pageId: "held-page", body: "First held remote revision" });
      await f.a.append([first]);
      const fault = { method: f.destination.method, kind: "hold-before-write", bodyContains: "held-remote" };
      f.remote.faults.push(fault);
      let completed = false;
      const syncing = f.connect(f.a, { maxAttempts: 1, requestTimeoutMs: 700 }).sync().finally(() => { completed = true; });
      await eventually(() => fault.used);
      const during = await revision({ revisionId: "during-held", pageId: "held-page", parents: [first.revisionId], body: "Locally saved while remote request is held" });
      const start = performance.now();
      const ack = await f.a.append([during]);
      evidence.heldNetwork = { ack, ackElapsedMs: performance.now() - start, syncCompletedAtAck: completed, barrier: structuredClone(fault) };
      assert.equal(completed, false);
      assert.equal(fault.matched.mutation_applied, false);
      assert.equal(fault.matched.response_delivered, false);
      const outcome = await syncing;
      assert.equal(outcome.outcome, "verification-unknown");
      assert.ok(outcome.status.pending.includes("during-held"));
      evidence.heldNetwork.failedSync = outcome;
      assert.equal((await f.connect(f.a).sync()).outcome, "verified");
      await f.connect(third).sync(); assertPreserved(await third.read(), [first, during, ...edits]);
      evidence.requests = f.remote.requests;
      results.push(evidence);
    } finally { await f.close(); }
  }
  return results;
}

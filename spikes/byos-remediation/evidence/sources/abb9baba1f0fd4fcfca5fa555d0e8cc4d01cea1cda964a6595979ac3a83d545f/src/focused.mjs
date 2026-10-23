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

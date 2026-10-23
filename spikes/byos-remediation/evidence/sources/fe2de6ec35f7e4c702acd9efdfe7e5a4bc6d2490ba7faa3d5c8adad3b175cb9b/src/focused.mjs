import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { openStore } from "./store.mjs";
import { revision, canonical, snapshot } from "./revisions.mjs";
import {
  fixture,
  assertPreserved,
  eventually,
  rendezvous,
  remoteRevisions,
  seedPages,
} from "./test-support.mjs";

export async function a1() {
  const names = [`aone${Date.now()}a`, `aone${Date.now()}b`];
  let stores = await Promise.all(names.map(openStore));
  const evidence = {
    scenario:
      "independent local immutable stores / full conflict bodies / reopen / integrity",
  };
  try {
    const root = await revision({
      revisionId: "root",
      pageId: "page",
      body: "Original complete body",
    });
    const edits = await Promise.all(
      ["A", "B"].map((owner) =>
        revision({
          revisionId: `edit-${owner}`,
          pageId: "page",
          parents: [root.revisionId],
          body: `Complete acknowledged body from ${owner}\nUnique second paragraph ${owner}.`,
        }),
      ),
    );
    await Promise.all(stores.map((s) => s.append([root])));
    evidence.acks = await Promise.all(
      stores.map((s, i) => s.append([edits[i]])),
    );
    for (const s of stores) await s.append(edits);
    for (const s of stores) await s.close();
    stores = await Promise.all(names.map(openStore));
    evidence.afterReopen = await Promise.all(
      stores.map(async (s) => ({
        revisions: await s.read(),
        state: await s.status("offline"),
      })),
    );
    for (const result of evidence.afterReopen) {
      assertPreserved(result.revisions, [root, ...edits]);
      assert.equal(result.state.local, "conflict");
      assert.equal(result.state.remote, "pending");
      assert.equal(result.state.projection[0].heads.length, 2);
      assert.deepEqual(
        result.state.projection[0].heads.map((r) => r.body).sort(),
        edits.map((r) => r.body).sort(),
      );
    }
    await stores[0].append([edits[0]]);
    assert.equal((await stores[0].read()).length, 3);
    const forged = await revision({
      ...edits[0],
      body: "Different full content using acknowledged ID",
    });
    await assert.rejects(stores[0].append([forged]), /ID collision/);
    evidence.sameIdMismatch = "REJECTED";
    evidence.idempotentCount = (await stores[0].read()).length;
    const resolution = await revision({
      revisionId: "resolution",
      pageId: "page",
      parents: edits.map((r) => r.revisionId),
      body: "Explicit manual resolution containing A and B",
    });
    await stores[1].append([resolution]);
    assert.equal((await stores[1].status("offline")).local, "local-saved");
    assertPreserved(await stores[1].read(), edits);
    // Prototype-sensitive IDs are legal strings and cannot corrupt projection.
    await stores[1].append([
      await revision({
        revisionId: "prototype-id",
        pageId: "prototype-page",
        incarnation: "__proto__",
        body: "retained",
      }),
    ]);
    assert.equal((await stores[1].status("offline")).projection.length, 2);
    evidence.resolutionRetainsOriginalBodies = true;
    return evidence;
  } finally {
    for (const store of stores) await store.close();
  }
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
      const edits = await Promise.all(
        ["a", "b"].map((owner) =>
          revision({
            revisionId: `race-${owner}`,
            pageId: root.pageId,
            parents: [root.revisionId],
            body: `Whole offline body ${owner}\nMust survive CAS and restart.`,
          }),
        ),
      );
      await Promise.all([f.a.append([edits[0]]), f.b.append([edits[1]])]);
      const meet = rendezvous(2),
        reads = [];
      const barrier = async (point, value) => {
        if (point === "after-read" && value.attempt === 1) {
          reads.push({
            etag: value.etag,
            revisions: value.revisions.map((r) => r.revisionId),
          });
          await meet();
        }
      };
      evidence.racingResults = await Promise.all([
        f.connect(f.a, { barrier }).sync(),
        f.connect(f.b, { barrier }).sync(),
      ]);
      assert.equal(reads.length, 2);
      assert.equal(reads[0].etag, reads[1].etag);
      assert.ok(f.remote.requests.some((r) => r.status === 412));
      assert.ok(evidence.racingResults.every((r) => r.outcome === "verified"));
      evidence.sameGetVersionBarrier = reads;
      await f.connect(f.a).sync();
      await f.connect(f.b).sync();
      f.a = await f.reopen(f.a);
      f.b = await f.reopen(f.b);
      const third = await f.add();
      await f.connect(third).sync();
      evidence.reopenedAndCold = [];
      for (const s of [f.a, f.b, third]) {
        const records = await s.read(),
          status = await s.status(f.destination.id);
        assertPreserved(records, [root, ...edits]);
        assert.equal(status.local, "conflict");
        assert.equal(status.pending.length, 0);
        evidence.reopenedAndCold.push({ records, status });
      }
      const first = await revision({
        revisionId: "held-remote",
        pageId: "held-page",
        body: "First held remote revision",
      });
      await f.a.append([first]);
      const fault = {
        method: f.destination.method,
        kind: "hold-before-write",
        bodyContains: "held-remote",
      };
      f.remote.faults.push(fault);
      let completed = false;
      const syncing = f
        .connect(f.a, { maxAttempts: 1, requestTimeoutMs: 700 })
        .sync()
        .finally(() => {
          completed = true;
        });
      await eventually(() => fault.used);
      const during = await revision({
        revisionId: "during-held",
        pageId: "held-page",
        parents: [first.revisionId],
        body: "Locally saved while remote request is held",
      });
      const start = performance.now();
      const ack = await f.a.append([during]);
      evidence.heldNetwork = {
        ack,
        ackElapsedMs: performance.now() - start,
        syncCompletedAtAck: completed,
        barrier: structuredClone(fault),
      };
      assert.equal(completed, false);
      assert.equal(fault.matched.mutation_applied, false);
      assert.equal(fault.matched.response_delivered, false);
      const outcome = await syncing;
      assert.equal(outcome.outcome, "verification-unknown");
      assert.ok(outcome.status.pending.includes("during-held"));
      evidence.heldNetwork.failedSync = outcome;
      assert.equal((await f.connect(f.a).sync()).outcome, "verified");
      await f.connect(third).sync();
      assertPreserved(await third.read(), [first, during, ...edits]);
      evidence.requests = f.remote.requests;
      results.push(evidence);
    } catch (error) {
      error.evidence = {
        completed: results,
        failed: { ...evidence, requests: f.remote.requests },
      };
      throw error;
    } finally {
      await f.close();
    }
  }
  return results;
}

// Independent oracle: acknowledged *full* payloads, exact persisted receipt set,
// and actual mock bytes, sampled at each exercised failure/verification boundary.
async function observe(f, store, acknowledged, phase, observations) {
  const local = await store.read(),
    state = await store.status(f.destination.id);
  const localById = new Map(local.map((r) => [r.revisionId, canonical(r)]));
  const missingBodies = acknowledged
    .filter((r) => localById.get(r.revisionId) !== canonical(r))
    .map((r) => r.revisionId);
  const receiptSet = new Map(
    state.receipt?.revisions.map((r) => [r.revisionId, r.hash]) ?? [],
  );
  const expectedPending = local
    .filter((r) => receiptSet.get(r.revisionId) !== r.hash)
    .map((r) => r.revisionId)
    .sort();
  const falseLocal = state.local === "local-saved" && missingBodies.length > 0;
  let falseRemote = false;
  if (state.receipt) {
    const remote = new Map(
      remoteRevisions(f).map((r) => [r.revisionId, r.hash]),
    );
    falseRemote = state.receipt.revisions.some(
      (r) => remote.get(r.revisionId) !== r.hash,
    );
  }
  const falsePending = canonical(expectedPending) !== canonical(state.pending);
  const item = {
    phase,
    local: state.local,
    remote: state.remote,
    pending: state.pending,
    receipt: state.receipt,
    acknowledged: acknowledged.map((r) => r.revisionId),
    missingBodies,
    falseLocal,
    falseRemote,
    falsePending,
  };
  observations.push(item);
  assert.equal(
    missingBodies.length,
    0,
    `acknowledged full payload missing at ${phase}`,
  );
  assert.equal(
    falseLocal || falseRemote || falsePending,
    false,
    `false observable state at ${phase}`,
  );
  assert.notEqual(state.remote, "Synced");
  return state;
}

export async function a3() {
  const results = [],
    observations = [];
  for (const provider of ["drive", "webdav"]) {
    for (const scenario of [
      "applied-no-response",
      "write-response-before-receipt",
      "verified-read-before-receipt",
      "new-edit-after-readback",
      "stale-readback",
      "reordered-get",
      "duplicate-get",
      "401",
      "403-denied",
      "403-rate-limit",
      "429",
      "503",
      "missing-etag",
      "weak-etag",
      "malformed",
      "missing-parent",
      "hash-mismatch",
      "id-collision",
    ]) {
      const f = await fixture(provider);
      const entry = { provider, scenario, observations: [], boundaries: [] };
      try {
        const [root] = await seedPages(f.a, 1);
        const acknowledged = [root];
        await observe(
          f,
          f.a,
          acknowledged,
          "local-ack-before-network",
          entry.observations,
        );
        const method = f.destination.method;
        const options = {
          maxAttempts: 1,
          requestTimeoutMs: 180,
          deadlineMs: 1200,
        };
        let fault, restore, stale, localAfterRead;
        if (scenario === "applied-no-response")
          fault = { method, kind: "unknown-success" };
        if (scenario === "reordered-get") {
          fault = { method: "GET", kind: "reorder" };
          options.requestTimeoutMs = 500;
        }
        if (scenario === "duplicate-get") {
          await fetch(f.destination.read); // Prime the mock's actual response replay cache.
          fault = { method: "GET", kind: "duplicate-response" };
        }
        if (["401", "429", "503", "403-rate-limit"].includes(scenario))
          fault = {
            method: "GET",
            status: scenario === "403-rate-limit" ? 403 : Number(scenario),
          };
        if (["429", "503", "403-rate-limit"].includes(scenario))
          options.maxAttempts = 2;
        if (scenario === "403-denied") f.remote.control.status = 403;
        if (scenario === "missing-etag") f.remote.control.omitEtag = true;
        if (["weak-etag", "stale-readback"].includes(scenario)) {
          let gets = 0;
          options.fetcher = async (url, init) => {
            const actual = await fetch(url, init);
            if ((init?.method ?? "GET") !== "GET") return actual;
            gets++;
            if (scenario === "weak-etag") {
              const body = await actual.text(),
                headers = new Headers(actual.headers);
              headers.set("etag", `W/${headers.get("etag")}`);
              entry.boundaries.push({
                kind: "weak-validator-delivered",
                get: gets,
                etag: headers.get("etag"),
              });
              return new Response(body, { status: actual.status, headers });
            }
            if (gets === 1) {
              stale = {
                body: await actual.clone().text(),
                status: actual.status,
                headers: Object.fromEntries(actual.headers),
              };
              return actual;
            }
            entry.boundaries.push({
              kind: "stale-readback-delivered",
              get: gets,
              actualVersion: actual.headers.get("etag"),
              deliveredVersion: stale.headers.etag,
            });
            return new Response(stale.body, {
              status: stale.status,
              headers: stale.headers,
            });
          };
        }
        if (
          [
            "write-response-before-receipt",
            "verified-read-before-receipt",
            "new-edit-after-readback",
          ].includes(scenario)
        ) {
          options.barrier = async (point, value) => {
            const wanted =
              scenario === "write-response-before-receipt"
                ? "after-write-response"
                : "before-receipt";
            if (point !== wanted) return;
            entry.boundaries.push({
              point,
              attempt: value.attempt,
              remoteHasFullBody: remoteRevisions(f).some(
                (r) => canonical(r) === canonical(root),
              ),
            });
            await observe(f, f.a, acknowledged, point, entry.observations);
            assert.equal((await f.a.status(f.destination.id)).receipt, null);
            if (scenario === "new-edit-after-readback") {
              localAfterRead = await revision({
                revisionId: "new-after-readback",
                pageId: root.pageId,
                parents: [root.revisionId],
                body: "Full local body created after remote readback",
              });
              await f.a.append([localAfterRead]);
              acknowledged.push(localAfterRead);
            } else
              throw new Error(
                "Simulated interruption before persisted receipt (browser crash deferred to R5)",
              );
          };
        }
        if (
          [
            "malformed",
            "missing-parent",
            "hash-mismatch",
            "id-collision",
          ].includes(scenario)
        ) {
          const object = [...f.remote.files.values()][0];
          restore = Buffer.from(object.body);
          if (scenario === "malformed")
            object.body = Buffer.from('{"namespace":"unknown"}');
          if (scenario === "missing-parent")
            object.body = Buffer.from(
              canonical(
                snapshot([
                  await revision({
                    revisionId: "orphan",
                    pageId: "page-0",
                    parents: ["absent"],
                    body: "recoverable incomplete remote body",
                  }),
                ]),
              ),
            );
          if (scenario === "hash-mismatch")
            object.body = Buffer.from(
              canonical(snapshot([{ ...root, body: "hash tampered body" }])),
            );
          if (scenario === "id-collision")
            object.body = Buffer.from(
              canonical(
                snapshot([
                  await revision({
                    ...root,
                    body: "Same acknowledged ID different content",
                  }),
                ]),
              ),
            );
          entry.boundaries.push({
            kind: "actual-object-replaced-with-invalid-snapshot",
            scenario,
          });
        }
        if (fault) f.remote.faults.push(fault);
        entry.firstResult = await f.connect(f.a, options).sync();
        if (fault) {
          assert.equal(fault.used, true);
          entry.boundaries.push(structuredClone(fault));
          if (scenario === "applied-no-response") {
            assert.equal(fault.matched.mutation_applied, true);
            assert.equal(fault.matched.response_delivered, false);
          }
        }
        const successes = [
          "403-rate-limit",
          "429",
          "503",
          "reordered-get",
          "duplicate-get",
          "new-edit-after-readback",
        ];
        if (successes.includes(scenario))
          assert.equal(entry.firstResult.outcome, "verified");
        else if (scenario === "401")
          assert.equal(entry.firstResult.outcome, "blocked-reauth");
        else if (
          [
            "applied-no-response",
            "write-response-before-receipt",
            "verified-read-before-receipt",
            "stale-readback",
          ].includes(scenario)
        )
          assert.equal(entry.firstResult.outcome, "verification-unknown");
        else assert.equal(entry.firstResult.outcome, "blocked");
        if (scenario === "new-edit-after-readback") {
          assert.ok(
            entry.firstResult.status.pending.includes(
              localAfterRead.revisionId,
            ),
          );
          assert.equal(entry.firstResult.status.remote, "pending");
          assert.ok(
            !entry.firstResult.status.receipt.revisions.some(
              (r) => r.revisionId === localAfterRead.revisionId,
            ),
          );
        }
        await observe(
          f,
          f.a,
          acknowledged,
          "after-first-result",
          entry.observations,
        );
        if (entry.firstResult.outcome !== "verified")
          assert.equal((await f.a.status(f.destination.id)).receipt, null);
        f.a = await f.reopen(f.a);
        await observe(
          f,
          f.a,
          acknowledged,
          "reopen-before-recovery",
          entry.observations,
        );
        if (scenario === "403-denied") {
          entry.permanentDenied = await f.connect(f.a, options).sync();
          assert.equal(entry.permanentDenied.outcome, "blocked");
          assertPreserved(await f.a.read(), acknowledged);
          await observe(
            f,
            f.a,
            acknowledged,
            "permanent-denial-remains-blocked",
            entry.observations,
          );
        }
        if (restore) [...f.remote.files.values()][0].body = restore;
        f.remote.control.status = undefined;
        f.remote.control.omitEtag = false;
        entry.recovery = await f.connect(f.a).sync();
        assert.equal(entry.recovery.outcome, "verified");
        assert.ok(entry.recovery.elapsedMs < 4000);
        await observe(
          f,
          f.a,
          acknowledged,
          "stable-recovery",
          entry.observations,
        );
        const third = await f.add();
        await f.connect(third).sync();
        assertPreserved(await third.read(), acknowledged);
        entry.coldThirdFullBodies = await third.read();
        entry.requests = f.remote.requests;
        assert.equal(f.remote.unsupported.length, 0);
        observations.push(...entry.observations);
        results.push(entry);
      } catch (error) {
        error.evidence = {
          completed: results,
          failed: { ...entry, requests: f.remote.requests },
        };
        throw error;
      } finally {
        await f.close();
      }
    }
    // Direct fixed-snapshot replacement for both original checkpoint witnesses.
    const f = await fixture(provider, { sameTime: true });
    try {
      const roots = await seedPages(f.a, 30);
      await f.connect(f.a).sync();
      const object = [...f.remote.files.values()][0];
      f.remote.control.hiddenIds = [object.id];
      const hiddenListing = await (
        await fetch(
          `${f.remote.url}/drive/v3/files?pageSize=10&fields=files(id),nextPageToken`,
        )
      ).json();
      assert.equal(
        hiddenListing.files.some((r) => r.id === object.id),
        false,
      );
      const restored = await f.connect(f.b).sync();
      assert.equal(restored.outcome, "verified");
      assertPreserved(await f.b.read(), roots);
      const edits = await Promise.all(
        roots.map((r, i) =>
          revision({
            revisionId: `equal-time-${i}`,
            pageId: r.pageId,
            parents: [r.revisionId],
            body: `Whole equal-time edit ${i}`,
            metadata: { title: r.pageId, updatedAt: 0 },
          }),
        ),
      );
      await f.a.append(edits);
      await f.connect(f.a).sync();
      f.remote.control.hiddenIds = [];
      const recovered = await f.connect(f.b).sync();
      assertPreserved(await f.b.read(), [...roots, ...edits]);
      const third = await f.add();
      await f.connect(third).sync();
      assertPreserved(await third.read(), [...roots, ...edits]);
      results.push({
        provider,
        scenario: "30-equal-time-plus-hidden-listing-reveal",
        algorithmReplacement:
          "Fixed snapshot by known ID; no timestamp/listing checkpoint exists. This does not repair native RxDB replication.",
        hiddenListing,
        equalTimestamps: new Set(edits.map((r) => r.metadata.updatedAt)).size,
        fullRevisionsRecovered: (await third.read()).length,
        recovery: recovered,
        requests: f.remote.requests,
      });
    } finally {
      await f.close();
    }
  }
  return {
    results,
    stateObservationCount: observations.length,
    falseStateCount: observations.filter(
      (o) => o.falseLocal || o.falseRemote || o.falsePending,
    ).length,
  };
}

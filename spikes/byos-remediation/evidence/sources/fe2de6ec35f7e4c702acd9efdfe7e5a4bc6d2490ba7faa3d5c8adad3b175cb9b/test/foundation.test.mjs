import test from "node:test";
import assert from "node:assert/strict";
import { a1, a2, a3 } from "../src/focused.mjs";
import {
  decodeSnapshot,
  revision,
  snapshot,
  validateRevisions,
} from "../src/revisions.mjs";
import { client, target } from "../src/protocol.mjs";

test(
  "A1: native local durability, full conflict bodies, reopen, identity, explicit resolution",
  a1,
);
test(
  "A2: actual competing conditional writes and network-independent local ACK",
  { timeout: 15000 },
  a2,
);
test(
  "A3: bounded faults, receipt windows, truthful sampled states and checkpoint replacement",
  { timeout: 30000 },
  async () => {
    const result = await a3();
    assert.equal(result.results.length, 38);
    assert.ok(result.stateObservationCount >= 140);
    assert.equal(result.falseStateCount, 0);
  },
);
test("schema, causal completeness, namespace and transport fail closed", async () => {
  const orphan = await revision({
    revisionId: "orphan",
    pageId: "page",
    parents: ["missing"],
    body: "Full body remains available for recovery",
  });
  assert.deepEqual((await validateRevisions([orphan])).missing, ["missing"]);
  await assert.rejects(decodeSnapshot(snapshot([orphan])), /INCOMPLETE/);
  await assert.rejects(
    decodeSnapshot({ ...snapshot([]), format: 2 }),
    /INTEGRITY/,
  );
  await assert.rejects(
    decodeSnapshot({ ...snapshot([]), unexpected: true }),
    /INTEGRITY/,
  );
  assert.throws(() => target("https://example.com"), /loopback/);
  assert.throws(
    () =>
      client({}, { read: "https://example.com", write: "https://example.com" }),
    /loopback/,
  );
  assert.throws(
    () =>
      client(
        {},
        { read: "http://127.0.0.1:1/read", write: "http://127.0.0.1:2/write" },
      ),
    /origin/,
  );
});

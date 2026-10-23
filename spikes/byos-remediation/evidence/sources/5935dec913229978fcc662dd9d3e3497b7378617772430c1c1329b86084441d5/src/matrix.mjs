import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { canonical, revision } from "./revisions.mjs";
import { fixture, assertPreserved, remoteRevisions } from "./test-support.mjs";
export const sha = (value) => createHash("sha256").update(typeof value === "string" ? value : canonical(value)).digest("hex");
export const sorted = (rows) => [...rows].sort((a, b) => a.revisionId.localeCompare(b.revisionId));
export async function treeFixture(count, seed = 1) {
  return Promise.all(Array.from({ length: count }, (_, i) => revision({ revisionId: `s${seed}-root-${i}`, pageId: `page-${i}`, parent: i ? { pageId: `page-${Math.floor((i - 1) / 2)}`, incarnation: "initial" } : null, body: `Synthetic complete page ${i}; fixture seed ${seed}.\n${"Durable full paragraph αβ. ".repeat(8)}`, metadata: { title: `Page ${i}`, updatedAt: 1700000000000 } })));
}
export async function audit(f, store, expected, phase) {
  const rows = await store.read(), state = await store.status(f.destination.id);
  const actual = new Map(rows.map((r) => [r.revisionId, canonical(r)]));
  const missing = expected.filter((r) => actual.get(r.revisionId) !== canonical(r)).map((r) => r.revisionId);
  const remote = new Map(remoteRevisions(f).map((r) => [r.revisionId, r.hash]));
  const receipt = new Map(state.receipt?.revisions.map((r) => [r.revisionId, r.hash]) ?? []);
  const pending = rows.filter((r) => receipt.get(r.revisionId) !== r.hash).map((r) => r.revisionId).sort();
  const conflicts = state.projection.filter((p) => p.conflict).length;
  const recovery = state.projection.flatMap((p) => p.recovery ?? []);
  const incomplete = state.projection.filter((p) => p.incomplete).length;
  const falseLocal = state.local === "local-saved" && (missing.length > 0 || conflicts > 0 || recovery.length > 0 || incomplete > 0);
  const falseVerified = state.receipt?.revisions.some((r) => remote.get(r.revisionId) !== r.hash) ?? false;
  const falsePending = canonical(pending) !== canonical(state.pending);
  const observation = { phase, local: state.local, remote: state.remote, expectedMinimumCount: expected.length, localRevisionCount: rows.length, expectedDigest: sha(sorted(expected)), localDigest: sha(sorted(rows)), missingFullBodies: missing, falseLocal, falseVerified, falsePending, conflicts, recoveryHeads: recovery.length, incomplete, pendingCount: state.pending.length, receiptCount: receipt.size, receiptVersion: state.receipt?.remoteVersion ?? null, receiptSetDigest: state.receipt ? sha(state.receipt.revisions) : null };
  if (missing.length || falseLocal || falseVerified || falsePending) throw Object.assign(new Error(`Safety oracle failed at ${phase}`), { observation });
  return observation;
}
export function requestMetrics(requests) {
  const endpoints = {};
  let up = 0, down = 0;
  for (const r of requests) { const key = `${r.method} ${r.path}`; endpoints[key] = (endpoints[key] ?? 0) + 1; up += r.bytes_up; down += r.bytes_down; }
  return { requests: requests.length, endpoints, bytesUp: up, bytesDown: down, quotaUnits: "UNKNOWN", unknownWeightRequests: requests.length };
}
// Captures an actual coherent response's bytes/ETag before delaying delivery to
// the protocol. Two outstanding application fetch operations finish in reverse
// order. The baseline mock's pre-read delay is deliberately not used for this.
export function invertedDelivery() {
  let serial = 0, delivered = 0, resolveCaptured, release;
  const captured = new Promise((r) => { resolveCaptured = r; });
  const held = new Promise((r) => { release = r; });
  const receipts = [];
  const fetcher = async (url, init = {}) => {
    const operation = ++serial, method = init.method ?? "GET";
    const response = await fetch(url, init), body = await response.text();
    const receipt = { operation, method, endpoint: url, capturedEtag: response.headers.get("etag"), capturedBodySha256: sha(body), status: response.status, deliveryOrder: null };
    receipts.push(receipt);
    if (operation === 1) { resolveCaptured(); await held; }
    receipt.deliveryOrder = ++delivered;
    return new Response(body || null, { status: response.status, headers: response.headers });
  };
  return { fetcher, captured, release, receipts };
}
export async function inversionWitness(provider = "drive") {
  const f = await fixture(provider), flow = invertedDelivery();
  try {
    const roots = await treeFixture(10, 7001); await f.a.append(roots); await f.connect(f.a).sync(); await f.connect(f.b).sync();
    const edits = await Promise.all(["a", "b"].map((owner) => revision({ ...roots[0], revisionId: `inversion-${owner}`, parents: [roots[0].revisionId], body: `Complete inverted-delivery edit ${owner}` })));
    await f.a.append([edits[0]]); await f.b.append([edits[1]]);
    const first = f.connect(f.a, { fetcher: flow.fetcher, requestTimeoutMs: 2000 }).sync();
    await flow.captured;
    const second = await f.connect(f.b, { fetcher: flow.fetcher }).sync();
    assert.equal(second.outcome, "verified");
    assert.equal(flow.receipts[0].deliveryOrder, null);
    flow.release(); const firstResult = await first;
    assert.equal(firstResult.outcome, "verified");
    const earlier = flow.receipts.find((r) => r.operation === 1), later = flow.receipts.find((r) => r.operation === 2);
    assert.equal(earlier.method, "GET"); assert.equal(later.method, "GET");
    assert.ok(later.deliveryOrder < earlier.deliveryOrder);
    assert.equal(earlier.capturedEtag, later.capturedEtag);
    assert.equal(earlier.capturedBodySha256, later.capturedBodySha256);
    assert.ok(f.remote.requests.some((r) => r.status === 412 && r.if_match === earlier.capturedEtag));
    await f.connect(f.b).sync(); const third = await f.add(); await f.connect(third).sync();
    const observations = [];
    for (const [i, store] of [f.a, f.b, third].entries()) { assertPreserved(await store.read(), [...roots, ...edits]); observations.push(await audit(f, store, [...roots, ...edits], `inverted-restored-${i}`)); }
    return { provider, passed: true, boundary: "actual coherent HTTP bytes captured, application fetch response delivery held and inverted", receipts: flow.receipts, requests: f.remote.requests, observations, expectedDigest: sha(sorted([...roots, ...edits])) };
  } finally { flow.release(); await f.close(); }
}

import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { mock } from "../../byos-sync/src/mock.mjs";
import { openStore } from "./store.mjs";
import { canonical, snapshot, revision } from "./revisions.mjs";
import { client, target } from "./protocol.mjs";
let serial = 0;
export async function fixture(provider = "drive", options = {}) {
  const remote = await mock(options);
  remote.create(
    {
      id: provider === "drive" ? "byos-remediation-v1" : "dav",
      name: "byos-remediation-v1.json",
      mimeType: "application/json",
    },
    Buffer.from(canonical(snapshot([]))),
  );
  const destination = target(remote.url, provider),
    stores = [],
    names = [];
  const add = async () => {
    const name = `remediation${Date.now()}x${serial++}`;
    const store = await openStore(name);
    stores.push(store);
    names.push(name);
    return store;
  };
  const a = await add(),
    b = await add();
  return {
    remote,
    destination,
    a,
    b,
    add,
    connect: (store, options) => client(store, destination, options),
    async reopen(store) {
      const i = stores.indexOf(store);
      await store.close();
      stores[i] = await openStore(names[i]);
      return stores[i];
    },
    async close() {
      for (const store of stores) await store.close();
      await remote.close();
    },
  };
}
export async function seedPages(store, count) {
  const revisions = await Promise.all(
    Array.from({ length: count }, (_, i) =>
      revision({
        revisionId: `root-${i}`,
        pageId: `page-${i}`,
        body: `Complete synthetic page ${i}\n${"fixture paragraph. ".repeat(12)}`,
      }),
    ),
  );
  await store.append(revisions);
  return revisions;
}
export function assertPreserved(actual, expected) {
  const map = new Map(actual.map((r) => [r.revisionId, r]));
  for (const r of expected)
    assert.deepEqual(
      map.get(r.revisionId),
      r,
      `full revision lost: ${r.revisionId}`,
    );
}
export const eventually = async (condition, ms = 1500) => {
  const start = performance.now();
  while (!condition()) {
    if (performance.now() - start > ms)
      throw new Error("test barrier deadline");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};
export function rendezvous(count) {
  let arrived = 0,
    release;
  const ready = new Promise((resolve) => {
    release = resolve;
  });
  return async () => {
    if (++arrived === count) release();
    await ready;
  };
}
export const remoteRevisions = (f) =>
  JSON.parse([...f.remote.files.values()][0].body.toString()).revisions;

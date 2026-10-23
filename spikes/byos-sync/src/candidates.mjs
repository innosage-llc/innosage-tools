import "fake-indexeddb/auto";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { createRxDatabase } = require("rxdb");
const { getRxStorageDexie } = require("rxdb/plugins/storage-dexie");
const {
  replicateGoogleDrive,
} = require("rxdb/plugins/replication-google-drive");
import { selfstore } from "selfstore";
import { indexedDbCache, driveTarget, webdavTarget } from "selfstore/advanced";
const auth = {
  token: async () => "synthetic-token",
  reconnect: async () => true,
  forget: async () => {},
};
export const schema = {
  version: 0,
  primaryKey: "id",
  type: "object",
  properties: {
    id: { type: "string", maxLength: 100 },
    parentId: { type: ["string", "null"] },
    body: { type: "string" },
    editIds: { type: "array", items: { type: "string" } },
  },
  required: ["id", "parentId", "body", "editIds"],
};
export function intercept(mock) {
  const original = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    let url = new URL(typeof input === "string" ? input : input.url);
    if (url.origin === "https://www.googleapis.com")
      url = new URL(url.pathname + url.search, mock.url);
    if (url.origin !== mock.url)
      throw new Error(`NON_LOOPBACK_FETCH_BLOCKED ${url.origin}`);
    return original(url, init);
  };
  return () => {
    globalThis.fetch = original;
  };
}
export async function rxReplica(name, mock) {
  const db = await createRxDatabase({
    name,
    storage: getRxStorageDexie(),
    multiInstance: false,
  });
  await db.addCollections({ pages: { schema } });
  let repl;
  return {
    kind: "rxdb",
    db,
    name,
    async put(p) {
      await db.pages.upsert(p);
    },
    async putAll(ps) {
      await db.pages.bulkUpsert(ps);
    },
    async remove(id) {
      await (await db.pages.findOne(id).exec()).remove();
    },
    async read() {
      return (await db.pages.find().exec()).map((d) => d.toJSON());
    },
    async sync() {
      if (repl) await repl.cancel();
      repl = await replicateGoogleDrive({
        collection: db.pages,
        replicationIdentifier: "byos",
        googleDrive: {
          apiEndpoint: mock.url,
          authToken: "synthetic",
          oauthClientId: "synthetic",
          folderPath: "workspace",
          transactionTimeout: 50,
        },
        pull: { batchSize: 10 },
        push: { batchSize: 100 },
        live: false,
        waitForLeadership: false,
        retryTime: 20,
      });
      await repl.awaitInitialReplication();
    },
    async close() {
      if (repl) await repl.cancel();
      await db.close();
    },
    async conflicts() {
      return [];
    },
    status() {
      return { state: "UNKNOWN", pending: "UNKNOWN" };
    },
  };
}
export async function selfReplica(
  name,
  mock,
  provider = "drive",
  policy = "default",
) {
  const cache = indexedDbCache(name);
  const store = await selfstore("byos", {
    cache,
    autoSync: false,
    multiTab: false,
    debounceMs: 2147483647,
    sync: policy === "manual" ? { fallback: "manual" } : undefined,
  });
  // Native target APIs; only fetch origin is redirected. Target identity is retained in cache.
  let target,
    connected = false;
  if (provider === "drive") {
    if (!mock.files.has("selfstore"))
      mock.create({ id: "selfstore", name: "byos.zip" });
    target = await driveTarget.adopt(
      { auth, kv: cache.kv, fileName: "byos.zip" },
      "selfstore",
    );
  } else
    target =
      (await webdavTarget.fromSession({ kv: cache.kv })) ??
      (await webdavTarget.connect({
        kv: cache.kv,
        config: {
          url: mock.url + "/dav/backup.zip",
          username: "synthetic",
          password: "synthetic",
        },
      }));
  if (!target) throw new Error("native target unavailable");
  return {
    kind: "selfstore",
    name,
    store,
    cache,
    async connect() {
      await store.connectTarget(target);
      connected = true;
    },
    async put(p) {
      await store.put("pages", p);
      await store.flush();
    },
    async putAll(ps) {
      await store.putAll("pages", ps);
      await store.flush();
    },
    async remove(id) {
      await store.remove("pages", id);
      await store.flush();
    },
    async read() {
      return structuredClone(store.all("pages"));
    },
    async sync() {
      if (!connected) {
        await store.connectTarget(target);
        connected = true;
      } else await store.sync();
    },
    async close() {
      store.dispose();
    },
    async conflicts() {
      return store.state.journal;
    },
    status() {
      return structuredClone(store.status);
    },
  };
}
export async function replica(engine, name, mock, provider, policy) {
  return engine === "rxdb"
    ? rxReplica(name, mock)
    : selfReplica(name, mock, provider, policy);
}

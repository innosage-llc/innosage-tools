import { selfstore } from "selfstore";
window.openStore = async () => {
  window.store = await selfstore("byos-browser", {
    autoSync: false,
    multiTab: false,
    debounceMs: 2147483647,
  });
  return window.store.all("pages");
};
window.savePage = async (body) => {
  await window.store.put("pages", {
    id: "browser-page",
    parentId: null,
    body,
    editIds: [body],
  });
  await window.store.flush();
  return window.store.all("pages");
};
import { createRxDatabase } from "rxdb";
import { getRxStorageDexie } from "rxdb/plugins/storage-dexie";
window.openRx = async () => {
  window.rx = await createRxDatabase({
    name: "byosbrowserrx",
    storage: getRxStorageDexie(),
    multiInstance: false,
  });
  await window.rx.addCollections({
    pages: {
      schema: {
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
      },
    },
  });
  return (await window.rx.pages.find().exec()).map((d) => d.toJSON());
};
window.saveRx = async (body) => {
  await window.rx.pages.upsert({
    id: "browser-page",
    parentId: null,
    body,
    editIds: [body],
  });
};
window.connectWebdav = (url) =>
  window.store.connectWebdav({
    url,
    username: "synthetic",
    password: "synthetic",
  });

import { replicateGoogleDrive } from "rxdb/plugins/replication-google-drive";
window.syncRx = async (url) => {
  const replication = await replicateGoogleDrive({
    collection: window.rx.pages,
    replicationIdentifier: "browser-byos",
    googleDrive: {
      apiEndpoint: url,
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
  window.replicationErrors = [];
  replication.error$.subscribe((e) => window.replicationErrors.push(String(e)));
  await replication.awaitInitialReplication();
  await replication.awaitInSync();
};
window.readNative = async (engine) =>
  engine === "rxdb"
    ? (await window.rx.pages.find().exec()).map((d) => d.toJSON())
    : window.store.all("pages");
window.nativeStatus = (engine) =>
  engine === "rxdb"
    ? { state: "UNKNOWN", pending: "UNKNOWN" }
    : structuredClone(window.store.status);

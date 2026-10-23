import { createRxDatabase } from "rxdb";
import { getRxStorageDexie } from "rxdb/plugins/storage-dexie";
import { canonical, validateRevisions, project } from "./revisions.mjs";
const schema = {
  version: 0,
  primaryKey: "id",
  type: "object",
  properties: {
    id: { type: "string", maxLength: 160 },
    payload: { type: "string" },
  },
  required: ["id", "payload"],
};
// Single owner per local database, native RxDB/Dexie persistence, immutable rows.
// The local queue never awaits a remote operation. Network queue lives elsewhere.
export async function openStore(name) {
  const db = await createRxDatabase({
    name,
    storage: getRxStorageDexie(),
    multiInstance: false,
  });
  await db.addCollections({ revisions: { schema }, events: { schema } });
  let localQueue = Promise.resolve(),
    localError = null;
  const exclusive = (fn) => {
    const result = localQueue.then(fn);
    localQueue = result.catch(() => {});
    return result;
  };
  const read = async () =>
    (await db.revisions.find().exec()).map((d) => JSON.parse(d.payload));
  const events = async () =>
    (await db.events.find().exec())
      .map((d) => JSON.parse(d.payload))
      .sort((a, b) => a.sequence - b.sequence);
  return {
    name,
    read,
    events,
    async append(revisions) {
      return exclusive(async () => {
        try {
          const existing = await read();
          const checked = await validateRevisions([...existing, ...revisions]);
          const known = new Set(existing.map((r) => r.revisionId));
          const fresh = checked.revisions.filter(
            (r) => !known.has(r.revisionId),
          );
          if (fresh.length) {
            const result = await db.revisions.bulkInsert(
              fresh.map((r) => ({ id: r.revisionId, payload: canonical(r) })),
            );
            if (result.error.length)
              throw new Error("LOCAL_ERROR: durable revision insertion failed");
          }
          localError = null;
          // Resolves only after RxDB's storage write succeeds. No cloud work here.
          return {
            state: "local-saved",
            acknowledged: revisions.map((r) => ({
              revisionId: r.revisionId,
              hash: r.hash,
            })),
          };
        } catch (error) {
          localError = String(error.message);
          throw error;
        }
      });
    },
    async event(value) {
      return exclusive(async () => {
        const history = await events();
        const event = {
          ...value,
          sequence: (history.at(-1)?.sequence ?? 0) + 1,
        };
        await db.events.insert({
          id: crypto.randomUUID(),
          payload: canonical(event),
        });
        return event;
      });
    },
    async status(target) {
      const revisions = await read(),
        projection = project(revisions),
        history = (await events()).filter((e) => e.target === target);
      const latest = history.at(-1),
        receipt = history.findLast((e) => e.receipt)?.receipt ?? null;
      const covered = new Map(
        receipt?.revisions.map((r) => [r.revisionId, r.hash]) ?? [],
      );
      const pending = revisions
        .filter((r) => covered.get(r.revisionId) !== r.hash)
        .map((r) => r.revisionId)
        .sort();
      const local = localError
        ? "local-error"
        : projection.some((p) => p.incomplete)
          ? "incomplete"
          : projection.some((p) => p.conflict)
            ? "conflict"
            : "local-saved";
      return {
        local,
        localError,
        remote:
          latest?.state === "verified"
            ? pending.length
              ? "pending"
              : "verified-revision-set"
            : (latest?.state ?? "pending"),
        pending,
        receipt,
        projection,
      };
    },
    async close() {
      await localQueue;
      await db.close();
    },
  };
}

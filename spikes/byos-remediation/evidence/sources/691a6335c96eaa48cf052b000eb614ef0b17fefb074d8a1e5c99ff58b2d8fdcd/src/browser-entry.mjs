import { openStore } from "./store.mjs";
import { client, target } from "./protocol.mjs";

window.openReplica = async (name) => {
  window.replica = await openStore(name);
  window.boundary = null;
};
window.saveRevisions = (revisions) => window.replica.append(revisions);
window.inspectReplica = async (destination) => ({
  rows: await window.replica.read(),
  state: await window.replica.status(destination),
});
window.syncReplica = async ({ origin, provider, stopAt }) => {
  const destination = target(origin, provider);
  window.transport = client(window.replica, destination, {
    requestTimeoutMs: 2500,
    deadlineMs: 12000,
    barrier: async (point, value) => {
      if (point !== stopAt) return;
      window.boundary = { point, value, inspection: await window.inspectReplica(destination.id) };
      await new Promise((resolve) => { window.releaseBoundary = resolve; });
    },
  });
  const result = await window.transport.sync();
  return { outcome: result.outcome, attempts: result.attempts, trace: result.trace };
};

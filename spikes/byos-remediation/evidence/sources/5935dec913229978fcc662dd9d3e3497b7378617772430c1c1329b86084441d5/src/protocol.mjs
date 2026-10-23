import {
  canonical,
  decodeSnapshot,
  snapshot,
  validateRevisions,
} from "./revisions.mjs";
export function target(origin, provider = "drive") {
  const u = new URL(origin);
  if (
    u.protocol !== "http:" ||
    u.hostname !== "127.0.0.1" ||
    u.username ||
    u.password ||
    u.pathname !== "/"
  )
    throw new Error("Only an explicit loopback mock origin is supported");
  if (!["drive", "webdav"].includes(provider))
    throw new Error("Unsupported provider fixture");
  const read =
    provider === "drive"
      ? `${u.origin}/drive/v3/files/byos-remediation-v1?alt=media`
      : `${u.origin}/dav/backup.zip`;
  return {
    id: `${provider}:${read}`,
    read,
    write:
      provider === "drive"
        ? `${u.origin}/upload/drive/v3/files/byos-remediation-v1?uploadType=media`
        : read,
    method: provider === "drive" ? "PATCH" : "PUT",
  };
}
function assertLoopback(url) {
  const u = new URL(url);
  if (
    u.protocol !== "http:" ||
    u.hostname !== "127.0.0.1" ||
    u.username ||
    u.password
  )
    throw new Error("Only loopback transport is supported");
}
const strongEtag = (etag) =>
  typeof etag === "string" && /^"[^"\r\n]+"$/.test(etag);
const covered = (expected, actual) => {
  const hashes = new Map(actual.map((r) => [r.revisionId, r.hash]));
  return expected.every((r) => hashes.get(r.revisionId) === r.hash);
};
class ProtocolError extends Error {
  constructor(state, message) {
    super(message);
    this.state = state;
  }
}
// Custom fixed-object CAS, NOT RxDB replication or a native provider adapter.
// Correctness assumes complete atomic GET bodies + strong validators + atomic
// If-Match on this isolated versioned object. No initial discovery or auth here.
export function client(
  store,
  remote,
  {
    maxAttempts = 4,
    deadlineMs = 4000,
    requestTimeoutMs = 500,
    fetcher = globalThis.fetch,
    barrier = async () => {},
  } = {},
) {
  assertLoopback(remote.read);
  assertLoopback(remote.write);
  if (new URL(remote.read).origin !== new URL(remote.write).origin)
    throw new Error("Snapshot read/write must share an origin");
  let running = null;
  const syncOnce = async () => {
    const started = performance.now(),
      trace = [];
    await store.event({
      target: remote.id,
      state: "verification-unknown",
      reason: "sync started; no new readback receipt yet",
    });
    const request = async (url, init = {}) => {
      assertLoopback(url);
      const remaining = deadlineMs - (performance.now() - started);
      if (remaining <= 0)
        throw new ProtocolError(
          "verification-unknown",
          "recovery deadline exhausted",
        );
      const response = await fetcher(url, {
        ...init,
        signal: AbortSignal.timeout(
          Math.max(1, Math.min(requestTimeoutMs, Math.floor(remaining))),
        ),
        redirect: "error",
      });
      const text = await response.text();
      trace.push({
        method: init.method ?? "GET",
        endpoint: url,
        status: response.status,
        etag: response.headers.get("etag"),
        ifMatch: init.headers?.["If-Match"] ?? null,
      });
      if (response.status === 401)
        throw new ProtocolError("blocked-reauth", "HTTP 401");
      if (response.status === 403) {
        let reason;
        try {
          const data = JSON.parse(text);
          reason = data.error?.errors?.[0]?.reason ?? data.error?.message;
        } catch {
          /* unknown denial fails closed */
        }
        if (!["rateLimitExceeded", "userRateLimitExceeded"].includes(reason))
          throw new ProtocolError(
            "blocked",
            "HTTP 403: access denied or unknown reason",
          );
      }
      if (response.status === 404)
        throw new ProtocolError(
          "blocked",
          "known snapshot missing; discovery/creation is not implemented",
        );
      return { response, text };
    };
    const read = async () => {
      const { response, text } = await request(remote.read);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const etag = response.headers.get("etag");
      if (!strongEtag(etag))
        throw new ProtocolError(
          "blocked",
          "strong ETag missing from snapshot GET",
        );
      let revisions;
      try {
        revisions = await decodeSnapshot(JSON.parse(text));
      } catch (e) {
        throw new ProtocolError("blocked", e.message);
      }
      return { etag, revisions };
    };
    let lastError;
    for (
      let attempt = 1;
      attempt <= maxAttempts && performance.now() - started < deadlineMs;
      attempt++
    ) {
      try {
        const observed = await read();
        await barrier("after-read", { attempt, ...observed });
        // Preserve everything ever loaded before attempting any remote write.
        await store.append(observed.revisions);
        const local = await store.read();
        let union;
        try {
          union = (
            await validateRevisions([...observed.revisions, ...local], {
              complete: true,
            })
          ).revisions;
        } catch (e) {
          throw new ProtocolError("blocked", e.message);
        }
        if (!covered(union, observed.revisions)) {
          const { response } = await request(remote.write, {
            method: remote.method,
            headers: {
              "Content-Type": "application/json",
              "If-Match": observed.etag,
            },
            body: canonical(snapshot(union)),
          });
          if (response.status === 412) {
            trace.push({ boundary: "CAS-reload", attempt });
            continue;
          }
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          await barrier("after-write-response", { attempt, revisions: union });
        }
        // Always content-readback; upload success alone never produces a receipt.
        const verified = await read();
        if (!covered(union, verified.revisions))
          throw new Error("readback does not cover attempted revision set");
        await store.append(verified.revisions);
        const receipt = {
          target: remote.id,
          remoteVersion: verified.etag,
          verifiedAt: new Date().toISOString(),
          revisions: verified.revisions.map(({ revisionId, hash }) => ({
            revisionId,
            hash,
          })),
          scope:
            "These exact revision IDs and hashes were present in this GET at this time/version; not global completeness or future presence.",
        };
        await barrier("before-receipt", { attempt, receipt });
        await store.event({ target: remote.id, state: "verified", receipt });
        await barrier("after-receipt", { attempt, receipt });
        return {
          outcome: "verified",
          attempts: attempt,
          trace,
          status: await store.status(remote.id),
          elapsedMs: performance.now() - started,
        };
      } catch (error) {
        lastError = error;
        trace.push({
          attempt,
          error: error.message,
          state: error.state ?? "verification-unknown",
        });
        if (
          error.state === "blocked" ||
          error.state === "blocked-reauth" ||
          error.message.startsWith("INTEGRITY:") ||
          error.message.startsWith("INCOMPLETE:")
        )
          break;
        const remaining = deadlineMs - (performance.now() - started);
        if (attempt < maxAttempts && remaining > 0)
          await new Promise((resolve) =>
            setTimeout(
              resolve,
              Math.min(20 * 2 ** (attempt - 1), 100, remaining),
            ),
          );
      }
    }
    const state =
      lastError?.state ??
      (lastError?.message.startsWith("INTEGRITY:") ||
      lastError?.message.startsWith("INCOMPLETE:")
        ? "blocked"
        : "verification-unknown");
    await store.event({
      target: remote.id,
      state,
      reason: lastError?.message ?? "bounded CAS attempts exhausted",
    });
    return {
      outcome: state,
      attempts: trace.filter((r) => r.boundary === "CAS-reload" || r.error)
        .length,
      trace,
      status: await store.status(remote.id),
      elapsedMs: performance.now() - started,
    };
  };
  return {
    sync() {
      if (!running)
        running = syncOnce().finally(() => {
          running = null;
        });
      return running;
    },
    async status() {
      const state = await store.status(remote.id);
      return running ? { ...state, remote: "syncing" } : state;
    },
  };
}

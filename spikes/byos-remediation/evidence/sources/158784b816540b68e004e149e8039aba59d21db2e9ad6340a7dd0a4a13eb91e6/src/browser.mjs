import assert from "node:assert/strict";
import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";
import { mock } from "../../byos-sync/src/mock.mjs";
import { canonical, revision, snapshot } from "./revisions.mjs";
import { target } from "./protocol.mjs";
import { sha } from "./matrix.mjs";

const bounded = async (promise, ms = 15000) => {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Browser boundary/recovery deadline")), ms); })]); }
  finally { clearTimeout(timer); }
};
async function until(condition, ms = 10000) {
  const start = performance.now();
  while (!(await condition())) {
    if (performance.now() - start > ms) throw new Error("Requested browser fault barrier not reached");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
function inspect(inspection, remoteRows, required, phase) {
  const { rows, state } = inspection;
  const actual = new Map(rows.map((r) => [r.revisionId, canonical(r)]));
  const missing = required.filter((r) => actual.get(r.revisionId) !== canonical(r)).map((r) => r.revisionId);
  const remote = new Map(remoteRows.map((r) => [r.revisionId, r.hash]));
  const covered = new Map(state.receipt?.revisions.map((r) => [r.revisionId, r.hash]) ?? []);
  const pending = rows.filter((r) => covered.get(r.revisionId) !== r.hash).map((r) => r.revisionId).sort();
  const falseLocal = state.local === "local-saved" && (missing.length > 0 || state.projection.some((p) => p.incomplete || p.conflict || p.recoveryNeeded));
  const falseVerified = state.receipt?.revisions.some((r) => remote.get(r.revisionId) !== r.hash) ?? false;
  const falsePending = canonical(pending) !== canonical(state.pending);
  const observation = { phase, local: state.local, remote: state.remote, localBodyDigest: sha(rows), expectedBodies: required, pending: state.pending, receipt: state.receipt, missing, falseLocal, falseVerified, falsePending };
  assert.equal(missing.length, 0, `full body missing: ${phase}`);
  assert.equal(falseLocal || falseVerified || falsePending, false, `false state: ${phase}`);
  return observation;
}

export async function browserMatrix() {
  const entry = fileURLToPath(new URL("./browser-entry.mjs", import.meta.url));
  const output = fileURLToPath(new URL("../.browser-bundle.js", import.meta.url));
  await build({ entryPoints: [entry], bundle: true, outfile: output, platform: "browser", format: "iife", define: { global: "globalThis" } });
  const bundle = await readFile(output);
  const server = http.createServer((req, res) => {
    if (req.url === "/bundle.js") { res.setHeader("content-type", "application/javascript"); res.end(bundle); }
    else res.end('<!doctype html><title>Offline immutable revision crash fixture</title><script src="/bundle.js"></script>');
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const origin = `http://127.0.0.1:${server.address().port}`, results = [];
  let browser;
  const boundaries = ["after-local-ack", "before-remote-mutation", "after-mutation-before-response", "after-write-response", "before-receipt", "after-receipt"];
  try {
    browser = await chromium.launch({ headless: true });
    for (const provider of ["drive", "webdav"]) for (const boundary of boundaries) {
      const remote = await mock();
      remote.create({ id: provider === "drive" ? "byos-remediation-v1" : "dav", name: "byos-remediation-v1.json" }, Buffer.from(canonical(snapshot([]))));
      const destination = target(remote.url, provider), contexts = [], externalRequests = [];
      const row = { provider, boundary, browser: browser.version(), persistence: "real Chromium IndexedDB / native RxDB Dexie", crashType: "renderer Page.crash; not whole-browser/OS/power loss", status: "RUNNING", observations: [] };
      const remoteRows = () => JSON.parse([...remote.files.values()][0].body.toString()).revisions;
      const open = async (context) => { const page = await context.newPage(); await page.goto(origin); await page.evaluate(() => window.openReplica("crashfixture")); return page; };
      const sync = (page, stopAt) => bounded(page.evaluate((options) => window.syncReplica(options), { origin: remote.url, provider, stopAt }));
      const observe = async (page, expected, phase) => {
        const state = await page.evaluate((id) => window.inspectReplica(id), destination.id);
        const observation = inspect(state, remoteRows(), expected, phase); row.observations.push(observation); return state;
      };
      try {
        for (let i = 0; i < 3; i++) {
          const context = await browser.newContext(); contexts.push(context);
          await context.route("**/*", (route) => {
            if ([origin, remote.url].includes(new URL(route.request().url()).origin)) return route.continue();
            externalRequests.push(route.request().url()); return route.abort();
          });
        }
        let a = await open(contexts[0]); const b = await open(contexts[1]);
        row.storageProof = await a.evaluate(() => window.storageCapability);
        const root = await revision({ revisionId: "browser-root", pageId: "browser-page", body: "Full browser baseline" });
        const editA = await revision({ ...root, revisionId: "browser-edit-a", parents: [root.revisionId], body: `Complete acknowledged renderer-crash edit A ${boundary}` });
        const editB = await revision({ ...root, revisionId: "browser-edit-b", parents: [root.revisionId], body: `Complete independent replica edit B ${boundary}` });
        await a.evaluate((rows) => window.saveRevisions(rows), [root]); assert.equal((await sync(a)).outcome, "verified"); assert.equal((await sync(b)).outcome, "verified");
        row.localAck = await a.evaluate((rows) => window.saveRevisions(rows), [editA]);
        await observe(a, [root, editA], "after-local-durable-ack");
        let syncing, fault;
        if (boundary !== "after-local-ack") {
          fault = { method: destination.method, bodyContains: editA.revisionId, kind: boundary === "before-remote-mutation" ? "hold-before-write" : boundary === "after-mutation-before-response" ? "hold-after-write" : "observe" };
          remote.faults.push(fault);
          syncing = sync(a, ["after-write-response", "before-receipt", "after-receipt"].includes(boundary) ? boundary : undefined).catch((e) => ({ interrupted: e.message }));
          if (boundary === "before-remote-mutation" || boundary === "after-mutation-before-response") await until(() => fault.used && (boundary === "before-remote-mutation" || fault.matched.mutation_applied));
          else await until(() => a.evaluate(() => Boolean(window.boundary)));
          row.faultReceipt = structuredClone(fault);
          assert.equal(fault.used, true);
          assert.equal(fault.matched.mutation_applied, boundary !== "before-remote-mutation");
          assert.equal(fault.matched.response_delivered, !["before-remote-mutation", "after-mutation-before-response"].includes(boundary));
          if (["after-write-response", "before-receipt", "after-receipt"].includes(boundary)) {
            row.browserBarrier = await a.evaluate(() => window.boundary);
            assert.equal(row.browserBarrier.point, boundary);
          }
        }
        const beforeCrash = await observe(a, [root, editA], "at-proven-crash-boundary");
        assert.equal(beforeCrash.state.pending.includes(editA.revisionId), boundary !== "after-receipt");
        const cdp = await contexts[0].newCDPSession(a);
        const crashed = new Promise((resolve) => a.once("crash", () => resolve(true)));
        cdp.send("Page.crash").catch(() => {});
        row.rendererCrashed = await bounded(crashed);
        await a.close().catch(() => {});
        if (syncing) row.interruptedSync = await syncing;
        a = await open(contexts[0]);
        const reopened = await observe(a, [root, editA], "same-context-after-renderer-reopen");
        assert.equal(reopened.state.pending.includes(editA.revisionId), boundary !== "after-receipt");
        assert.notEqual(reopened.state.remote, "syncing");
        await b.evaluate((rows) => window.saveRevisions(rows), [editB]);
        await observe(b, [root, editB], "independent-replica-local-ack");
        const recoveryStart = performance.now();
        for (const page of [a, b, a, b]) assert.equal((await sync(page)).outcome, "verified");
        row.stableRecoveryMs = performance.now() - recoveryStart;
        const cold = await open(contexts[2]); assert.equal((await sync(cold)).outcome, "verified");
        for (const [i, page] of [a, b, cold].entries()) {
          const state = await observe(page, [root, editA, editB], `restored-conflicts-${i}`);
          assert.equal(state.state.local, "conflict"); assert.equal(state.state.pending.length, 0);
          assert.equal(state.state.projection[0].heads.length, 2);
        }
        row.falseStateCount = row.observations.filter((o) => o.falseLocal || o.falseVerified || o.falsePending).length;
        row.acknowledgedEditCount = 2; row.recoveredEditCount = row.observations.at(-1).expectedBodies.filter((r) => r.revisionId !== root.revisionId).length;
        assert.equal(externalRequests.length, 0);
        row.status = "PASS";
      } catch (error) { row.status = "FAIL"; row.error = { message: error.message, stack: error.stack }; }
      finally { row.requests = remote.requests; row.externalRequestsBlocked = externalRequests; for (const context of contexts) await context.close(); await remote.close(); results.push(row); }
      console.log(JSON.stringify({ stage: "browser", provider, boundary, status: row.status }));
      if (row.status !== "PASS") return { passed: false, results, plannedCases: 12 };
    }
    return { passed: results.length === 12, results, plannedCases: 12 };
  } catch (error) { return { passed: false, results, error: { message: error.message, stack: error.stack } }; }
  finally { await browser?.close(); server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
}

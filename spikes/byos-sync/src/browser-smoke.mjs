import { sourceManifest } from "./manifest.mjs";
const source_manifest = await sourceManifest();
import { build } from "esbuild";
import { chromium } from "playwright";
import http from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { mock } from "./mock.mjs";
await build({
  entryPoints: ["src/browser-entry.mjs"],
  bundle: true,
  outfile: ".browser-bundle.js",
  platform: "browser",
  format: "iife",
  define: { global: "globalThis" },
});
const bundle = await readFile(".browser-bundle.js");
const server = http.createServer((req, res) => {
  if (req.url === "/bundle.js") {
    res.setHeader("Content-Type", "application/javascript");
    res.end(bundle);
  } else
    res.end(
      '<!doctype html><title>Offline BYOS persistence smoke</title><script src="/bundle.js"></script>',
    );
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${server.address().port}`,
  m = await mock();
let browser;
const results = [];
try {
  browser = await chromium.launch({ headless: true });
  for (const engine of ["selfstore", "rxdb"]) {
    const r = {
      engine,
      version: engine === "selfstore" ? "1.8.29" : "17.6.0",
      test: "two isolated Chromium IndexedDB contexts; abrupt renderer crash after local durability ACK",
      provider:
        engine === "selfstore"
          ? "native WebDAV pending-offline persistence"
          : "NOT_RUN: local Dexie persistence only",
      network: "loopback only",
      status: "NOT_RUN",
    };
    const contexts = await Promise.all([
      browser.newContext(),
      browser.newContext(),
    ]);
    for (const context of contexts)
      await context.route("**/*", (route) =>
        [url, m.url].includes(new URL(route.request().url()).origin)
          ? route.continue()
          : route.abort(),
      );
    let pages = await Promise.all(contexts.map((c) => c.newPage()));
    for (const p of pages) {
      p.on("pageerror", (e) => console.error("BUNDLE_ERROR", e.message));
      await p.goto(url);
      await p.evaluate(
        (e) => (e === "selfstore" ? window.openStore() : window.openRx()),
        engine,
      );
    }
    if (engine === "selfstore") {
      m.control.offline = false;
      for (const p of pages)
        await p.evaluate(
          (u) => window.connectWebdav(u),
          m.url + "/dav/backup.zip",
        );
      m.control.offline = true;
    }
    for (let i = 0; i < pages.length; i++)
      await pages[i].evaluate(
        ({ engine, body }) =>
          engine === "selfstore" ? window.savePage(body) : window.saveRx(body),
        { engine, body: "browser-" + i },
      );
    for (let i = 0; i < pages.length; i++) {
      const session = await contexts[i].newCDPSession(pages[i]);
      await Promise.race([
        session.send("Page.crash").catch(() => {}),
        new Promise((resolve) => pages[i].once("crash", resolve)),
      ]);
      await pages[i].close().catch(() => {});
    }
    pages = await Promise.all(contexts.map((c) => c.newPage()));
    const records = [];
    for (const p of pages) {
      p.on("pageerror", (e) => console.error("BUNDLE_ERROR", e.message));
      await p.goto(url);
      records.push(
        await p.evaluate(
          (e) => (e === "selfstore" ? window.openStore() : window.openRx()),
          engine,
        ),
      );
    }
    r.records = records;
    r.browser = browser.version();
    r.status =
      records[0][0]?.body === "browser-0" && records[1][0]?.body === "browser-1"
        ? "PASS"
        : "FAIL";
    results.push(r);
    for (const context of contexts) await context.close();
  }
  // Each boundary uses a fresh provider and persistent browser context. A second
  // independent context proves native propagation after renderer recovery.
  for (const engine of ["rxdb", "selfstore"])
    for (const boundary of [
      "before-mutation",
      "after-mutation-before-response",
      "after-ack",
    ]) {
      const remote = await mock();
      const contexts = [await browser.newContext(), await browser.newContext()];
      const r = {
        engine,
        provider: engine === "rxdb" ? "drive" : "webdav",
        test: "native remote-ACK renderer crash",
        boundary,
        status: "NOT_RUN",
        configuration:
          "real IndexedDB; manual native sync, two RxDB foreground cycles per trigger; RxDB transactionTimeout=50 retryTime=20; selfstore autoSync=false",
        browser: browser.version(),
        native_synced_claim: "UNKNOWN unless native status recorded",
      };
      let p;
      const bounded = (promise, ms = 15000) =>
        Promise.race([
          promise,
          new Promise((_, reject) => {
            const timer = setTimeout(
              () => reject(new Error("bounded browser recovery deadline")),
              ms,
            );
            timer.unref();
          }),
        ]);
      const open = async (context) => {
        const page = await context.newPage();
        await page.goto(url);
        await page.evaluate(
          (e) => (e === "rxdb" ? window.openRx() : window.openStore()),
          engine,
        );
        return page;
      };
      const sync = (page) =>
        page.evaluate(
          async ({ engine, endpoint }) => {
            if (engine === "rxdb") {
              await window.syncRx(endpoint);
              await window.syncRx(endpoint);
            } else {
              if (!window.connected) {
                await window.connectWebdav(endpoint + "/dav/backup.zip");
                window.connected = true;
              } else await window.store.sync();
            }
            return window.nativeStatus(engine);
          },
          { engine, endpoint: remote.url },
        );
      try {
        for (const context of contexts)
          await context.route("**/*", (route) =>
            [url, remote.url].includes(new URL(route.request().url()).origin)
              ? route.continue()
              : route.abort(),
          );
        p = await open(contexts[0]);
        await p.evaluate(
          (e) =>
            e === "rxdb"
              ? window.saveRx("baseline")
              : window.savePage("baseline"),
          engine,
        );
        await bounded(sync(p));
        remote.control.offline = true;
        const intent = engine + ":" + boundary;
        await bounded(
          p.evaluate(
            ({ e, intent }) =>
              e === "rxdb" ? window.saveRx(intent) : window.savePage(intent),
            { e: engine, intent },
          ),
        );
        r.local_ack = await p.evaluate((e) => window.readNative(e), engine);
        remote.control.offline = false;
        const target =
          engine === "rxdb"
            ? [...remote.files.values()].find(
                (f) => f.name === "browser-page.json",
              )
            : remote.files.get("dav");
        if (!target)
          throw new Error(
            "Missing cold payload object: " +
              JSON.stringify(
                [...remote.files.values()].map((f) => ({
                  name: f.name,
                  body: f.body.toString(),
                })),
              ) +
              " errors=" +
              JSON.stringify(await p.evaluate(() => window.replicationErrors)),
          );
        const fault = {
          method: "PUT",
          fileId: target.id,
          fileName: target.name,
          ...(engine === "rxdb" ? { bodyContains: intent } : {}),
          kind:
            boundary === "before-mutation"
              ? "hold-before-write"
              : boundary === "after-ack"
                ? "observe"
                : "hold-after-write",
        };
        remote.faults.push(fault);
        const syncing = sync(p).catch((e) => ({ error: e.message }));
        if (boundary === "after-ack") r.status_at_ack = await bounded(syncing);
        else
          await bounded(
            (async () => {
              const deadline = Date.now() + 14000;
              while (
                !fault.used ||
                (boundary === "after-mutation-before-response" &&
                  !fault.matched.mutation_applied)
              ) {
                if (Date.now() > deadline)
                  throw new Error("Target barrier not reached");
                await new Promise((resolve) => setTimeout(resolve, 10));
              }
            })(),
          );
        r.boundary_receipt = structuredClone(fault);
        const session = await contexts[0].newCDPSession(p);
        const crashed = new Promise((resolve) =>
          p.once("crash", () => resolve(true)),
        );
        session.send("Page.crash").catch(() => {});
        r.renderer_crashed = await bounded(crashed);
        await p.close().catch(() => {});
        p = await open(contexts[0]);
        r.after_reopen = await p.evaluate((e) => window.readNative(e), engine);
        r.status_before_resync = await p.evaluate(
          (e) => window.nativeStatus(e),
          engine,
        );
        r.status_after_resync = await bounded(sync(p));
        const other = await open(contexts[1]);
        await bounded(sync(other));
        r.replicas = [
          await p.evaluate((e) => window.readNative(e), engine),
          await other.evaluate((e) => window.readNative(e), engine),
        ];
        r.intent_preserved_and_propagated = r.replicas.every((ps) =>
          ps.some((d) => d.body === intent && d.editIds.includes(intent)),
        );
        const match = r.boundary_receipt.matched;
        r.boundary_exercised = Boolean(
          match &&
            match.file_id === target.id &&
            (boundary === "before-mutation"
              ? !match.mutation_applied && !match.response_delivered
              : match.mutation_applied &&
                match.response_delivered === (boundary === "after-ack")),
        );
        r.status =
          r.boundary_exercised &&
          r.intent_preserved_and_propagated &&
          remote.unsupported.length === 0 &&
          r.local_ack.some(
            (d) => d.body === intent && d.editIds.includes(intent),
          ) &&
          r.after_reopen.some(
            (d) => d.body === intent && d.editIds.includes(intent),
          )
            ? "PASS"
            : "FAIL";
      } catch (e) {
        r.status = e.message.includes("deadline") ? "TIMEOUT" : "ERROR";
        r.error = e.message;
        r.boundary_receipt ??= structuredClone(remote.faults[0] ?? null);
      } finally {
        r.requests = remote.requests;
        r.unsupported = remote.unsupported;
        results.push(r);
        for (const context of contexts) await context.close();
        await remote.close();
      }
    }
  m.control.offline = false;
  m.control.cors = false;
  const context = await browser.newContext();
  await context.route("**/*", (route) =>
    [url, m.url].includes(new URL(route.request().url()).origin)
      ? route.continue()
      : route.abort(),
  );
  const p = await context.newPage();
  p.on("pageerror", (e) => console.error("BUNDLE_ERROR", e.message));
  await p.goto(url);
  await p.evaluate(() => window.openStore());
  const before = m.requests.length;
  const outcome = await p.evaluate(
    (u) => window.connectWebdav(u).catch((e) => ({ error: e.message })),
    m.url + "/dav/backup.zip",
  );
  results.push({
    engine: "selfstore",
    provider: "webdav",
    test: "native cross-origin target connection when server omits CORS",
    status:
      outcome === "cancelled" || outcome?.error?.includes("CORS")
        ? "PASS"
        : "FAIL",
    outcome,
    write_requests: m.requests.slice(before).filter((r) => r.method === "PUT")
      .length,
    browser: browser.version(),
  });
  await context.close();
} catch (e) {
  results.push({ status: "BLOCKED", error: e.message });
} finally {
  await browser?.close();
  await m.close();
  await new Promise((r) => server.close(r));
}
await mkdir("evidence", { recursive: true });
await writeFile(
  "evidence/browser-smoke.json",
  JSON.stringify({ source_manifest, results }, null, 2) + "\n",
);
console.log(results);

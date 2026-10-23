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
  m.control.offline = false;
  m.control.cors = false;
  const context = await browser.newContext();
  await context.route("**/*", (route) =>
    [url, m.url].includes(new URL(route.request().url()).origin)
      ? route.continue()
      : route.abort(),
  );
  const p = await context.newPage();
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

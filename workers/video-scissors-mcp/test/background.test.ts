import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { unstable_dev } from 'wrangler';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

test('actual hidden Chrome tab receives D1 long-poll command and becomes visible again', { timeout: 40_000 }, async () => {
  const { chromium } = await import(process.env.VIDEO_SCISSORS_PLAYWRIGHT_MODULE || 'playwright');
  const worker = await unstable_dev('test/fixture-worker.ts', { config: 'wrangler.jsonc', local: true, persist: false,
    experimental: { disableExperimentalWarning: true, disableDevRegistry: true }, logLevel: 'error' });
  const profile = await mkdtemp(join(tmpdir(), 'hub346-background-'));
  const chrome = spawn(process.env.VIDEO_SCISSORS_CHROME || chromium.executablePath(),
    [`--user-data-dir=${profile}`, '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });
  let browser;
  try {
    let port = '';
    for (let i = 0; i < 100 && !port; i++) {
      try { port = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; }
      catch { await delay(50); }
    }
    assert.ok(port, 'fresh task-owned Chrome must expose its local debugging port');
    // Official noDefaults mode avoids Playwright's per-session focus emulation.
    // Use ONLY this fresh default context, never a personal browser profile.
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { noDefaults: true });
    assert.equal((await worker.fetch('/fixture', { method: 'POST', body: JSON.stringify({ action: 'initialize-local-fixture' }) })).status, 200);
    const context = browser.contexts()[0];
    const page = await context.newPage();
    await page.goto(`http://${worker.address}:${worker.port}/tools/video-scissors`, { waitUntil: 'load' });
    const bundle = await build({ stdin: { contents: 'export {VideoScissorsController} from "../../lib/video-scissors.ts"; export {VideoScissorsRemoteAdapter} from "../../lib/video-scissors-remote.ts";', resolveDir: process.cwd() },
      bundle: true, format: 'iife', globalName: 'TestFoundation', write: false });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const pub = await page.evaluate(async () => {
      const F = globalThis.TestFoundation;
      const controller = new F.VideoScissorsController({ renderer: {
        inspect: async () => ({ duration: 30, width: 64, height: 64, framesPerSecond: 10, videoCodec: 'h264', audioCodec: 'aac' }),
        render: async () => new Blob(['synthetic-output']),
      }, createObjectURL: () => 'blob:synthetic', revokeObjectURL: () => {} });
      await controller.selectSource(new File(['synthetic'], 'NEVER_SEND_SYNTHETIC_FILENAME.mp4', { type: 'video/mp4' }));
      const call = async (action, data = {}, signal = undefined) => {
        const r = await fetch('/fixture', { method: 'POST', body: JSON.stringify({ action, ...data }), signal });
        if (!r.ok) throw new Error('LOCAL_FIXTURE_HTTP');
        return r.json();
      };
      const auth = await call('create');
      await call('bind', { auth, proof: auth.proof, handle: 'background-local-consent' });
      const driver = { task: null, metrics: null, adapter: null, start: null };
      const adapter = new F.VideoScissorsRemoteAdapter(controller, {
        publish: async metadata => { if (!await call('sync', { auth, metadata })) throw new Error('SYNC'); },
        claim: async (metadata, signal) => { const r = await call('poll', { auth, metadata }, signal); driver.metrics = r; return r.command; },
        report: async (id, result) => { if (!await call('report', { auth, id, state: result.status, metadata: result.metadata })) throw new Error('REPORT'); },
        cancellation: async id => call('cancellation', { auth, id }),
        revoke: async () => { await call('revoke', { auth }); },
      });
      driver.adapter = adapter;
      driver.start = () => { driver.task = adapter.pollOnce(); };
      globalThis.localBackgroundDriver = driver;
      await adapter.flushMetadata();
      return { project: auth.project, epoch: auth.epoch, metadata: adapter.metadata() };
    });
    await page.bringToFront();
    assert.equal(await page.evaluate(() => document.visibilityState), 'visible');
    await page.evaluate(() => globalThis.localBackgroundDriver.start());
    const other = await context.newPage();
    await other.goto(`http://${worker.address}:${worker.port}/tools/recorder`, { waitUntil: 'load' });
    await other.bringToFront();
    assert.equal(await page.evaluate(() => document.visibilityState), 'hidden');
    const before = Date.now();
    const admitted = await worker.fetch('/fixture', { method: 'POST', body: JSON.stringify({ action: 'admit',
      auth: { project: pub.project, epoch: pub.epoch }, command: { operationId: 'hidden-cut', kind: 'cut',
        generation: pub.metadata.generation, version: pub.metadata.version, clips: [{ start: 0, end: 2 }] } }) });
    assert.equal(admitted.status, 200);
    const observed = await page.evaluate(async () => {
      const d = globalThis.localBackgroundDriver;
      await d.task;
      return { visibility: document.visibilityState, metadata: d.adapter.metadata(), poll: d.metrics };
    });
    assert.equal(observed.visibility, 'hidden');
    assert.equal(observed.metadata.latestOperationId, 'hidden-cut');
    assert.equal(observed.metadata.hasOutput, true);
    assert.ok(observed.poll.checks <= 8 && observed.poll.queries <= 24);
    assert.equal(observed.poll.cpuMilliseconds, null);
    await page.bringToFront();
    assert.equal(await page.evaluate(() => document.visibilityState), 'visible');
    console.log('hidden-background-poll-metrics', JSON.stringify({ hiddenDelivery: true, visibleAgain: true,
      deliveryWallMilliseconds: Date.now() - before,
      checks: observed.poll.checks, sqlQueries: observed.poll.queries, rowsRead: observed.poll.rowsRead,
      rowsWritten: observed.poll.rowsWritten, dbMilliseconds: observed.poll.dbMilliseconds, cpuMilliseconds: null }));
    await page.evaluate(() => globalThis.localBackgroundDriver.adapter.dispose());
    await context.close();
  } finally {
    await browser?.close();
    if (chrome.exitCode === null) {
      const exited = new Promise(resolve => chrome.once('exit', resolve));
      chrome.kill('SIGTERM');
      await exited;
    }
    await worker.stop();
    await rm(profile, { recursive: true, force: true });
  }
});

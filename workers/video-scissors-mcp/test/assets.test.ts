import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unstable_dev } from 'wrangler';

test('actual local ASSETS serves existing Tools export /tools paths and assets; unfinished auth fails closed', async () => {
  const worker = await unstable_dev('src/index.ts', { config: 'wrangler.jsonc', local: true,
    experimental: { disableExperimentalWarning: true }, logLevel: 'error' });
  try {
    const page = await worker.fetch('/tools/video-scissors');
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /Local Video Scissors|Video Scissors|Video scissors/);
    const urls = [...new Set([...html.matchAll(/(?:src|href)="(\/tools\/_next\/[^"?]+)(?:\?[^\"]*)?"/g)].map(m => m[1]))];
    assert.ok(urls.length > 0);
    for (const url of urls) {
      const r = await worker.fetch(url);
      assert.equal(r.status, 200, url);
      assert.doesNotMatch(r.headers.get('content-type') ?? '', /text\/html/, url);
    }
    assert.equal((await worker.fetch('/tools/video-scissors/demo.mp4')).status, 200);
    for (const path of ['/mcp','/authorize','/oauth/register','/remote/projects']) {
      assert.equal((await worker.fetch(path)).status, 503);
    }
  } finally { await worker.stop(); }
});

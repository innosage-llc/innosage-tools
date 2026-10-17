import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { unstable_dev } from 'wrangler';

const fixture = '../../public/video-scissors/demo.mp4';
const key = 'ab'.repeat(32);

test('local D browser: Cut 1, Cut 2, Undo 2, reconnect with fresh consent, revoke', { timeout: 240_000 }, async () => {
  const playwrightModule = process.env.VIDEO_SCISSORS_PLAYWRIGHT_MODULE || 'playwright';
  const { chromium } = await import(playwrightModule);
  const chromePath = process.env.VIDEO_SCISSORS_CHROME || [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome', '/usr/bin/chromium',
  ].find(existsSync);
  const worker = await unstable_dev('src/index-d.ts', {
    config: 'wrangler.d-local.template.jsonc', local: true, localProtocol: 'https', persist: false,
    vars: { EXPERIMENT_ENABLED: 'true', D_ROUTING_HMAC_KEY: key },
    experimental: { disableExperimentalWarning: true, disableDevRegistry: true }, logLevel: 'error',
  });
  const scratch = await mkdtemp(join(tmpdir(), 'video-scissors-d-browser-'));
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let workerHttpRequests = 0;
  const browserRequests: Array<{ origin: string; path: string; body: string | null }> = [];
  const callbacks: string[] = [];
  const projects: Array<{ project: string; epoch: number; credential: string }> = [];
  let wakeSockets = 0;

  try {
    assert.ok(chromePath || existsSync(chromium.executablePath()), 'Set VIDEO_SCISSORS_CHROME or install Playwright Chromium');
    browser = await chromium.launch({ headless: true, ...(chromePath ? { executablePath: chromePath } : {}) });
    const context = await browser.newContext({ acceptDownloads: true, ignoreHTTPSErrors: true });
    context.setDefaultTimeout(20_000);
    const origin = `https://${worker.address}:${worker.port}`;
    const page = await context.newPage();
    page.on('pageerror', error => console.log('local-d-page-error', error.message.replace(/https?:\/\/\S+/g, '<url>')));
    page.on('request', request => {
      const url = new URL(request.url());
      if (url.protocol === 'http:' || url.protocol === 'https:') {
        browserRequests.push({ origin: url.origin, path: url.pathname, body: request.postData() });
      }
    });
    page.on('websocket', socket => {
      wakeSockets++;
      assert.equal(new URL(socket.url()).host, new URL(origin).host, 'wakeup socket stays on the local D worker');
    });
    page.on('response', async response => {
      if (new URL(response.url()).pathname !== '/remote/projects') return;
      const body = await response.json().catch(() => null) as { project?: unknown; epoch?: unknown; credential?: unknown } | null;
      if (typeof body?.project === 'string' && typeof body.epoch === 'number' && typeof body.credential === 'string') {
        projects.push({ project: body.project, epoch: body.epoch, credential: body.credential });
      }
    });
    const postJson = async (path: string, body: unknown, token?: string) => {
      workerHttpRequests++;
      return context.request.post(origin + path, {
        headers: { Origin: origin, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
          ...(token ? { Authorization: `Bearer ${token}`, 'MCP-Protocol-Version': '2025-06-18' } : {}) },
        data: body, ignoreHTTPSErrors: true, maxRedirects: 0,
      });
    };
    const responseJson = async (response: { headers(): Record<string, string>; text(): Promise<string> }) => {
      const raw = await response.text();
      const data = response.headers()['content-type']?.includes('text/event-stream')
        ? raw.split(/\r?\n/).find(line => line.startsWith('data: '))?.slice(6) : raw;
      assert.ok(data, 'Worker response contains a JSON or SSE data payload');
      return JSON.parse(data);
    };
    const rpc = async (token: string, name: string, args: object = {}) => {
      const response = await postJson('/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, token);
      assert.equal(response.status(), 200);
      const envelope = await responseJson(response) as { result?: { isError?: boolean; content?: Array<{ text?: string }> } };
      assert.notEqual(envelope.result?.isError, true, `${name} must be accepted by D`);
      const text = envelope.result?.content?.[0]?.text;
      assert.ok(text, `${name} returns a result`);
      return JSON.parse(text);
    };
    const connectWithFreshConsent = async (proof: string, suffix: string) => {
      const redirectUri = `https://client.example/callback/${suffix}`;
      const registration = await postJson('/oauth/register', {
        client_name: `Local D browser fixture ${suffix}`, redirect_uris: [redirectUri],
        token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'],
      });
      assert.equal(registration.status(), 201);
      const client = await registration.json() as { client_id: string };
      const verifier = `local-${suffix}-` + 'c'.repeat(48);
      const challenge = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))).toString('base64url');
      const consent = await context.newPage();
      const state = `state-${suffix}`;
      await consent.goto(`${origin}/authorize?${new URLSearchParams({ client_id: client.client_id, redirect_uri: redirectUri,
        response_type: 'code', scope: 'video:read video:edit', resource: origin + '/mcp', state,
        code_challenge: challenge, code_challenge_method: 'S256' })}`);
      await consent.route('**/authorize', async route => {
        if (route.request().method() !== 'POST') { await route.continue(); return; }
        const response = await route.fetch({ maxRedirects: 0 });
        const location = response.headers()['location'];
        assert.equal(response.status(), 302, 'OAuth approval returns a redirect to the synthetic client');
        assert.ok(location);
        callbacks.push(location);
        await route.fulfill({ status: 200, contentType: 'text/plain', body: 'Local synthetic OAuth callback captured.' });
      });
      await consent.getByLabel('One-Time Browser Pairing Proof', { exact: true }).fill(proof);
      const [approval] = await Promise.all([
        consent.waitForResponse(response => new URL(response.url()).pathname === '/authorize' && response.request().method() === 'POST'),
        consent.getByRole('button', { name: 'Approve', exact: true }).click(),
      ]);
      assert.equal(approval.status(), 200);
      const callback = new URL(callbacks.at(-1)!);
      assert.equal(callback.searchParams.get('state'), state);
      assert.equal(callback.searchParams.get('iss'), origin);
      workerHttpRequests++;
      const tokenResponse = await context.request.post(origin + '/oauth/token', {
        ignoreHTTPSErrors: true,
        form: { grant_type: 'authorization_code', client_id: client.client_id, code: callback.searchParams.get('code')!,
          code_verifier: verifier, redirect_uri: redirectUri, resource: origin + '/mcp' },
      });
      assert.equal(tokenResponse.status(), 200);
      await consent.close();
      return (await tokenResponse.json() as { access_token: string }).access_token;
    };
    const waitForOperation = async (token: string, operationId: string) => {
      for (let i = 0; i < 40; i++) {
        const status = await rpc(token, 'status', { operationId });
        if (status?.state === 'completed') return status;
        assert.ok(['queued', 'claimed'].includes(status?.state), `operation ${operationId} did not fail or disappear`);
        await delay(250);
      }
      assert.fail(`operation ${operationId} did not complete within 10 seconds after local browser processing`);
    };
    const waitForProjectOperation = async (token: string, operationId: string) => {
      for (let i = 0; i < 20; i++) {
        const project = await rpc(token, 'getproject');
        if (project.metadata?.latestOperationId === operationId) return project.metadata;
        await delay(150);
      }
      assert.fail(`D did not persist metadata for ${operationId}`);
    };
    const waitForPreviewSeconds = async (seconds: number) => {
      await page.waitForFunction(expected => {
        const video = document.querySelector<HTMLVideoElement>('video[aria-label="Edited video preview"]');
        return !!video && video.readyState >= 1 && Number.isFinite(video.duration) && Math.abs(video.duration - expected) < 0.15;
      }, seconds, { timeout: 60_000 });
    };
    const download = async (name: string) => {
      const [item] = await Promise.all([
        page.waitForEvent('download'), page.getByRole('button', { name: 'Download cut MP4 video', exact: true }).click(),
      ]);
      const path = join(scratch, name);
      await item.saveAs(path);
      const bytes = await readFile(path);
      const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_name',
        '-of', 'json', path], { encoding: 'utf8' })) as { format: { duration: string }; streams: Array<{ codec_name: string }> };
      assert.deepEqual(probe.streams.map(stream => stream.codec_name), ['h264', 'aac']);
      return { bytes, hash: await crypto.subtle.digest('SHA-256', bytes).then(hash => Buffer.from(hash).toString('hex')),
        duration: Number(probe.format.duration) };
    };
    const currentPlan = () => page.locator('input[aria-label^="Clip "]').evaluateAll(inputs => inputs.map(input => {
      const element = input as HTMLInputElement;
      return [element.getAttribute('aria-label'), element.valueAsNumber] as const;
    }));

    assert.match(await readFile('wrangler.d-local.template.jsonc', 'utf8'), /"EXPERIMENT_ENABLED":\s*"false"/,
      'committed D config stays disabled; only this local process overrides it');
    await page.goto(origin + '/tools/video-scissors');
    await page.getByRole('button', { name: 'Connect experimental ChatGPT control', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Connect experimental ChatGPT control', exact: true }).click();
    await delay(500);
    await page.getByText('Awaiting Authorization', { exact: true }).waitFor();
    await page.getByText('One-Time Browser Pairing Proof', { exact: true }).waitFor();
    const proof1 = (await page.locator('code').first().textContent())?.trim();
    assert.ok(proof1);
    assert.match(proof1, /^[A-Za-z0-9_-]{90,160}$/, 'the signed pairing ticket remains visible until consent');
    const fixtureDuration = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1', fixture], { encoding: 'utf8' }));
    const preConsentSyncPromise = page.waitForResponse(response => {
      if (new URL(response.url()).pathname !== '/remote/sync' || response.request().method() !== 'POST') return false;
      const request = JSON.parse(response.request().postData() ?? '{}') as { metadata?: { duration?: unknown; generation?: unknown } };
      return typeof request.metadata?.duration === 'number' &&
        Math.abs(request.metadata.duration - fixtureDuration) < 0.15 &&
        typeof request.metadata.generation === 'number' && request.metadata.generation > 0;
    });
    await page.locator('input[type=file]').setInputFiles({ name: 'SYNTHETIC_MEDIA_CANARY.mp4', mimeType: 'video/mp4', buffer: await readFile(fixture) });
    await page.getByText('Video ready. Clip times use the original video.', { exact: true }).waitFor();
    const preConsentSync = await preConsentSyncPromise;
    const preConsentRequest = JSON.parse(preConsentSync.request().postData() ?? '{}') as {
      metadata?: { duration?: number; generation?: number; hasOutput?: boolean; latestOperationId?: string | null };
    };
    assert.ok(Math.abs((preConsentRequest.metadata?.duration ?? 0) - fixtureDuration) < 0.15,
      'pre-consent sync contains the selected synthetic video duration, not an earlier empty-project snapshot');
    assert.ok((preConsentRequest.metadata?.generation ?? 0) > 0, 'selected source has advanced the project generation');
    assert.equal(preConsentRequest.metadata?.hasOutput, false);
    assert.equal(preConsentRequest.metadata?.latestOperationId, null);
    assert.deepEqual(await preConsentSync.json(), { ok: true, consented: false },
      'metadata sync before OAuth consent succeeds without granting connection authority');
    await page.getByText('Awaiting Authorization', { exact: true }).waitFor();
    await page.getByText('One-Time Browser Pairing Proof', { exact: true }).waitFor();
    const authorizedSyncPromise = page.waitForResponse(async response => {
      if (new URL(response.url()).pathname !== '/remote/sync' || response.request().method() !== 'POST') return false;
      const value = await response.json().catch(() => null) as { ok?: unknown; consented?: unknown } | null;
      return value?.ok === true && value.consented === true;
    });
    const token1 = await connectWithFreshConsent(proof1, 'cut1');
    await authorizedSyncPromise;
    await page.getByText('Connected', { exact: true }).waitFor();
    const initial = await rpc(token1, 'getproject');
    assert.equal(initial.metadata.generation, 1);
    const cut1 = await rpc(token1, 'cut', { operationId: 'd-cut-1', generation: initial.metadata.generation,
      version: initial.metadata.version, clips: [{ start: 5, end: 9 }, { start: 25, end: 32 }] });
    assert.equal(cut1.state, 'queued');
    await waitForOperation(token1, 'd-cut-1');
    await waitForPreviewSeconds(11);
    const cut1Metadata = await waitForProjectOperation(token1, 'd-cut-1');
    const cut1Plan = await currentPlan();
    const cut1File = await download('cut-1.mp4');
    assert.ok(Math.abs(cut1File.duration - 11) < 0.15);

    const cut2 = await rpc(token1, 'cut', { operationId: 'd-cut-2', generation: cut1Metadata.generation,
      version: cut1Metadata.version, clips: [{ start: 35, end: 39 }, { start: 48, end: 53 }] });
    assert.equal(cut2.state, 'queued');
    await waitForOperation(token1, 'd-cut-2');
    await waitForPreviewSeconds(9);
    const cut2Metadata = await waitForProjectOperation(token1, 'd-cut-2');
    const cut2File = await download('cut-2.mp4');
    assert.ok(Math.abs(cut2File.duration - 9) < 0.15);
    assert.notEqual(cut2File.hash, cut1File.hash, 'Cut 2 produces distinct content');

    const undo2 = await rpc(token1, 'undo', { operationId: 'd-undo-2', generation: cut2Metadata.generation,
      version: cut2Metadata.version, targetOperationId: 'd-cut-2' });
    assert.equal(undo2.state, 'queued');
    await waitForOperation(token1, 'd-undo-2');
    await waitForPreviewSeconds(11);
    const restored = await waitForProjectOperation(token1, 'd-undo-2');
    const restoredPlan = await currentPlan();
    const restoredFile = await download('undo-2.mp4');
    assert.equal(restoredFile.hash, cut1File.hash, 'Undo 2 restores Cut 1 MP4 bytes exactly');
    assert.deepEqual(restoredPlan, cut1Plan, 'Undo 2 restores Cut 1 clip plan exactly');
    assert.equal(restored.generation, cut1Metadata.generation);
    assert.ok(restored.version > cut2Metadata.version, 'version remains monotonic to prevent stale-command ABA');
    assert.equal(restored.hasOutput, true);

    const project1 = projects[0];
    assert.match(project1?.project ?? '', /^[a-f0-9]{64}$/);
    await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
    await page.getByText('Disconnected', { exact: true }).waitFor();
    const staleOwner1 = await postJson('/remote/sync', { auth: project1, metadata: restored });
    assert.deepEqual(await staleOwner1.json(), { ok: false, consented: false }, 'revoked browser authority cannot sync');
    const staleToken1 = await postJson('/mcp', { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'getproject', arguments: {} } }, token1);
    assert.equal((await responseJson(staleToken1)).result.isError, true, 'revoked OAuth token cannot read D project');

    await page.getByRole('button', { name: 'Connect experimental ChatGPT control', exact: true }).click();
    await page.getByText('Awaiting Authorization', { exact: true }).waitFor();
    await page.getByText('One-Time Browser Pairing Proof', { exact: true }).waitFor();
    const proof2 = (await page.locator('code').first().textContent())?.trim();
    assert.ok(proof2);
    assert.match(proof2, /^[A-Za-z0-9_-]{90,160}$/, 'reconnect receives a fresh signed ticket');
    const token2 = await connectWithFreshConsent(proof2, 'reconnect');
    await page.getByText('Connected', { exact: true }).waitFor();
    assert.equal(projects.length, 2);
    assert.notEqual(projects[1].project, project1.project, 'reconnect creates a new project, not a resurrection');
    const reconnected = await rpc(token2, 'getproject');
    assert.deepEqual(reconnected.metadata, restored, 'fresh consent binds the currently restored local state');
    await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
    await page.getByText('Disconnected', { exact: true }).waitFor();
    const staleOwner2 = await postJson('/remote/sync', { auth: projects[1], metadata: restored });
    assert.deepEqual(await staleOwner2.json(), { ok: false, consented: false }, 'second revoke clears the new browser authority');
    const denied2 = await postJson('/mcp', { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'getproject', arguments: {} } }, token2);
    assert.equal((await responseJson(denied2)).result.isError, true, 'second revoke fences the new token too');

    const localRequests = browserRequests.filter(request => request.origin === origin);
    assert.ok(browserRequests.every(request => request.origin === origin || request.origin === 'https://client.example'),
      'browser traffic stays local except the intercepted synthetic OAuth callback');
    assert.ok(localRequests.every(request => !request.body?.includes('SYNTHETIC_MEDIA_CANARY') &&
      !request.body?.includes('data:video') && !request.body?.includes('blob:') && !request.body?.includes('file://')),
    'media bytes and local paths never enter a request body');
    assert.ok(wakeSockets >= 1, 'D uses its local WebSocket wakeup path');
    console.log('local-d-browser-evidence', JSON.stringify({
      cutSeconds: [cut1File.duration, cut2File.duration], undo2ByteIdenticalToCut1: restoredFile.hash === cut1File.hash,
      undo2PlanIdenticalToCut1: JSON.stringify(restoredPlan) === JSON.stringify(cut1Plan),
      reconnectCreatedFreshProject: projects[0].project !== projects[1].project, bothTokensRevoked: true, localWakeSockets: wakeSockets,
      browserLocalHttpRequests: localRequests.length, harnessWorkerHttpRequests: workerHttpRequests,
      mediaOrPathInRequestBody: false, externalBrowserRequests: browserRequests.filter(request => request.origin !== origin).length,
      deployment: 'local-only', cloudflareMutation: 'none',
    }));
    await context.close();
  } finally {
    await browser?.close();
    await worker.stop();
    await rm(scratch, { recursive: true, force: true });
  }
});

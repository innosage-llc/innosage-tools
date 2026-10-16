// Real browser/WASM check. Requires an existing Playwright installation and ffmpeg.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const { chromium } = await import(process.env.VIDEO_SCISSORS_PLAYWRIGHT_MODULE || 'playwright');
const origin = process.argv[2] || 'http://127.0.0.1:3450';
const output = resolve(process.argv[3] || '.deploy/video-scissors-e2e');
mkdirSync(output, { recursive: true });
const source = resolve('public/video-scissors/demo.mp4');
const hash = () => createHash('sha256').update(readFileSync(source)).digest('hex');
const originalHash = hash();
const browser = await chromium.launch({ headless: true,
  ...(process.env.VIDEO_SCISSORS_CHROME ? { executablePath: process.env.VIDEO_SCISSORS_CHROME } : {}) });
const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const traffic = [];
const sockets = [];
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => {
  const url = new URL(request.url());
  traffic.push({ method: request.method(), local: ['blob:', 'data:'].includes(url.protocol),
    sameOrigin: url.origin === new URL(origin).origin, hasBody: request.postData() !== null,
    type: request.resourceType() });
});
page.on('websocket', socket => {
  const url = new URL(socket.url());
  sockets.push({ developmentReload: ['127.0.0.1', 'localhost'].includes(url.hostname) &&
    url.pathname.includes('/_next/webpack-hmr') });
});
const duration = () => page.locator('video').first().evaluate(video => video.duration);
const download = page.getByRole('button', { name: 'Download cut MP4 video', exact: true });
const cut = page.getByRole('button', { name: 'Cut video segments', exact: true });
const undo = page.getByRole('button', { name: 'Undo cut and restore previous plan', exact: true });
const start = index => page.getByRole('spinbutton', { name: `Clip ${index} start time in seconds`, exact: true });
const end = index => page.getByRole('spinbutton', { name: `Clip ${index} end time in seconds`, exact: true });
const results = {};
const started = Date.now();
results.browser = await browser.version();
results.sourceRevision = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
const sourceHash = createHash('sha256');
for (const file of ['lib/video-scissors.ts', 'lib/video-scissors-browser.ts',
  'app/video-scissors/VideoScissorsApp.tsx', 'app/video-scissors/VideoScissorsView.tsx',
  'app/video-scissors/page.tsx', 'scripts/video-scissors.e2e.mjs']) {
  sourceHash.update(file).update('\0').update(readFileSync(file));
}
results.sourceArtifactHash = sourceHash.digest('hex');

async function waitForSource() {
  await page.waitForFunction(() => Array.from(document.querySelectorAll('[role="alert"]')).some(n => n.textContent.trim()) ||
    document.querySelector('[role="status"]')?.textContent.includes('Video ready'), null, { timeout: 60_000 });
  const alerts = (await page.getByRole('alert').allTextContents()).map(text => text.trim()).filter(Boolean);
  assert.deepEqual(alerts, [], 'The supported synthetic source must pass inspection');
}

function command(executable, args) {
  const result = spawnSync(executable, args, { maxBuffer: 20_000_000 });
  assert.equal(result.status, 0, `${executable} verification failed`);
  return result.stdout;
}
function checkMedia(file, expectedDuration) {
  const info = JSON.parse(command('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file]));
  assert.ok(Math.abs(Number(info.format.duration) - expectedDuration) <= 0.15);
  const video = info.streams.find(s => s.codec_type === 'video');
  const audio = info.streams.find(s => s.codec_type === 'audio');
  assert.equal(video.codec_name, 'h264');
  assert.equal(audio.codec_name, 'aac');
  assert.ok(Math.abs(Number(video.start_time) - Number(audio.start_time)) <= 0.15);
  assert.ok(Math.abs(Number(video.duration) - Number(audio.duration)) <= 0.15);
  return { duration: Number(info.format.duration), videoCodec: video.codec_name,
    audioCodec: audio.codec_name, avDurationDifference: Math.abs(Number(video.duration) - Number(audio.duration)) };
}
function checkColor(file, time, channel) {
  const bytes = command('ffmpeg', ['-v', 'error', '-ss', String(time), '-i', file,
    '-frames:v', '1', '-vf', 'scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
  assert.equal(bytes.length, 3);
  for (let c = 0; c < 3; c++) if (c !== channel) assert.ok(bytes[channel] > bytes[c] * 1.5);
}
function checkTone(file, time, frequency) {
  const buffer = command('ffmpeg', ['-v', 'error', '-ss', String(time), '-i', file,
    '-t', '0.2', '-vn', '-ar', '8000', '-ac', '1', '-f', 'f32le', '-']);
  const energy = tone => {
    let re = 0, im = 0;
    for (let i = 0; i < buffer.length / 4; i++) {
      const value = buffer.readFloatLE(i * 4), phase = 2 * Math.PI * tone * i / 8000;
      re += value * Math.cos(phase); im += value * Math.sin(phase);
    }
    return re * re + im * im;
  };
  const own = energy(frequency);
  for (const other of [440, 880, 1320]) if (other !== frequency) assert.ok(own > energy(other) * 10);
}
function checkSilence(file, time) {
  const buffer = command('ffmpeg', ['-v', 'error', '-ss', String(time), '-i', file,
    '-t', '0.2', '-vn', '-ar', '8000', '-ac', '1', '-f', 'f32le', '-']);
  let squares = 0;
  for (let i = 0; i < buffer.length; i += 4) squares += buffer.readFloatLE(i) ** 2;
  assert.ok(Math.sqrt(squares / (buffer.length / 4)) < 0.005, 'Original leading silence must remain silent');
}

try {
  if (process.env.VIDEO_SCISSORS_EXPECTED_REVISION) {
    const response = await context.request.get(`${origin}/tools/release.json`);
    assert.equal(response.ok(), true);
    const release = await response.json();
    assert.equal(release.sourceRevision, process.env.VIDEO_SCISSORS_EXPECTED_REVISION);
    results.deployment = { sourceRevision: release.sourceRevision, version: release.version,
      buildHash: release.buildHash, configHash: release.configHash };
  }
  await page.goto(`${origin}/tools/video-scissors`, { waitUntil: 'load' });
  await page.route('**/video-scissors/ffmpeg/core.wasm.gz', route => route.abort());
  await page.locator('input[type=file]').setInputFiles(source);
  await page.getByRole('alert').filter({ hasText: 'Processing Error' }).waitFor();
  assert.equal(await download.isDisabled(), true);
  await page.unroute('**/video-scissors/ffmpeg/core.wasm.gz');
  await page.locator('input[type=file]').setInputFiles(source);
  await cut.waitFor({ state: 'visible' });
  await waitForSource();
  results.runtimeLoadFailureRecovery = 'PASS';
  await page.getByRole('button', { name: 'Add clip segment', exact: true }).click();
  assert.ok(Math.abs(await duration() - 60) < 0.15);
  await start(1).fill('10'); await end(1).fill('25');
  await page.getByRole('button', { name: 'Add clip segment', exact: true }).click();
  await start(2).fill('40'); await end(2).fill('50');
  const cutStarted = Date.now();
  await cut.click();
  await page.waitForFunction(() => !document.querySelector('button[aria-label="Download cut MP4 video"]').disabled,
    null, { timeout: 180_000 });
  await page.waitForFunction(() => Math.abs(document.querySelector('video').duration - 25) < 0.15);
  const firstDownload = page.waitForEvent('download'); await download.click();
  const file = join(output, 'cut-25s.mp4'); await (await firstDownload).saveAs(file);
  results.cut = { ...checkMedia(file, 25), elapsedMilliseconds: Date.now() - cutStarted };
  for (const [time, color, tone] of [[2, 0, 440], [12, 1, 880], [20, 2, 1320]]) {
    checkColor(file, time, color); checkTone(file, time, tone);
  }
  results.contentOrderAndAudio = 'PASS';
  await start(1).fill('40'); await end(1).fill('45');
  await start(2).fill('10'); await end(2).fill('15');
  await cut.click();
  await page.waitForFunction(() => !document.querySelector('button[aria-label="Download cut MP4 video"]').disabled &&
    Math.abs(document.querySelector('video').duration - 10) < 0.15, null, { timeout: 180_000 });
  const reverseDownload = page.waitForEvent('download'); await download.click();
  const reverseFile = join(output, 'reverse-10s.mp4'); await (await reverseDownload).saveAs(reverseFile);
  checkMedia(reverseFile, 10); checkColor(reverseFile, 2, 2); checkColor(reverseFile, 7, 0);
  checkTone(reverseFile, 2, 1320); checkTone(reverseFile, 7, 440);
  results.reversedIntervals = 'PASS';
  await undo.click();
  await page.waitForFunction(() => Math.abs(document.querySelector('video').duration - 25) < 0.15);
  assert.equal(await start(1).inputValue(), '10'); assert.equal(await end(2).inputValue(), '50');
  results.secondEditUndo = 'PASS';
  await page.screenshot({ path: join(output, 'after-undo.png'), fullPage: true });
  await start(1).fill('55'); await end(1).fill('99');
  await cut.click(); await page.getByRole('alert').filter({ hasText: 'Processing Error' }).waitFor();
  assert.ok(Math.abs(await duration() - 25) < 0.15);
  results.invalidRangePreservesPreview = 'PASS';
  await start(1).fill('0'); await end(1).fill('60');
  await page.getByRole('button', { name: 'Remove clip 2', exact: true }).click();
  await cut.click();
  await page.getByRole('button', { name: 'Cancel processing', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('button[aria-label="Cancel processing"]').disabled);
  assert.ok(Math.abs(await duration() - 25) < 0.15);
  results.cancelPreservesPreview = 'PASS';
  await start(1).fill('10'); await end(1).fill('15'); await cut.click();
  await page.waitForFunction(() => !document.querySelector('button[aria-label="Download cut MP4 video"]').disabled &&
    Math.abs(document.querySelector('video').duration - 5) < 0.15, null, { timeout: 180_000 });
  results.cancelThenRetrySameSource = 'PASS';
  // Select again through a cleared input, as a user explicitly starting a fresh project.
  await page.locator('input[type=file]').setInputFiles([]);
  await page.locator('input[type=file]').setInputFiles(source);
  await waitForSource();
  await page.getByRole('button', { name: 'Add clip segment', exact: true }).click();
  await start(1).fill('10'); await end(1).fill('15'); await cut.click();
  await page.waitForFunction(() => !document.querySelector('button[aria-label="Download cut MP4 video"]').disabled &&
    Math.abs(document.querySelector('video').duration - 5) < 0.15, null, { timeout: 180_000 });
  await undo.click();
  await page.waitForFunction(() => Math.abs(document.querySelector('video').duration - 60) < 0.15);
  assert.equal(await download.isDisabled(), true);
  results.firstEditUndo = 'PASS';
  const offsetInput = join(output, 'delayed-audio-input.mp4');
  command('ffmpeg', ['-v', 'error', '-y', '-i', source, '-itsoffset', '2', '-i', source,
    '-map', '0:v:0', '-map', '1:a:0', '-c', 'copy', '-t', '60', offsetInput]);
  await page.locator('input[type=file]').setInputFiles(offsetInput); await waitForSource();
  await page.getByRole('button', { name: 'Add clip segment', exact: true }).click();
  await start(1).fill('0'); await end(1).fill('10'); await cut.click();
  await page.waitForFunction(() => !document.querySelector('button[aria-label="Download cut MP4 video"]').disabled &&
    Math.abs(document.querySelector('video').duration - 10) < 0.15, null, { timeout: 180_000 });
  const delayedDownload = page.waitForEvent('download'); await download.click();
  const delayedFile = join(output, 'delayed-audio-cut.mp4'); await (await delayedDownload).saveAs(delayedFile);
  results.delayedAudio = checkMedia(delayedFile, 10);
  checkSilence(delayedFile, 1); checkTone(delayedFile, 3, 440);
  results.originalAudioTimingPreserved = 'PASS';
  assert.equal(hash(), originalHash); results.sourceUnchanged = 'PASS';
  const networkTraffic = traffic.filter(request => !request.local);
  const methodCounts = networkTraffic.reduce((counts, request) => {
    counts[request.method] = (counts[request.method] || 0) + 1;
    return counts;
  }, {});
  const applicationWebSockets = sockets.filter(socket => !socket.developmentReload).length;
  assert.equal(networkTraffic.filter(request => !['GET', 'HEAD'].includes(request.method)).length, 0);
  assert.equal(traffic.filter(request => request.hasBody).length, 0);
  assert.equal(networkTraffic.filter(request => !request.sameOrigin).length, 0);
  assert.equal(applicationWebSockets, 0);
  results.privacy = { noMediaUploads: 'PASS', allowedMethodsOnly: 'PASS', methodCounts,
    requestBodies: 0, sameOriginOnly: 'PASS', totalRequests: traffic.length, applicationWebSockets };
  assert.deepEqual(errors, []);
  results.status = 'PASS';
} catch (error) {
  results.status = 'FAIL'; results.failure = error.message;
  await page.screenshot({ path: join(output, 'failure.png'), fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  results.elapsedMilliseconds = Date.now() - started;
  writeFileSync(join(output, 'result.json'), JSON.stringify(results, null, 2) + '\n');
  console.log(JSON.stringify(results, null, 2));
  await browser.close();
}

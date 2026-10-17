#!/usr/bin/env node

import { createHash, randomBytes, randomUUID, webcrypto } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scriptPath = fileURLToPath(import.meta.url);
const fixtureRelativePath = 'public/video-scissors/demo.mp4';
const fixturePath = resolve(repoRoot, fixtureRelativePath);
const mockClientOrigin = 'https://fakeclient.example';
const mockCallbackPath = '/callback/video-scissors-staging';
const allowedOrigins = Object.freeze({
  d1: 'https://video-scissors-mcp-staging.innosage-draft.workers.dev',
  do: 'https://video-scissors-mcp-do-staging.innosage-draft.workers.dev',
  d: 'https://video-scissors-mcp-d-staging.innosage-draft.workers.dev',
});
const maxControlBodyBytes = 65_536;
export const matchedMutatingCommandSequence = Object.freeze(['cut', 'cut', 'undo']);
export function pairingProofPattern(arm) {
  return arm === 'd' ? /^[A-Za-z0-9_-]{90,160}$/ : /^[a-f0-9]{64}$/;
}
export function wakePathPattern(arm) {
  return arm === 'd' ? /^\/remote\/bridge\/[a-f0-9]{64}\/[0-9]+$/ : /^\/remote\/bridge\/[a-f0-9-]{36}\/[0-9]+$/i;
}
export function isCompletedOperationReport(body, operationId) {
  return body?.operationId === operationId && body?.state === 'completed';
}
const usage = [
  'Usage:',
  '  npm run test:video-scissors-mcp-e2e -- --arm d1|do|d',
  '  npm run test:video-scissors-mcp-e2e -- --help',
  '',
  'The staging run is manual. No arm is selected by default.',
].join('\n');

const hash = value => createHash('sha256').update(value).digest('hex');
const safeCodePattern = /^[A-Z0-9_]{1,80}$/;

export function parseRunArgs(args) {
  if (args.length === 0 || (args.length === 1 && ['--help', '-h'].includes(args[0]))) {
    return { action: 'help' };
  }
  if (args.length !== 2 || args[0] !== '--arm') {
    throw Object.assign(new Error('USAGE_INVALID'), { safeCode: 'USAGE_INVALID' });
  }
  if (!Object.hasOwn(allowedOrigins, args[1])) {
    throw Object.assign(new Error('ARM_NOT_ALLOWLISTED'), { safeCode: 'ARM_NOT_ALLOWLISTED' });
  }
  return { action: 'run', arm: args[1] };
}

export function isPreviewReady(preview, expectedLabel, expectedDurationSeconds) {
  return preview?.label === expectedLabel &&
    preview.sourceScheme === 'blob:' &&
    Number.isFinite(preview.readyState) &&
    preview.readyState >= 1 &&
    Number.isFinite(preview.durationSeconds) &&
    Math.abs(preview.durationSeconds - expectedDurationSeconds) < 0.25;
}

export function isOriginalPreviewReady(preview, expectedDurationSeconds) {
  return isPreviewReady(preview, 'Original video preview', expectedDurationSeconds);
}

export function isDRevokeResponse(status, body) {
  return status === 200 && body?.ok === true && Number.isInteger(body.closedSockets) && body.closedSockets >= 0;
}

export function isRevokedProjectDenied(status, body) {
  return status === 200 && body?.result?.isError === true &&
    body.result.content?.some(item => item.type === 'text' && item.text === 'PROJECT_EXPIRED_OR_REVOKED') === true;
}

export function isLocalSchemeUrl(value) {
  try { return ['blob:', 'data:', 'about:'].includes(new URL(value).protocol); }
  catch { return false; }
}

export function isAllowedSocketClose(socket, explicitRevokeStarted) {
  if (!socket || !socket.closedAtUtc || socket.errors !== 0) return false;
  if (explicitRevokeStarted !== true || socket.wasClean !== true || socket.closePhase !== 'disconnect-cleanup') {
    return false;
  }
  return (socket.closeCode === 1000 && socket.closeReason === 'disconnected') ||
    (socket.closeCode === 1008 && socket.closeReason === 'project-revoked');
}

export function summarizeRequestPhases(rows, phaseNames) {
  return Object.fromEntries(phaseNames.map(name => {
    const starts = rows.filter(row => row.startPhase === name);
    const responses = rows.filter(row => row.responsePhase === name && row.status !== null);
    const byEndpointStatus = values => {
      const counts = {};
      for (const row of values) {
        const key = row.method + ' ' + row.path + ' ' + (row.status ?? 'NO_RESPONSE');
        counts[key] = (counts[key] ?? 0) + 1;
      }
      return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
    };
    return [name, {
      clientRequestStarts: starts.length,
      startsByEndpointAndFinalStatus: byEndpointStatus(starts),
      clientResponsesCompleted: responses.length,
      responseCompletionsByEndpointStatus: byEndpointStatus(responses),
      startsWithoutResponseAtEnd: starts.filter(row => row.status === null).length,
      responsesCompletedAfterStartPhase: starts.filter(row => row.responsePhase && row.responsePhase !== name).length,
    }];
  }));
}

function ensure(condition, safeCode) {
  if (!condition) throw Object.assign(new Error(safeCode), { safeCode });
}

function safeErrorCode(error) {
  return safeCodePattern.test(error?.safeCode ?? '') ? error.safeCode : 'RUNNER_ERROR';
}

function safePathname(pathname) {
  return pathname
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id')
    .replace(/\/[A-Za-z0-9_-]{24,}(?=\/|$)/g, '/:opaque');
}

function inspectRequest(method, path, body, contentType = '') {
  const bytes = body?.length ?? 0;
  const bodyText = body?.toString('utf8') ?? '';
  const mediaOrLocalMarker = /video-scissors-mcp-fixture\.mp4|demo\.mp4|data:video|blob:|file:\/\/|\/private\/tmp\/|\/Users\//i.test(bodyText);
  const mediaType = /^(video|audio)\//i.test(contentType) || /multipart\/form-data/i.test(contentType);
  return { method, path, bytes, mediaOrLocalMarker, mediaType, oversized: bytes > maxControlBodyBytes };
}

function endpointStatusCounts(rows) {
  const counts = {};
  for (const row of rows) {
    const key = row.method + ' ' + row.path + ' ' + (row.status ?? 'NO_RESPONSE');
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

function requestSummary(rows, phaseNames) {
  return {
    definition: {
      requestStart: 'client request event time, assigned to the phase active at start',
      response: 'client response completion event time, assigned independently to the phase active at completion',
      limitation: 'cross-phase starts/completions are counted separately; these are client observations, not server or billing totals',
    },
    byPhase: summarizeRequestPhases(rows, phaseNames),
    byEndpointStatus: endpointStatusCounts(rows),
    totalClientRequestStarts: rows.length,
    totalClientResponses: rows.filter(row => row.status !== null).length,
    startsWithoutResponseAtEnd: rows.filter(row => row.status === null).length,
    maximumObservedRequestBodyBytes: Math.max(0, ...rows.map(row => row.bytes ?? 0)),
  };
}

export function collectSensitiveStrings(value, values) {
  const sensitiveKey = /^(?:credential|access[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|client[_-]?id|project[_-]?id|(?:(?:latest|target)[_-]?)?operation[_-]?id|proof)$/i;
  if (Array.isArray(value)) {
    for (const item of value) collectSensitiveStrings(item, values);
  } else if (value && typeof value === 'object') {
    for (const [childKey, childValue] of Object.entries(value)) {
      if (sensitiveKey.test(childKey) && typeof childValue === 'string' && childValue.length > 0) {
        values.add(childValue);
      }
      collectSensitiveStrings(childValue, values);
    }
  }
}

export function hasSensitiveValue(serialized, values) {
  return [...values].some(value => value && serialized.includes(value));
}

const sensitiveValues = new Set();

function mediaInfo(executable, filePath) {
  let stdout;
  try {
    stdout = execFileSync(executable, [
      '-v', 'error', '-show_entries', 'format=duration:stream=codec_type,codec_name,duration',
      '-of', 'json', filePath,
    ], { encoding: 'utf8', maxBuffer: 1_000_000 });
  } catch (error) {
    const diagnostic = String(error?.stderr ?? '') + ' ' + String(error?.stdout ?? '');
    const code = /moov atom not found|partial file|seek/i.test(diagnostic) ? 'FFPROBE_MEDIA_INVALID'
      : Number.isInteger(error?.status) ? 'FFPROBE_EXIT_' + error.status : 'FFPROBE_EXECUTION_FAILED';
    throw Object.assign(new Error(code), { safeCode: code });
  }
  let parsed;
  try { parsed = JSON.parse(stdout); }
  catch { throw Object.assign(new Error('FFPROBE_JSON_INVALID'), { safeCode: 'FFPROBE_JSON_INVALID' }); }
  const video = parsed.streams?.find(stream => stream.codec_type === 'video');
  const audio = parsed.streams?.find(stream => stream.codec_type === 'audio');
  return {
    durationSeconds: Number(parsed.format?.duration),
    videoCodec: video?.codec_name ?? null,
    audioCodec: audio?.codec_name ?? null,
    videoDurationSeconds: Number(video?.duration),
    audioDurationSeconds: Number(audio?.duration),
  };
}

function chooseChromePath() {
  const candidate = process.env.VIDEO_SCISSORS_CHROME ||
    (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '');
  ensure(Boolean(candidate) && existsSync(candidate), 'INSTALLED_CHROME_NOT_FOUND');
  return candidate;
}

function chooseFfprobePath() {
  const candidate = process.env.VIDEO_SCISSORS_FFPROBE || 'ffprobe';
  try { execFileSync(candidate, ['-version'], { stdio: 'ignore' }); }
  catch { throw Object.assign(new Error('FFPROBE_NOT_FOUND'), { safeCode: 'FFPROBE_NOT_FOUND' }); }
  return candidate;
}

function waitForChildExit(child, timeoutMilliseconds) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise(resolvePromise => {
    let settled = false;
    const finish = exited => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.off('exit', onExit);
      child.off('error', onError);
      resolvePromise(exited);
    };
    const onExit = () => finish(true);
    const onError = () => finish(false);
    const timer = setTimeout(() => finish(false), timeoutMilliseconds);
    child.once('exit', onExit);
    child.once('error', onError);
  });
}

async function stopChromeProcess(child, spawnFailed) {
  if (!child || spawnFailed) return 'NOT_STARTED';
  if (child.exitCode !== null || child.signalCode !== null) return 'STOPPED';
  try { child.kill('SIGTERM'); } catch {}
  if (await waitForChildExit(child, 2_000)) return 'STOPPED';
  try { child.kill('SIGKILL'); } catch {}
  return await waitForChildExit(child, 2_000) ? 'STOPPED' : 'STOP_STATUS_UNKNOWN';
}

function readRunnerGitRevision() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim();
  } catch { return 'UNKNOWN'; }
}

async function readRunnerSourceHash() {
  try { return hash(await readFile(scriptPath)); }
  catch { return 'UNKNOWN'; }
}

function classifyRequestFailure(errorText) {
  if (typeof errorText !== 'string') return 'REQUEST_FAILED';
  const match = /^net::([A-Z0-9_]+)$/.exec(errorText);
  return match ? match[1] : 'REQUEST_FAILED';
}

async function runLive(arm) {
  const origin = allowedOrigins[arm];
  const reportName = 'video-scissors-mcp-e2e-' + arm + '-' +
    new Date().toISOString().replace(/[-:.]/g, '') + '.json';
  const startedAtUtc = new Date().toISOString();
  const startedMonotonic = performance.now();
  const phases = [];
  const requests = [];
  const blockedRequests = [];
  const mcpCalls = [];
  let currentPhase = 'setup';
  let activePhase = null;
  let browser;
  let chromeProcess;
  let temporaryProfile;
  let appPage;
  let consentPage;
  let cdp;
  let callbackIntercepts = 0;
  let callbackUrl = '';
  let pairingStarted = false;
  let explicitRevokeStarted = false;
  let uiDisconnected = false;
  let cleanupDisconnect = 'NOT_NEEDED_NO_PAIRING';
  let profileCleanup = 'NOT_CREATED';
  let socketAudit = null;
  let appSocketCount = 0;
  let failure = null;
  let idleWindow = null;
  const mutatingMcpCommandSequence = [];
  let sourceBytes;
  let sourceHash;
  let sourceUnchanged = null;
  let previewObservation = null;
  let dcrStatus = null;
  let tokenStatus = null;
  let authorizationStatus = 'NOT_RUN';
  let ffprobePath = 'ffprobe';
  let chromeSpawnFailed = false;
  const operationTimings = [];

  const report = {
    schemaVersion: 2,
    status: 'RUNNING',
    arm,
    executionEvidence: {
      browser: 'HEADED_ISOLATED_CHROME',
      scriptedOAuthAndMcpClient: 'USED',
      realChatGPTWeb: 'NOT_RUN',
      realGeminiWeb: 'NOT_RUN',
    },
    scenario: {
      id: 'matched-v1-cut1-2s-cut2-4s-undo2-to-cut1',
      sequence: ['hidden-idle-120s', 'cut1-2s', 'cut2-4s', 'undo2-to-cut1', 'disconnect-revoke'],
      hiddenIdleBeforeCuts: true,
      mutatingMcpCommands: matchedMutatingCommandSequence.length,
      finalUndoToOriginal: 'NOT_RUN',
    },
    targetDeployment: {
      version: 'UNKNOWN',
      sourceRevision: 'UNKNOWN',
      identityBasis: 'runner did not query deployment identity; runner identity is not deployed Worker identity',
    },
    runner: { gitRevision: readRunnerGitRevision(), sourceSha256: await readRunnerSourceHash() },
    fixture: { path: fixtureRelativePath, sha256: null },
    startedAtUtc,
    finishedAtUtc: null,
    elapsedMonotonicMilliseconds: null,
    phases,
    idleWindow: null,
    oauth: { dcrStatus: null, authorizationAndPkce: 'NOT_RUN', tokenExchangeStatus: null, callbackInterceptedLocally: false },
    mcpCalls,
    operationTimings,
    correctness: {
      originalFixtureReady: false,
      cut1: 'NOT_RUN',
      cut2: 'NOT_RUN',
      undo2ToCut1: 'NOT_RUN',
      outputs: { cut1: null, cut2: null, undo2: null },
      clipPlans: { cut1: null, cut2: null, undo2: null, equal: null },
      restoredPreview: null,
      sourceUnchanged: null,
    },
    revoke: { dResponseCheck: arm === 'd' ? 'NOT_RUN' : 'NOT_APPLICABLE', httpStatus: null, ok: null, closedSockets: null, staleTokenDenied: 'NOT_RUN' },
    clientRequests: null,
    websocket: { applicationSocketCount: 0, attempts: 0, accepted: 0, rejected: 0, errors: 0, closeResults: [] },
    privacy: {
      mediaEgressObserved: false,
      unsafeRequestBodiesObserved: false,
      rawAuthValuesOrIDsPersisted: false,
      mediaContentPersisted: false,
      screenshotsTracesOrHarSaved: false,
      blockedOffOriginRequestCount: 0,
      blockedOffOriginRiskyBodyCount: 0,
    },
    cleanup: { uiDisconnect: cleanupDisconnect, disposableProfile: profileCleanup },
    failure: null,
  };

  const enterPhase = async name => {
    if (activePhase) {
      activePhase.endedAtUtc = new Date().toISOString();
      activePhase.elapsedMonotonicMilliseconds = Math.round((performance.now() - activePhase.startedMonotonic) * 1000) / 1000;
      delete activePhase.startedMonotonic;
    }
    currentPhase = name;
    activePhase = { name, startedAtUtc: new Date().toISOString(), startedMonotonic: performance.now(),
      endedAtUtc: null, elapsedMonotonicMilliseconds: null };
    phases.push(activePhase);
    if (appPage && !appPage.isClosed()) {
      await appPage.evaluate(value => { window.__videoScissorsMcpPhase = value; }, name).catch(() => {});
    }
  };

  const collectSocketAudit = async () => {
    const audits = [];
    for (const page of [appPage, consentPage]) {
      if (!page || page.isClosed()) continue;
      try {
        const audit = await page.evaluate(() => window.__videoScissorsMcpSocketAudit);
        if (audit) audits.push(audit);
      } catch {}
    }
    if (audits.length === 0) return null;
    return {
      attempts: audits.reduce((total, audit) => total + audit.attempts, 0),
      accepted: audits.reduce((total, audit) => total + audit.accepted, 0),
      rejected: audits.reduce((total, audit) => total + audit.rejected, 0),
      sockets: audits.flatMap(audit => audit.sockets),
    };
  };

  const addRequest = (method, path, body, contentType, startPhase) => {
    const inspected = inspectRequest(method, path, body, contentType);
    const row = {
      ...inspected,
      startPhase,
      startedAtUtc: new Date().toISOString(),
      startedMonotonic: performance.now(),
      status: null,
      responsePhase: null,
      responseAtUtc: null,
      wallMilliseconds: null,
      failureCode: null,
    };
    requests.push(row);
    return row;
  };

  const finishRequest = (row, status, observation = {}) => {
    row.status = status;
    row.responsePhase = observation.phase ?? currentPhase;
    row.responseAtUtc = observation.atUtc ?? new Date().toISOString();
    row.wallMilliseconds = Math.round(((observation.monotonic ?? performance.now()) - row.startedMonotonic) * 1000) / 1000;
    delete row.startedMonotonic;
  };

  const persistReport = async () => {
    const outputDir = resolve(repoRoot, '.deploy');
    await mkdir(outputDir, { recursive: true });
    const reportPath = join(outputDir, reportName);
    const serialized = JSON.stringify(report, null, 2) + '\n';
    const leaked = hasSensitiveValue(serialized, sensitiveValues);
    if (leaked) {
      const fallback = {
        schemaVersion: 2,
        status: 'FAIL',
        arm,
        executionEvidence: report.executionEvidence,
        scenario: report.scenario,
        targetDeployment: { version: 'UNKNOWN', sourceRevision: 'UNKNOWN' },
        runner: report.runner,
        fixture: report.fixture,
        startedAtUtc: report.startedAtUtc,
        finishedAtUtc: report.finishedAtUtc,
        elapsedMonotonicMilliseconds: report.elapsedMonotonicMilliseconds,
        phases: report.phases,
        idleWindow: report.idleWindow,
        operationTimings: report.operationTimings,
        cleanup: report.cleanup,
        privacy: { rawAuthValuesOrIDsPersisted: false, mediaContentPersisted: false, screenshotsTracesOrHarSaved: false },
        failure: { phase: 'report', code: 'REDACTION_GUARD_FAILED' },
      };
      const fallbackText = JSON.stringify(fallback, null, 2) + '\n';
      ensure(!hasSensitiveValue(fallbackText, sensitiveValues), 'REDACTION_FALLBACK_FAILED');
      Object.assign(report, fallback);
      report.status = 'FAIL';
      report.failure = fallback.failure;
      process.exitCode = 1;
      await writeFile(reportPath, fallbackText, { flag: 'wx', mode: 0o600 });
      console.error(JSON.stringify({ status: 'FAIL', code: 'REDACTION_GUARD_FAILED', report: reportName }));
      return;
    }
    await writeFile(reportPath, serialized, { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ status: report.status, report: reportName, failure: report.failure?.code ?? null }));
  };

  try {
    await enterPhase('setup');
    sourceBytes = await readFile(fixturePath);
    sourceHash = hash(sourceBytes);
    report.fixture.sha256 = sourceHash;
    ffprobePath = chooseFfprobePath();
    const originalInfo = mediaInfo(ffprobePath, fixturePath);
    ensure(Math.abs(originalInfo.durationSeconds - 60) < 0.25 &&
      originalInfo.videoCodec === 'h264' && originalInfo.audioCodec === 'aac', 'FIXTURE_MEDIA_MISMATCH');
    report.correctness.originalFixtureReady = true;

    const { chromium } = await import('playwright');
    const profileRoot = await mkdtemp(join(tmpdir(), 'video-scissors-mcp-e2e-'));
    temporaryProfile = profileRoot;
    const downloads = join(profileRoot, 'downloads');
    await mkdir(downloads);
    chromeProcess = spawn(chooseChromePath(), [
      '--user-data-dir=' + profileRoot,
      '--remote-debugging-port=0',
      '--no-first-run',
      '--no-default-browser-check',
      'about:blank',
    ], { stdio: 'ignore' });
    chromeProcess.on('error', () => { chromeSpawnFailed = true; });

    let cdpPort = '';
    for (let attempt = 0; attempt < 300 && !cdpPort; attempt++) {
      if (chromeSpawnFailed || chromeProcess.exitCode !== null || chromeProcess.signalCode !== null) break;
      try { cdpPort = (await readFile(join(profileRoot, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; }
      catch { await delay(50); }
    }
    ensure(!chromeSpawnFailed, 'INSTALLED_CHROME_FAILED_TO_START');
    ensure(/^\d+$/.test(cdpPort), 'ISOLATED_BROWSER_CDP_UNAVAILABLE');
    browser = await chromium.connectOverCDP('http://127.0.0.1:' + cdpPort, { noDefaults: true });
    const context = browser.contexts()[0];
    ensure(Boolean(context), 'ISOLATED_BROWSER_CONTEXT_MISSING');
    context.setDefaultTimeout(15_000);
    context.setDefaultNavigationTimeout(20_000);
    await context.addInitScript(({ workerOrigin, allowWakeSocket, wakePathSource }) => {
      const workerUrl = new URL(workerOrigin);
      const socketOrigin = 'wss://' + workerUrl.host;
      const audit = { attempts: 0, accepted: 0, rejected: 0, sockets: [] };
      window.__videoScissorsMcpPhase = 'setup';
      Object.defineProperty(window, '__videoScissorsMcpSocketAudit', { value: audit });
      const NativeWebSocket = window.WebSocket;
      window.WebSocket = new Proxy(NativeWebSocket, {
        construct(target, args, newTarget) {
          audit.attempts++;
          let permitted = false;
          try {
            const url = new URL(String(args[0]), location.href);
            const protocols = Array.isArray(args[1]) ? args[1].map(String) : (args[1] == null ? [] : [String(args[1])]);
            const pathAllowed = new RegExp(wakePathSource, 'i').test(url.pathname);
            const protocolsAllowed = protocols.length === 2 &&
              protocols[0] === 'video-scissors-wakeup.v1' &&
              /^join\.[a-f0-9]{64}$/i.test(protocols[1]);
            permitted = allowWakeSocket && location.origin === workerUrl.origin &&
              url.origin === socketOrigin && url.protocol === 'wss:' && pathAllowed && protocolsAllowed;
          } catch { permitted = false; }
          if (!permitted) {
            audit.rejected++;
            throw new DOMException('staging runner WebSocket allowlist rejected the request', 'SecurityError');
          }
          audit.accepted++;
          const socket = Reflect.construct(target, args, newTarget);
          const record = { opened: false, closedAtUtc: null, closePhase: null, closeCode: null,
            closeReason: null, wasClean: null, errors: 0 };
          audit.sockets.push(record);
          socket.addEventListener('open', () => { record.opened = true; });
          socket.addEventListener('error', () => { record.errors++; });
          socket.addEventListener('close', event => {
            record.closedAtUtc = new Date().toISOString();
            record.closePhase = window.__videoScissorsMcpPhase ?? 'unknown';
            record.closeCode = event.code;
            record.closeReason = event.reason === 'disconnected' || event.reason === 'project-revoked'
              ? event.reason : 'other';
            record.wasClean = event.wasClean;
          });
          return socket;
        },
      });
    }, { workerOrigin: origin, allowWakeSocket: arm === 'do' || arm === 'd', wakePathSource: wakePathPattern(arm).source });

    cdp = await browser.newBrowserCDPSession();
    await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads, eventsEnabled: true });
    const requestRows = new WeakMap();
    await context.route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (isLocalSchemeUrl(request.url())) return route.continue();
      if (url.origin === mockClientOrigin && url.pathname === mockCallbackPath) {
        callbackUrl = request.url();
        callbackIntercepts++;
        return route.fulfill({
          status: 200,
          contentType: 'text/html; charset=utf-8',
          body: '<title>Local Video Scissors callback captured</title>',
        });
      }
      if (url.origin === origin) return route.continue();
      const inspected = inspectRequest(request.method(), '', request.postDataBuffer(), request.headers()['content-type'] ?? '');
      blockedRequests.push({ bytes: inspected.bytes, mediaOrLocalMarker: inspected.mediaOrLocalMarker,
        mediaType: inspected.mediaType, oversized: inspected.oversized });
      return route.abort();
    });
    context.on('request', request => {
      let url;
      try { url = new URL(request.url()); } catch { return; }
      if (isLocalSchemeUrl(request.url())) return;
      if (url.origin !== origin) return;
      const row = addRequest(request.method(), safePathname(url.pathname), request.postDataBuffer(),
        request.headers()['content-type'] ?? '', currentPhase);
      if (/video-scissors-mcp-fixture\.mp4|demo\.mp4|data:video|blob:|file:\/\/|\/private\/tmp\/|\/Users\//i.test(request.url())) {
        row.mediaOrLocalMarker = true;
      }
      requestRows.set(request, row);
    });
    context.on('requestfailed', request => {
      const row = requestRows.get(request);
      if (row) row.failureCode = classifyRequestFailure(request.failure()?.errorText);
    });
    context.on('requestfinished', request => {
      const row = requestRows.get(request);
      if (!row) return;
      const observation = {
        phase: currentPhase,
        atUtc: new Date().toISOString(),
        monotonic: performance.now(),
      };
      request.response().then(response => {
        if (response) finishRequest(row, response.status(), observation);
      }).catch(() => {});
    });

    await enterPhase('setup');
    appPage = await context.newPage();
    appPage.on('websocket', () => { appSocketCount++; });
    await appPage.goto(origin + '/tools/video-scissors');
    ensure(appPage.url() === origin + '/tools/video-scissors', 'VIDEO_SCISSORS_PAGE_NOT_OPEN');
    await appPage.getByRole('button', { name: 'Connect experimental ChatGPT control', exact: true }).waitFor({ state: 'visible' });

    const coreAssetResponse = appPage.waitForResponse(response => {
      try { return new URL(response.url()).pathname === '/tools/video-scissors/ffmpeg/core.wasm.gz'; }
      catch { return false; }
    }, { timeout: 10_000 }).catch(() => null);
    await appPage.locator('input[type=file]').setInputFiles({
      name: 'video-scissors-mcp-fixture.mp4',
      mimeType: 'video/mp4',
      buffer: sourceBytes,
    });
    const coreResponse = await coreAssetResponse;
    ensure(Boolean(coreResponse) && coreResponse.status() === 200, 'FFMPEG_CORE_RESPONSE_NOT_OK');
    await appPage.getByText('Video ready. Clip times use the original video.', { exact: true }).waitFor({ timeout: 90_000 });
    await enterPhase('connection');

    pairingStarted = true;
    await appPage.getByRole('button', { name: 'Connect experimental ChatGPT control', exact: true }).click();
    const proofPattern = pairingProofPattern(arm);
    const proof = (await appPage.locator('code').filter({ hasText: proofPattern }).textContent())?.trim();
    ensure(Boolean(proof && proofPattern.test(proof)), 'PAIRING_PROOF_NOT_PRESENT');
    sensitiveValues.add(proof);

    const callbackUri = mockClientOrigin + mockCallbackPath;
    const dcrBody = {
      client_name: 'InnoSage Video Scissors staging test',
      redirect_uris: [callbackUri],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    };
    const directPost = async (path, options, bodyForAudit) => {
      ensure(new URL(origin + path).origin === origin, 'DIRECT_REQUEST_ORIGIN_REJECTED');
      const row = addRequest('POST', safePathname(path), bodyForAudit,
        options.headers?.['Content-Type'] ?? options.headers?.['content-type'] ?? 'application/json', currentPhase);
      try {
        const response = await context.request.post(origin + path, { ...options, timeout: 20_000, maxRedirects: 0 });
        finishRequest(row, response.status());
        return response;
      } catch (error) {
        row.failureCode = safeErrorCode(error);
        delete row.startedMonotonic;
        throw Object.assign(new Error('DIRECT_REQUEST_FAILED'), { safeCode: 'DIRECT_REQUEST_FAILED' });
      }
    };

    const dcrResponse = await directPost('/oauth/register', {
      headers: { Origin: origin, 'Content-Type': 'application/json', Accept: 'application/json' },
      data: dcrBody,
    }, Buffer.from(JSON.stringify(dcrBody)));
    dcrStatus = dcrResponse.status();
    report.oauth.dcrStatus = dcrStatus;
    ensure(dcrStatus === 201, 'DCR_REGISTRATION_REJECTED');
    const client = await dcrResponse.json();
    collectSensitiveStrings(client, sensitiveValues);
    ensure(typeof client.client_id === 'string', 'DCR_CLIENT_ID_MISSING');

    const verifier = randomBytes(32).toString('base64url');
    const challenge = Buffer.from(await webcrypto.subtle.digest('SHA-256', Buffer.from(verifier))).toString('base64url');
    const state = randomBytes(18).toString('base64url');
    sensitiveValues.add(verifier);
    sensitiveValues.add(state);
    const authorizeQuery = new URLSearchParams({
      client_id: client.client_id,
      redirect_uri: callbackUri,
      response_type: 'code',
      scope: 'video:read video:edit',
      resource: origin + '/mcp',
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });
    consentPage = await context.newPage();
    consentPage.on('websocket', () => { appSocketCount++; });
    await consentPage.goto(origin + '/authorize?' + authorizeQuery.toString(), { waitUntil: 'domcontentloaded' });
    await consentPage.getByLabel('One-Time Browser Pairing Proof', { exact: true }).fill(proof);
    await consentPage.getByRole('button', { name: 'Approve', exact: true }).click();
    await consentPage.waitForURL(mockClientOrigin + '/**', { timeout: 20_000 });
    ensure(Boolean(callbackUrl) && callbackIntercepts === 1, 'SYNTHETIC_CALLBACK_NOT_INTERCEPTED');
    const callback = new URL(callbackUrl);
    ensure(callback.searchParams.get('state') === state && callback.searchParams.get('iss') === origin,
      'OAUTH_CALLBACK_STATE_OR_ISSUER_MISMATCH');
    const authorizationCode = callback.searchParams.get('code');
    ensure(Boolean(authorizationCode), 'OAUTH_AUTHORIZATION_CODE_MISSING');
    sensitiveValues.add(callbackUrl);
    sensitiveValues.add(authorizationCode);
    callbackUrl = '';
    report.oauth.authorizationAndPkce = 'PASS';
    report.oauth.callbackInterceptedLocally = true;
    authorizationStatus = 'PASS';

    const tokenForm = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: client.client_id,
      code: authorizationCode,
      code_verifier: verifier,
      redirect_uri: callbackUri,
      resource: origin + '/mcp',
    });
    const tokenResponse = await directPost('/oauth/token', {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      data: tokenForm.toString(),
    }, Buffer.from(tokenForm.toString()));
    tokenStatus = tokenResponse.status();
    report.oauth.tokenExchangeStatus = tokenStatus;
    ensure(tokenStatus === 200, 'OAUTH_TOKEN_EXCHANGE_REJECTED');
    const tokenResult = await tokenResponse.json();
    collectSensitiveStrings(tokenResult, sensitiveValues);
    const accessToken = tokenResult.access_token;
    ensure(typeof accessToken === 'string' && accessToken.length > 0, 'OAUTH_ACCESS_TOKEN_MISSING');
    sensitiveValues.add(accessToken);

    const apiPost = async (path, body) => {
      const payload = JSON.stringify(body);
      const response = await directPost(path, {
        headers: {
          Origin: origin,
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          Authorization: 'Bearer ' + accessToken,
          'MCP-Protocol-Version': '2025-06-18',
        },
        data: payload,
      }, Buffer.from(payload));
      const text = await response.text();
      const contentType = response.headers()['content-type'] ?? '';
      let parsed;
      try {
        const bodyText = contentType.includes('text/event-stream')
          ? text.split('\n').find(line => line.startsWith('data: '))?.slice(6)
          : text;
        ensure(Boolean(bodyText), 'MCP_RESPONSE_WITHOUT_DATA');
        parsed = JSON.parse(bodyText);
      } catch (error) {
        if (error?.safeCode) throw error;
        throw Object.assign(new Error('MCP_RESPONSE_INVALID'), { safeCode: 'MCP_RESPONSE_INVALID' });
      }
      collectSensitiveStrings(parsed, sensitiveValues);
      return { response, parsed };
    };

    await appPage.getByText('Connected', { exact: true }).waitFor({ timeout: 20_000 });
    if (arm === 'do' || arm === 'd') {
      await appPage.waitForFunction(() => window.__videoScissorsMcpSocketAudit?.sockets.some(socket => socket.opened),
        null, { timeout: 15_000 });
    }
    await consentPage.bringToFront();
    await appPage.waitForFunction(() => document.visibilityState === 'hidden', null, { timeout: 10_000 });
    await enterPhase('idle');
    const idleStartedAtUtc = new Date().toISOString();
    const idleStartedMonotonic = performance.now();
    await delay(120_000);
    const idleMonotonicMilliseconds = Math.round((performance.now() - idleStartedMonotonic) * 1000) / 1000;
    const appTabHiddenAtEnd = await appPage.evaluate(() => document.visibilityState === 'hidden');
    ensure(appTabHiddenAtEnd, 'IDLE_TAB_NOT_HIDDEN');
    idleWindow = {
      startedAtUtc: idleStartedAtUtc,
      endedAtUtc: new Date().toISOString(),
      targetMilliseconds: 120_000,
      elapsedMonotonicMilliseconds: idleMonotonicMilliseconds,
      appTabHiddenAtEnd,
    };
    report.idleWindow = idleWindow;

    let jsonRpcId = 1;
    const callMcp = async (tool, args = {}) => {
      if (tool === 'cut' || tool === 'undo') {
        const expected = matchedMutatingCommandSequence[mutatingMcpCommandSequence.length];
        ensure(tool === expected, 'MATCHED_COMMAND_SEQUENCE_INVALID');
        mutatingMcpCommandSequence.push(tool);
      }
      const phaseAtStart = currentPhase;
      const callStarted = performance.now();
      let httpStatus = null;
      let resultState = 'FAILED';
      try {
        const result = await apiPost('/mcp', {
          jsonrpc: '2.0',
          id: jsonRpcId++,
          method: 'tools/call',
          params: { name: tool, arguments: args },
        });
        httpStatus = result.response.status();
        ensure(httpStatus === 200 && result.parsed?.result, 'MCP_' + tool.toUpperCase() + '_HTTP_OR_RPC_FAILURE');
        const callResult = result.parsed.result;
        if (callResult.isError) {
          resultState = 'MCP_ERROR';
          throw Object.assign(new Error('MCP_TOOL_RETURNED_ERROR'), { safeCode: 'MCP_' + tool.toUpperCase() + '_ERROR' });
        }
        const content = callResult.content?.[0]?.text;
        ensure(typeof content === 'string', 'MCP_' + tool.toUpperCase() + '_CONTENT_MISSING');
        let value;
        try { value = JSON.parse(content); }
        catch { throw Object.assign(new Error('MCP_TOOL_CONTENT_INVALID'), { safeCode: 'MCP_' + tool.toUpperCase() + '_CONTENT_INVALID' }); }
        collectSensitiveStrings(value, sensitiveValues);
        resultState = typeof value?.state === 'string' ? value.state : 'RESULT';
        return value;
      } finally {
        mcpCalls.push({
          tool,
          phaseAtStart,
          httpStatus,
          resultState,
          elapsedMilliseconds: Math.round((performance.now() - callStarted) * 1000) / 1000,
        });
      }
    };

    const timeOperation = async (operation, action) => {
      const startedAtUtc = new Date().toISOString();
      const startedMonotonic = performance.now();
      let outcome = 'FAIL';
      try {
        const result = await action();
        outcome = 'PASS';
        return result;
      } finally {
        operationTimings.push({
          operation,
          startedAtUtc,
          completedAtUtc: new Date().toISOString(),
          totalElapsedMonotonicMilliseconds: Math.round((performance.now() - startedMonotonic) * 1000) / 1000,
          outcome,
          boundary: 'scripted MCP mutation request start through completed status after browser report; delivery and local compute are not separated',
        });
      }
    };

    const waitForCompletedReport = operationId => appPage.waitForResponse(response => {
      try {
        const url = new URL(response.url());
        return url.origin === origin && url.pathname === '/remote/report' &&
          response.request().method() === 'POST' && response.status() === 200 &&
          isCompletedOperationReport(response.request().postDataJSON(), operationId);
      } catch { return false; }
    }, { timeout: 90_000 }).then(() => true, () => false);
    const waitForCompleted = async (operationId, completedReport) => {
      ensure(await completedReport, 'COMPLETED_REPORT_NOT_OBSERVED');
      let status = await callMcp('status', { operationId });
      for (let attempt = 0; status?.state !== 'completed' && attempt < 12; attempt++) {
        await delay(500);
        status = await callMcp('status', { operationId });
      }
      ensure(status?.state === 'completed', 'OPERATION_DID_NOT_REACH_COMPLETED');
      return status;
    };
    const readClipPlan = () => appPage.locator('input[aria-label^="Clip "]').evaluateAll(inputs => inputs.map(input => ({
      label: input.getAttribute('aria-label'),
      seconds: input.valueAsNumber,
    })));
    const downloadCurrentOutput = async expectedDurationSeconds => {
      await appPage.bringToFront();
      await appPage.waitForFunction(expectedDuration => {
        const video = document.querySelector('video[aria-label="Edited video preview"]');
        if (!video || video.readyState < 1 || !Number.isFinite(video.duration) ||
          Math.abs(video.duration - expectedDuration) >= 0.25) return false;
        try { return new URL(video.currentSrc || video.src, location.href).protocol === 'blob:'; }
        catch { return false; }
      }, expectedDurationSeconds, { timeout: 20_000 });
      const downloadPromise = new Promise((resolvePromise, rejectPromise) => {
        let filename = '';
        const cleanup = () => {
          clearTimeout(timer);
          cdp.off('Browser.downloadWillBegin', onBegin);
          cdp.off('Browser.downloadProgress', onProgress);
        };
        const finish = (callback, value) => { cleanup(); callback(value); };
        const onBegin = event => { filename = event.suggestedFilename; };
        const onProgress = event => {
          if (event.state === 'completed') finish(resolvePromise, filename);
          if (event.state === 'canceled') finish(rejectPromise, Object.assign(new Error('DOWNLOAD_CANCELED'), { safeCode: 'DOWNLOAD_CANCELED' }));
        };
        const timer = setTimeout(() => finish(rejectPromise,
          Object.assign(new Error('DOWNLOAD_TIMEOUT'), { safeCode: 'DOWNLOAD_TIMEOUT' })), 30_000);
        cdp.on('Browser.downloadWillBegin', onBegin);
        cdp.on('Browser.downloadProgress', onProgress);
      });
      await appPage.getByRole('button', { name: 'Download cut MP4 video', exact: true }).click();
      const downloadedFilename = await downloadPromise;
      ensure(typeof downloadedFilename === 'string' && downloadedFilename.length > 0 &&
        !downloadedFilename.includes('/') && !downloadedFilename.includes('\\'), 'DOWNLOAD_FILENAME_INVALID');
      const downloadedPath = join(downloads, downloadedFilename);
      const downloadedStat = await stat(downloadedPath);
      ensure(downloadedStat.isFile() && downloadedStat.size > 0, 'DOWNLOAD_FILE_EMPTY');
      const downloadedBytes = await readFile(downloadedPath);
      const info = mediaInfo(ffprobePath, downloadedPath);
      ensure(Math.abs(info.durationSeconds - expectedDurationSeconds) < 0.2 &&
        info.videoCodec === 'h264' && info.audioCodec === 'aac', 'CUT_OUTPUT_FORMAT_OR_DURATION_MISMATCH');
      await consentPage.bringToFront();
      return {
        durationSeconds: info.durationSeconds,
        videoCodec: info.videoCodec,
        audioCodec: info.audioCodec,
        downloadedBytes: downloadedStat.size,
        sha256: hash(downloadedBytes),
      };
    };
    const expectedPlan = (start, end) => [
      { label: 'Clip 1 start time in seconds', seconds: start },
      { label: 'Clip 1 end time in seconds', seconds: end },
    ];

    await enterPhase('cut1');
    const beforeCut1 = await callMcp('getproject');
    ensure(beforeCut1?.metadata && beforeCut1.metadata.hasOutput === false && beforeCut1.metadata.canUndo === false,
      'PROJECT_NOT_AT_ORIGINAL_BASELINE');
    const cut1OperationId = randomUUID();
    sensitiveValues.add(cut1OperationId);
    await timeOperation('cut1', async () => {
      const completedReport = waitForCompletedReport(cut1OperationId);
      const queuedCut1 = await callMcp('cut', {
        operationId: cut1OperationId,
        generation: beforeCut1.metadata.generation,
        version: beforeCut1.metadata.version,
        clips: [{ start: 2, end: 4 }],
      });
      ensure(queuedCut1.operationId === cut1OperationId && queuedCut1.state === 'queued', 'CUT1_NOT_QUEUED');
      ensure(await appPage.evaluate(() => document.visibilityState) === 'hidden', 'CUT1_PAGE_NOT_HIDDEN');
      const completed = await waitForCompleted(cut1OperationId, completedReport);
      ensure(completed.metadata?.hasOutput === true && completed.metadata?.canUndo === true, 'CUT1_METADATA_MISMATCH');
      const cut1CompletedWhileHidden = await appPage.evaluate(() => document.visibilityState === 'hidden');
      ensure(cut1CompletedWhileHidden, 'CUT1_PAGE_NOT_HIDDEN');
      report.idleWindow.cut1CompletedWhileHidden = cut1CompletedWhileHidden;
    });
    await enterPhase('cut1-download-and-verify');
    const cut1Plan = await readClipPlan();
    ensure(JSON.stringify(cut1Plan) === JSON.stringify(expectedPlan(2, 4)), 'CUT1_PLAN_MISMATCH');
    const cut1Output = await downloadCurrentOutput(2);
    report.correctness.cut1 = 'PASS';
    report.correctness.outputs.cut1 = cut1Output;
    report.correctness.clipPlans.cut1 = cut1Plan;

    await enterPhase('cut2');
    const beforeCut2 = await callMcp('getproject');
    ensure(beforeCut2.metadata?.latestOperationId === cut1OperationId &&
      beforeCut2.metadata?.hasOutput === true && beforeCut2.metadata?.canUndo === true,
    'CUT1_NOT_LATEST_UNDO_TARGET');
    const cut2OperationId = randomUUID();
    sensitiveValues.add(cut2OperationId);
    await timeOperation('cut2', async () => {
      const completedReport = waitForCompletedReport(cut2OperationId);
      const queuedCut2 = await callMcp('cut', {
        operationId: cut2OperationId,
        generation: beforeCut2.metadata.generation,
        version: beforeCut2.metadata.version,
        clips: [{ start: 6, end: 10 }],
      });
      ensure(queuedCut2.operationId === cut2OperationId && queuedCut2.state === 'queued', 'CUT2_NOT_QUEUED');
      ensure(await appPage.evaluate(() => document.visibilityState) === 'hidden', 'CUT2_PAGE_NOT_HIDDEN');
      const completed = await waitForCompleted(cut2OperationId, completedReport);
      ensure(completed.metadata?.hasOutput === true && completed.metadata?.canUndo === true, 'CUT2_METADATA_MISMATCH');
    });
    await enterPhase('cut2-download-and-verify');
    const cut2Plan = await readClipPlan();
    ensure(JSON.stringify(cut2Plan) === JSON.stringify(expectedPlan(6, 10)), 'CUT2_PLAN_MISMATCH');
    const cut2Output = await downloadCurrentOutput(4);
    ensure(cut2Output.sha256 !== cut1Output.sha256, 'CUT2_OUTPUT_NOT_DISTINCT');
    report.correctness.cut2 = 'PASS';
    report.correctness.outputs.cut2 = cut2Output;
    report.correctness.clipPlans.cut2 = cut2Plan;

    await enterPhase('undo2');
    const beforeUndo2 = await callMcp('getproject');
    ensure(beforeUndo2.metadata?.latestOperationId === cut2OperationId, 'CUT2_NOT_LATEST_UNDO_TARGET');
    const undo2OperationId = randomUUID();
    sensitiveValues.add(undo2OperationId);
    await timeOperation('undo2', async () => {
      const completedReport = waitForCompletedReport(undo2OperationId);
      const queuedUndo2 = await callMcp('undo', {
        operationId: undo2OperationId,
        generation: beforeUndo2.metadata.generation,
        version: beforeUndo2.metadata.version,
        targetOperationId: cut2OperationId,
      });
      ensure(queuedUndo2.operationId === undo2OperationId && queuedUndo2.state === 'queued', 'UNDO2_NOT_QUEUED');
      ensure(await appPage.evaluate(() => document.visibilityState) === 'hidden', 'UNDO2_PAGE_NOT_HIDDEN');
      const completed = await waitForCompleted(undo2OperationId, completedReport);
      ensure(completed.metadata?.hasOutput === true, 'UNDO2_DID_NOT_RESTORE_CUT1_OUTPUT');
    });
    await enterPhase('undo2-download-and-verify');
    const afterUndo2 = await callMcp('getproject');
    ensure(afterUndo2.metadata?.hasOutput === true, 'UNDO2_PROJECT_READBACK_MISMATCH');
    const undo2Plan = await readClipPlan();
    ensure(JSON.stringify(undo2Plan) === JSON.stringify(cut1Plan), 'UNDO2_PLAN_NOT_RESTORED');
    const undo2Output = await downloadCurrentOutput(2);
    ensure(undo2Output.sha256 === cut1Output.sha256, 'UNDO2_BYTES_NOT_RESTORED');
    await appPage.bringToFront();
    const editedPreview = appPage.locator('video[aria-label="Edited video preview"]');
    await editedPreview.waitFor({ state: 'visible', timeout: 15_000 });
    previewObservation = await editedPreview.evaluate(video => {
      let sourceScheme = 'invalid';
      try { sourceScheme = new URL(video.currentSrc || video.src, location.href).protocol; } catch {}
      return {
        label: video.getAttribute('aria-label'),
        durationSeconds: Number.isFinite(video.duration) ? video.duration : null,
        readyState: video.readyState,
        sourceScheme,
      };
    });
    ensure(isPreviewReady(previewObservation, 'Edited video preview', 2), 'UNDO2_PREVIEW_NOT_RESTORED');
    report.correctness.undo2ToCut1 = 'PASS';
    report.correctness.outputs.undo2 = undo2Output;
    report.correctness.clipPlans.undo2 = undo2Plan;
    report.correctness.clipPlans.equal = JSON.stringify(undo2Plan) === JSON.stringify(cut1Plan);
    report.correctness.restoredPreview = {
      label: previewObservation.label,
      durationSeconds: previewObservation.durationSeconds,
      readyState: previewObservation.readyState,
      sourceScheme: previewObservation.sourceScheme,
    };
    const expectedMutationSequence = matchedMutatingCommandSequence.join(',');
    ensure(mutatingMcpCommandSequence.join(',') === expectedMutationSequence &&
      mcpCalls.filter(call => call.tool === 'cut' || call.tool === 'undo').map(call => call.tool).join(',') ===
      expectedMutationSequence && operationTimings.length === matchedMutatingCommandSequence.length,
    'MATCHED_COMMAND_COUNT_MISMATCH');
    await enterPhase('disconnect-cleanup');
    await appPage.bringToFront();
    explicitRevokeStarted = true;
    const dRevokeResponsePromise = arm === 'd'
      ? appPage.waitForResponse(response => {
        try {
          const url = new URL(response.url());
          return url.origin === origin && url.pathname === '/remote/revoke' && response.request().method() === 'POST';
        } catch { return false; }
      }, { timeout: 20_000 })
      : null;
    await appPage.getByRole('button', { name: 'Disconnect', exact: true }).click();
    if (dRevokeResponsePromise) {
      const revokeResponse = await dRevokeResponsePromise;
      let revokeBody;
      try { revokeBody = await revokeResponse.json(); }
      catch { revokeBody = null; }
      const closedSockets = revokeBody?.closedSockets;
      ensure(isDRevokeResponse(revokeResponse.status(), revokeBody), 'D_REVOKE_RESPONSE_INVALID');
      report.revoke = {
        dResponseCheck: 'PASS',
        httpStatus: revokeResponse.status(),
        ok: true,
        closedSockets,
        staleTokenDenied: 'NOT_RUN',
      };
    }
    await appPage.getByText('Disconnected', { exact: true }).waitFor({ timeout: 20_000 });
    uiDisconnected = true;
    cleanupDisconnect = 'PASS';
    const denied = await apiPost('/mcp', {
      jsonrpc: '2.0', id: jsonRpcId++, method: 'tools/call',
      params: { name: 'getproject', arguments: {} },
    });
    ensure(isRevokedProjectDenied(denied.response.status(), denied.parsed), 'REVOKED_TOKEN_STILL_ACCEPTED');
    report.revoke.staleTokenDenied = 'PASS';
    if (arm === 'do' || arm === 'd') {
      try {
        for (const page of [appPage, consentPage]) {
          if (!page || page.isClosed()) continue;
          await page.waitForFunction(() => window.__videoScissorsMcpSocketAudit &&
            window.__videoScissorsMcpSocketAudit.sockets.every(socket => socket.closedAtUtc), null, { timeout: 10_000 });
        }
      } catch { throw Object.assign(new Error('WAKE_CLOSE_NOT_OBSERVED'), { safeCode: 'WAKE_CLOSE_NOT_OBSERVED' }); }
    }
    socketAudit = await collectSocketAudit();
    const socketRecords = socketAudit?.sockets ?? [];
    report.websocket = {
      applicationSocketCount: appSocketCount,
      attempts: socketAudit?.attempts ?? 0,
      accepted: socketAudit?.accepted ?? 0,
      rejected: socketAudit?.rejected ?? 0,
      errors: socketRecords.reduce((total, socket) => total + socket.errors, 0),
      closeResults: socketRecords.map(socket => ({
        closed: Boolean(socket.closedAtUtc),
        closeCode: socket.closeCode,
        closeReason: socket.closeReason,
        wasClean: socket.wasClean,
        closePhase: socket.closePhase,
      })),
    };
    if (arm === 'do' || arm === 'd') {
      ensure(socketRecords.length > 0 && socketAudit.attempts === socketAudit.accepted &&
        socketAudit.rejected === 0 && socketRecords.every(socket => isAllowedSocketClose(socket, explicitRevokeStarted)),
      'WAKE_SOCKET_CLOSE_OR_SCOPE_INVALID');
    } else {
      ensure(appSocketCount === 0 && socketAudit.attempts === 0, 'UNEXPECTED_D1_APPLICATION_WEBSOCKET');
    }
    ensure(callbackIntercepts === 1, 'CALLBACK_INTERCEPT_COUNT_MISMATCH');
    ensure(requests.every(row => !row.mediaOrLocalMarker && !row.mediaType && !row.oversized),
      'PRIVACY_AUDIT_FOUND_MEDIA_OR_LOCAL_PATH');
    ensure(blockedRequests.every(row => !row.mediaOrLocalMarker && !row.mediaType && !row.oversized),
      'BLOCKED_EGRESS_BODY_AUDIT_FOUND_MEDIA');
    report.correctness.sourceUnchanged = hash(await readFile(fixturePath)) === sourceHash;
    sourceUnchanged = report.correctness.sourceUnchanged;
    ensure(sourceUnchanged, 'SOURCE_FIXTURE_CHANGED');
    report.privacy = {
      mediaEgressObserved: false,
      unsafeRequestBodiesObserved: false,
      rawAuthValuesOrIDsPersisted: false,
      mediaContentPersisted: false,
      screenshotsTracesOrHarSaved: false,
      blockedOffOriginRequestCount: blockedRequests.length,
      blockedOffOriginRiskyBodyCount: blockedRequests.filter(row => row.mediaOrLocalMarker || row.mediaType || row.oversized).length,
      bodyAuditBoundary: 'same-origin and blocked browser request bodies were inspected in memory; content and headers are not retained',
    };
    report.clientRequests = requestSummary(requests, phases.map(item => item.name));
    report.status = 'PASS';
  } catch (error) {
    failure = { phase: currentPhase, code: safeErrorCode(error) };
    report.status = 'FAIL';
  } finally {
    if (pairingStarted && !uiDisconnected && appPage && !appPage.isClosed()) {
      try {
        await enterPhase('disconnect-cleanup');
        await appPage.bringToFront();
        explicitRevokeStarted = true;
        await appPage.getByRole('button', { name: 'Disconnect', exact: true }).click({ timeout: 5_000 });
        await appPage.getByText('Disconnected', { exact: true }).waitFor({ timeout: 10_000 });
        uiDisconnected = true;
        cleanupDisconnect = 'PASS_AFTER_FAILURE';
      } catch { cleanupDisconnect = 'FAILED'; }
    } else if (uiDisconnected) cleanupDisconnect = cleanupDisconnect === 'PASS' ? 'PASS' : 'PASS_AFTER_FAILURE';
    report.cleanup.uiDisconnect = cleanupDisconnect;

    if ((arm === 'do' || arm === 'd') && pairingStarted) {
      for (const page of [appPage, consentPage]) {
        if (!page || page.isClosed()) continue;
        try {
          await page.waitForFunction(() => window.__videoScissorsMcpSocketAudit &&
            window.__videoScissorsMcpSocketAudit.sockets.every(socket => socket.closedAtUtc), null, { timeout: 10_000 });
        } catch {}
      }
    }
    socketAudit = await collectSocketAudit();
    if (socketAudit?.sockets) {
      const records = socketAudit.sockets;
      report.websocket = {
        applicationSocketCount: appSocketCount,
        attempts: socketAudit.attempts,
        accepted: socketAudit.accepted,
        rejected: socketAudit.rejected,
        errors: records.reduce((total, socket) => total + socket.errors, 0),
        closeResults: records.map(socket => ({
          closed: Boolean(socket.closedAtUtc),
          closeCode: socket.closeCode,
          closeReason: socket.closeReason,
          wasClean: socket.wasClean,
          closePhase: socket.closePhase,
        })),
      };
      if (report.status === 'PASS' && (socketAudit.rejected !== 0 || report.websocket.errors !== 0 ||
        ((arm === 'do' || arm === 'd') && !records.every(socket => isAllowedSocketClose(socket, explicitRevokeStarted))))) {
        failure = { phase: 'disconnect-cleanup', code: 'WEBSOCKET_ERROR_OR_ABNORMAL_CLOSE' };
        report.status = 'FAIL';
      }
    }
    report.websocket.applicationSocketCount = appSocketCount;
    await enterPhase('cleanup');
    if (pairingStarted && !uiDisconnected && !failure) {
      failure = { phase: 'disconnect-cleanup', code: 'DISCONNECT_NOT_CONFIRMED' };
      report.status = 'FAIL';
    }
    if (sourceHash) {
      try {
        sourceUnchanged = hash(await readFile(fixturePath)) === sourceHash;
        report.correctness.sourceUnchanged = sourceUnchanged;
        if (!sourceUnchanged && !failure) {
          failure = { phase: 'cleanup', code: 'SOURCE_FIXTURE_CHANGED' };
          report.status = 'FAIL';
        }
      } catch {
        sourceUnchanged = false;
        report.correctness.sourceUnchanged = false;
        if (!failure) {
          failure = { phase: 'cleanup', code: 'SOURCE_FIXTURE_READBACK_FAILED' };
          report.status = 'FAIL';
        }
      }
    }
    try { if (browser) await browser.close(); } catch {}
    const browserProcessCleanup = await stopChromeProcess(chromeProcess, chromeSpawnFailed);
    if (temporaryProfile && browserProcessCleanup !== 'STOP_STATUS_UNKNOWN') {
      try {
        await rm(temporaryProfile, { recursive: true, force: true });
        profileCleanup = 'REMOVED';
      } catch { profileCleanup = 'FAILED'; }
    } else if (temporaryProfile) {
      profileCleanup = 'NOT_REMOVED_PROCESS_STATUS_UNKNOWN';
    }
    report.cleanup.disposableProfile = profileCleanup;
    report.cleanup.uiDisconnect = cleanupDisconnect;
    report.oauth.dcrStatus = dcrStatus;
    report.oauth.authorizationAndPkce = authorizationStatus;
    report.oauth.tokenExchangeStatus = tokenStatus;
    report.finishedAtUtc = new Date().toISOString();
    report.elapsedMonotonicMilliseconds = Math.round((performance.now() - startedMonotonic) * 1000) / 1000;
    if (activePhase) {
      activePhase.endedAtUtc = report.finishedAtUtc;
      activePhase.elapsedMonotonicMilliseconds =
        Math.round((performance.now() - activePhase.startedMonotonic) * 1000) / 1000;
      delete activePhase.startedMonotonic;
    }
    report.clientRequests = requestSummary(requests, phases.map(item => item.name));
    report.privacy.blockedOffOriginRequestCount = blockedRequests.length;
    report.privacy.blockedOffOriginRiskyBodyCount =
      blockedRequests.filter(row => row.mediaOrLocalMarker || row.mediaType || row.oversized).length;
    report.privacy.unsafeRequestBodiesObserved =
      requests.some(row => row.mediaOrLocalMarker || row.mediaType || row.oversized) ||
      blockedRequests.some(row => row.mediaOrLocalMarker || row.mediaType || row.oversized);
    report.privacy.mediaEgressObserved = report.privacy.unsafeRequestBodiesObserved;
    report.cleanup.browserProcess = browserProcessCleanup;
    report.cleanup.disposableProfile = profileCleanup;
    report.failure = failure;
    if (failure || browserProcessCleanup === 'STOP_STATUS_UNKNOWN' ||
      profileCleanup !== 'REMOVED' || (pairingStarted && !uiDisconnected)) {
      report.status = 'FAIL';
      if (!failure) report.failure = {
        phase: 'cleanup',
        code: browserProcessCleanup === 'STOP_STATUS_UNKNOWN' ? 'BROWSER_PROCESS_STOP_NOT_CONFIRMED'
          : 'QUALIFICATION_OR_CLEANUP_INCOMPLETE',
      };
      process.exitCode = 1;
    }
    try { await persistReport(); }
    catch {
      process.exitCode = 1;
      console.error(JSON.stringify({ status: 'FAIL', code: 'REPORT_WRITE_FAILED', report: reportName }));
    }
  }
}

async function main() {
  const parsed = parseRunArgs(process.argv.slice(2));
  if (parsed.action === 'help') {
    console.log(usage);
    return;
  }
  await runLive(parsed.arm);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error(JSON.stringify({ status: 'FAIL', code: safeErrorCode(error) }));
    console.error(usage);
    process.exitCode = 2;
  });
}

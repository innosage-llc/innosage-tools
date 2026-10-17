import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  collectSensitiveStrings,
  hasSensitiveValue,
  isDRevokeResponse,
  isCompletedOperationReport,
  isRevokedProjectDenied,
  isAllowedSocketClose,
  isLocalSchemeUrl,
  isOriginalPreviewReady,
  isPreviewReady,
  matchedMutatingCommandSequence,
  pairingProofPattern,
  wakePathPattern,
  parseRunArgs,
  summarizeRequestPhases,
} from './video-scissors-mcp-e2e.mjs';

const runnerPath = fileURLToPath(new URL('./video-scissors-mcp-e2e.mjs', import.meta.url));

test('the offline CLI and fixture guards stay fail-closed', async t => {
  await t.test('no arguments and help only print usage', () => {
    for (const args of [[], ['--help']]) {
      const result = spawnSync(process.execPath, [runnerPath, ...args], { encoding: 'utf8' });
      assert.equal(result.status, 0);
      assert.match(result.stdout, /No arm is selected by default/);
      assert.doesNotMatch(result.stdout + result.stderr, /playwright|workers\.dev|oauth\/register/i);
    }
    assert.deepEqual(parseRunArgs([]), { action: 'help' });
    assert.deepEqual(parseRunArgs(['--help']), { action: 'help' });
  });

  await t.test('only the three fixed staging arms are accepted', () => {
    assert.deepEqual(parseRunArgs(['--arm', 'd1']), { action: 'run', arm: 'd1' });
    assert.deepEqual(parseRunArgs(['--arm', 'do']), { action: 'run', arm: 'do' });
    assert.deepEqual(parseRunArgs(['--arm', 'd']), { action: 'run', arm: 'd' });
    for (const args of [
      ['--arm', 'production'],
      ['--arm', 'https://example.com'],
      ['--arm', 'https://video-scissors-mcp-staging.innosage-draft.workers.dev'],
      ['--arm', 'staging'],
      ['--arm'],
      ['--arm', 'd1', '--help'],
    ]) {
      assert.throws(() => parseRunArgs(args), error => error.safeCode === 'ARM_NOT_ALLOWLISTED' ||
        error.safeCode === 'USAGE_INVALID');
    }
    const production = spawnSync(process.execPath, [runnerPath, '--arm', 'production'], { encoding: 'utf8' });
    assert.equal(production.status, 2);
    assert.match(production.stderr, /ARM_NOT_ALLOWLISTED/);
    assert.doesNotMatch(production.stdout + production.stderr, /https?:\/\//);
  });

  await t.test('the matched round is bounded to Cut 1, Cut 2, and Undo 2 mutations', () => {
    assert.deepEqual(matchedMutatingCommandSequence, ['cut', 'cut', 'undo']);
  });

  await t.test('pairing uses the existing arm-specific proof format', () => {
    assert.match('a'.repeat(64), pairingProofPattern('d1'));
    assert.match('a'.repeat(64), pairingProofPattern('do'));
    assert.match('Az_9-'.repeat(20), pairingProofPattern('d'));
    assert.doesNotMatch('a'.repeat(64), pairingProofPattern('d'));
    assert.doesNotMatch('Az_9-'.repeat(20), pairingProofPattern('d1'));
  });

  await t.test('wake paths and completion reports match the selected arm and operation', () => {
    const uuidPath = '/remote/bridge/12345678-1234-1234-1234-123456789abc/1';
    const dPath = '/remote/bridge/' + 'a'.repeat(64) + '/1';
    assert.match(uuidPath, wakePathPattern('do'));
    assert.match(dPath, wakePathPattern('d'));
    assert.doesNotMatch(uuidPath, wakePathPattern('d'));
    assert.doesNotMatch(dPath, wakePathPattern('do'));
    assert.equal(isCompletedOperationReport({ operationId: 'current', state: 'completed' }, 'current'), true);
    assert.equal(isCompletedOperationReport({ operationId: 'previous', state: 'completed' }, 'current'), false);
    assert.equal(isCompletedOperationReport({ operationId: 'current', state: 'running' }, 'current'), false);
  });

  await t.test('the restored original preview accepts metadata readiness', () => {
    assert.equal(isOriginalPreviewReady({
      label: 'Original video preview',
      durationSeconds: 60,
      readyState: 1,
      sourceScheme: 'blob:',
    }, 60), true);
    assert.equal(isOriginalPreviewReady({
      label: 'Original video preview',
      durationSeconds: 60,
      readyState: 0,
      sourceScheme: 'blob:',
    }, 60), false);
    assert.equal(isOriginalPreviewReady({
      label: 'Original video preview',
      durationSeconds: 59,
      readyState: 1,
      sourceScheme: 'blob:',
    }, 60), false);
    assert.equal(isOriginalPreviewReady({
      label: 'Cut video preview',
      durationSeconds: 60,
      readyState: 1,
      sourceScheme: 'blob:',
    }, 60), false);
    assert.equal(isOriginalPreviewReady({
      label: 'Original video preview',
      durationSeconds: 60,
      readyState: 1,
      sourceScheme: 'https:',
    }, 60), false);
  });

  await t.test('the restored Cut 1 preview and D revoke response are checked without retaining response data', () => {
    assert.equal(isPreviewReady({
      label: 'Edited video preview',
      durationSeconds: 2,
      readyState: 2,
      sourceScheme: 'blob:',
    }, 'Edited video preview', 2), true);
    assert.equal(isPreviewReady({
      label: 'Original video preview',
      durationSeconds: 2,
      readyState: 2,
      sourceScheme: 'blob:',
    }, 'Edited video preview', 2), false);
    assert.equal(isDRevokeResponse(200, { ok: true, closedSockets: 1 }), true);
    assert.equal(isDRevokeResponse(200, { ok: true, closedSockets: 0 }), true);
    assert.equal(isDRevokeResponse(503, { ok: true, closedSockets: 1 }), false);
    assert.equal(isDRevokeResponse(200, { ok: false, closedSockets: 1 }), false);
    assert.equal(isDRevokeResponse(200, { ok: true, closedSockets: -1 }), false);
    assert.equal(isDRevokeResponse(200, { ok: true, closedSockets: '1' }), false);
    const denied = { result: { isError: true, content: [{ type: 'text', text: 'PROJECT_EXPIRED_OR_REVOKED' }] } };
    assert.equal(isRevokedProjectDenied(200, denied), true);
    assert.equal(isRevokedProjectDenied(200, { result: { isError: false } }), false);
    assert.equal(isRevokedProjectDenied(200, { result: { isError: true, content: [{ type: 'text', text: 'COMMAND_REJECTED' }] } }), false);
    assert.equal(isRevokedProjectDenied(503, denied), false);
  });

  await t.test('browser-local media schemes are excluded from the network request audit', () => {
    assert.equal(isLocalSchemeUrl('blob:https://staging.example/opaque'), true);
    assert.equal(isLocalSchemeUrl('data:video/mp4;base64,local'), true);
    assert.equal(isLocalSchemeUrl('about:blank'), true);
    assert.equal(isLocalSchemeUrl('https://staging.example/tools?source=blob%3A'), false);
    assert.equal(isLocalSchemeUrl('not a URL'), false);
  });

  await t.test('1008 project revocation is allowed only for clean explicit revoke cleanup', () => {
    const base = {
      closedAtUtc: '2026-10-17T00:00:00.000Z',
      errors: 0,
      closeCode: 1008,
      closeReason: 'project-revoked',
      wasClean: true,
      closePhase: 'disconnect-cleanup',
    };
    assert.equal(isAllowedSocketClose(base, true), true);
    assert.equal(isAllowedSocketClose(base, false), false);
    assert.equal(isAllowedSocketClose({ ...base, closePhase: 'idle' }, true), false);
    assert.equal(isAllowedSocketClose({ ...base, wasClean: false }, true), false);
    assert.equal(isAllowedSocketClose({ ...base, errors: 1 }, true), false);
    const normalDisconnect = {
      ...base,
      closeCode: 1000,
      closeReason: 'disconnected',
    };
    assert.equal(isAllowedSocketClose(normalDisconnect, true), true);
    assert.equal(isAllowedSocketClose(normalDisconnect, false), false);
    assert.equal(isAllowedSocketClose({ ...normalDisconnect, wasClean: false }, true), false);
    assert.equal(isAllowedSocketClose({ ...normalDisconnect, closePhase: 'idle' }, true), false);
    assert.equal(isAllowedSocketClose({ ...base, closeCode: 1011, closeReason: 'other' }, true), false);
  });

  await t.test('completed MCP status and public metadata remain reportable while credentials and IDs are refused', () => {
    const credential = 'fake-private-credential-012';
    const accessToken = 'fake-private-access-token-123';
    const clientId = 'fake-private-client-id-456';
    const operationId = 'fake-private-operation-id-789';
    const completedMcpData = {
      state: 'completed',
      status: 'PASS',
      version: 'fixture-v1',
      generation: 7,
      resource: 'https://video-scissors-mcp-do-staging.innosage-draft.workers.dev/mcp',
      url: 'https://example.com/public-status',
      result: { operationId, state: 'completed' },
    };
    const collected = new Set();
    collectSensitiveStrings({
      credential,
      access_token: accessToken,
      client_id: clientId,
      mcpResult: completedMcpData,
    }, collected);

    assert.deepEqual(new Set([credential, accessToken, clientId, operationId]), collected);
    const reportable = JSON.stringify({
      status: 'PASS',
      resultState: completedMcpData.state,
      operationState: completedMcpData.result.state,
      version: completedMcpData.version,
      generation: completedMcpData.generation,
      resource: completedMcpData.resource,
      url: completedMcpData.url,
    });
    assert.equal(hasSensitiveValue(reportable, collected), false);
    assert.equal(hasSensitiveValue(JSON.stringify({ leakedCredential: credential }), collected), true);
    assert.equal(hasSensitiveValue(JSON.stringify({ leakedCredential: accessToken }), collected), true);
    assert.equal(hasSensitiveValue(JSON.stringify({ leakedIdentifier: operationId }), collected), true);
  });

  await t.test('client starts and response completions are assigned separately', () => {
    const rows = [
      { method: 'POST', path: '/mcp', status: 200, startPhase: 'cut', responsePhase: 'undo' },
      { method: 'GET', path: '/remote/poll', status: 200, startPhase: 'idle', responsePhase: 'idle' },
      { method: 'POST', path: '/oauth/token', status: null, startPhase: 'connection', responsePhase: null },
    ];
    const summary = summarizeRequestPhases(rows, ['connection', 'idle', 'cut', 'undo']);
    assert.equal(summary.cut.clientRequestStarts, 1);
    assert.equal(summary.cut.clientResponsesCompleted, 0);
    assert.equal(summary.cut.responsesCompletedAfterStartPhase, 1);
    assert.equal(summary.undo.clientRequestStarts, 0);
    assert.equal(summary.undo.clientResponsesCompleted, 1);
    assert.equal(summary.connection.startsWithoutResponseAtEnd, 1);
  });
});


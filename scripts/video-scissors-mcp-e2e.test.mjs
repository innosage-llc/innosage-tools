import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { isAllowedSocketClose, isOriginalPreviewReady, parseRunArgs, summarizeRequestPhases } from './video-scissors-mcp-e2e.mjs';

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

  await t.test('only the two existing staging arms are accepted', () => {
    assert.deepEqual(parseRunArgs(['--arm', 'd1']), { action: 'run', arm: 'd1' });
    assert.deepEqual(parseRunArgs(['--arm', 'do']), { action: 'run', arm: 'do' });
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
    assert.equal(isAllowedSocketClose({
      ...base,
      closeCode: 1000,
      closeReason: 'disconnected',
      wasClean: false,
      closePhase: 'idle',
    }, false), true);
    assert.equal(isAllowedSocketClose({ ...base, closeCode: 1011, closeReason: 'other' }, true), false);
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


import assert from 'node:assert/strict';
import test from 'node:test';
import { combinedAudioProgress, displayProgress, finitePositive, isActiveRun } from '../app/meeting-fixer/progress.ts';
import { RunLifecycle } from '../app/meeting-fixer/lifecycle.ts';

test('normalizes only finite positive durations', () => {
  assert.equal(finitePositive(0), null);
  assert.equal(finitePositive(Number.NaN), null);
  assert.equal(finitePositive(Number.POSITIVE_INFINITY), null);
  assert.equal(finitePositive(4), 4);
});

test('normalizes ffmpeg timestamp microseconds against combined duration', () => {
  assert.equal(combinedAudioProgress({ progress: 544.39, time: 5_000_000 }, 10), 0.5);
});

test('does not trust the raw ratio or unreliable timestamp', () => {
  assert.equal(combinedAudioProgress({ progress: 544.39, time: 0 }, 10), null);
  assert.equal(combinedAudioProgress({ progress: Number.NaN, time: 5_000_000 }, null), null);
  assert.equal(combinedAudioProgress({ progress: 0.5, time: 20_000_000 }, 10), null);
});

test('maps processing into a bounded range and reserves finalization', () => {
  assert.deepEqual(displayProgress('preparing', null), { stage: 'preparing', percent: 0 });
  assert.deepEqual(displayProgress('processing', 0.5), { stage: 'processing', percent: 50 });
  assert.deepEqual(displayProgress('processing', null), { stage: 'processing', percent: null });
  assert.deepEqual(displayProgress('finalizing', 1), { stage: 'finalizing', percent: 99 });
  assert.deepEqual(displayProgress('ready', 1), { stage: 'ready', percent: 100 });
});

test('rejects stale or no-longer-processing run events', () => {
  assert.equal(isActiveRun(4, 4, true), true);
  assert.equal(isActiveRun(4, 5, true), false);
  assert.equal(isActiveRun(4, 4, false), false);
});

test('terminates stale resources and only finishes the owning run', () => {
  const lifecycle = new RunLifecycle<{ terminate: () => void }>();
  const first = { terminated: 0, terminate() { this.terminated += 1; } };
  const stale = { terminated: 0, terminate() { this.terminated += 1; } };
  const firstRun = lifecycle.begin();
  assert.equal(lifecycle.claim(firstRun, first), true);
  const secondRun = lifecycle.invalidate();
  assert.equal(first.terminated, 1);
  assert.equal(lifecycle.claim(firstRun, stale), false);
  assert.equal(stale.terminated, 1);
  assert.equal(lifecycle.finish(secondRun, stale), true);
  assert.equal(stale.terminated, 2);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { combinedAudioProgress, displayProgress, finitePositive } from '../app/meeting-fixer/progress.ts';

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

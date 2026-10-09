import assert from 'node:assert/strict';
import test from 'node:test';
import { MEETING_OUTPUT_FORMATS, estimateWavBytes, outputCommand, outputFilename } from '../app/meeting-fixer/formats.ts';

test('defines one truthful contract for every Meeting Fixer output', () => {
  assert.deepEqual(Object.keys(MEETING_OUTPUT_FORMATS).sort(), ['m4a', 'mp3', 'wav']);
  assert.equal(MEETING_OUTPUT_FORMATS.mp3.mimeType, 'audio/mpeg');
  assert.equal(MEETING_OUTPUT_FORMATS.m4a.codec, 'aac');
  assert.equal(MEETING_OUTPUT_FORMATS.wav.codec, 'pcm_s16le');
  assert.equal(outputFilename('mp3'), 'fixed_meeting.mp3');
  assert.equal(outputFilename('m4a'), 'fixed_meeting.m4a');
  assert.equal(outputFilename('wav'), 'fixed_meeting.wav');
});

test('builds audio-only concat commands with explicit format encoders', () => {
  for (const [format, codec] of [['mp3', 'libmp3lame'], ['m4a', 'aac'], ['wav', 'pcm_s16le']] as const) {
    const command = outputCommand(format, `output.${format}`);
    assert.ok(command.includes('-filter_complex'));
    assert.ok(command.includes('-map') && command.includes('[out]'));
    assert.ok(command.includes(codec));
    assert.equal(command.at(-1), `output.${format}`);
    assert.ok(!command.includes('-vn'));
  }
});

test('estimates the documented stereo 48 kHz 16-bit WAV expansion', () => {
  assert.equal(estimateWavBytes(10), 1_920_044);
  assert.equal(estimateWavBytes(null), null);
  assert.equal(estimateWavBytes(Number.NaN), null);
});

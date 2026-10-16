import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  VIDEO_SCISSORS_LIMITS,
  VideoScissorsController,
  parseFfmpegMetadata,
  validateMetadata,
  validateSourceSize,
  validateVideoClips,
  videoScissorsFilter,
  type VideoClip,
  type VideoMetadata,
  type VideoScissorsRenderer,
} from '../lib/video-scissors.ts';

const metadata: VideoMetadata = {
  duration: 300,
  width: 1920,
  height: 1080,
  framesPerSecond: 30,
  videoCodec: 'h264',
  audioCodec: 'aac',
};

function file(name = 'fixture.mp4', size = 100): File {
  return Object.assign(new Blob([new Uint8Array(size)], { type: 'video/mp4' }), { name, lastModified: 0 }) as File;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function harness(overrides: Partial<VideoScissorsRenderer> = {}) {
  let nextUrl = 0;
  const revoked: string[] = [];
  const rendered: VideoClip[][] = [];
  const renderer: VideoScissorsRenderer = {
    inspect: async () => metadata,
    render: async (_file, clips) => { rendered.push(clips.map((clip) => ({ ...clip }))); return new Blob([`output-${rendered.length}`], { type: 'video/mp4' }); },
    ...overrides,
  };
  const controller = new VideoScissorsController({
    renderer,
    createObjectURL: () => `blob:test-${++nextUrl}`,
    revokeObjectURL: (url) => revoked.push(url),
  });
  return { controller, rendered, revoked };
}

async function select(controller: VideoScissorsController, source = file()): Promise<void> {
  await controller.selectSource(source, `select-${source.name}`);
  assert.equal(controller.getSnapshot().duration, metadata.duration);
}

function command(controller: VideoScissorsController, operationId: string) {
  const { sourceGeneration, version } = controller.getSnapshot();
  return { operationId, sourceGeneration, version };
}

test('source size and metadata limits accept exact boundaries and reject overages', () => {
  validateSourceSize(VIDEO_SCISSORS_LIMITS.maxSourceBytes);
  assert.throws(() => validateSourceSize(VIDEO_SCISSORS_LIMITS.maxSourceBytes + 1), /100,000,000/);
  validateMetadata(metadata);
  assert.throws(() => validateMetadata({ ...metadata, duration: 300.001 }), /300 seconds/);
  assert.throws(() => validateMetadata({ ...metadata, width: 1921 }), /1080p pixels/);
  assert.throws(() => validateMetadata({ ...metadata, framesPerSecond: 30.01 }), /30 frames/);
  assert.throws(() => validateMetadata({ ...metadata, videoCodec: 'hevc' }), /H.264 video and AAC audio/);
  assert.throws(() => validateMetadata({ ...metadata, audioCodec: 'mp3' }), /H.264 video and AAC audio/);
});

test('container and codec metadata come from FFmpeg input logs, not file names', () => {
  const log = [
    "Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'source.mp4':",
    '  Duration: 00:05:00.00, start: 0.000000, bitrate: 1200 kb/s',
    '    Stream #0:0: Video: h264 (High), yuv420p, 1920x1080, 30 fps, 30 tbr',
    '    Stream #0:1: Audio: aac (LC), 48000 Hz, stereo, fltp',
  ].join('\n');
  assert.deepEqual(parseFfmpegMetadata(log), metadata);
  assert.deepEqual(parseFfmpegMetadata(`${log}\nStream mapping:\nOutput #0, null, to 'pipe:':\n    Stream #0:0: Video: wrapped_avframe, yuv420p, 1920x1080, 30 fps\n    Stream #0:1: Audio: pcm_s16le, 48000 Hz, stereo`), metadata);
  assert.throws(() => parseFfmpegMetadata(log.replace('mov,mp4,m4a,3gp,3g2,mj2', 'matroska,webm')), /supported MP4/);
  assert.throws(() => parseFfmpegMetadata(log.replace('Video: h264', 'Video: hevc')), /supported MP4/);
  assert.throws(() => parseFfmpegMetadata(`${log}\n    Stream #0:2: Video: hevc, 1280x720, 24 fps`), /supported MP4/);
});

test('attached pictures before or after the primary stream do not become the video; real codec guards stay strict', () => {
  const header = "Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'source.mp4':\n  Duration: 00:05:00.00, start: 0.000000";
  const video = '    Stream #0:1[0x2](und): Video: h264 (High), yuv420p, 1920x1080, 30 fps';
  const audio = '    Stream #0:2[0x3](und): Audio: aac (LC), 48000 Hz, stereo';
  const picture = '    Stream #0:0[0x1]: Video: mjpeg (Baseline), yuvj420p, 64x64, 90000 tbr (attached pic)';
  const log = (lines: string[]) => [header, ...lines].join('\n');
  for (const lines of [[video, audio], [picture, video, audio], [video, audio, picture]]) {
    assert.deepEqual(parseFfmpegMetadata(log(lines)), metadata);
  }
  assert.deepEqual(parseFfmpegMetadata(log([video, audio, '    title: Video: mjpeg, 64x64, 90000 fps'])), metadata);
  // Neither a supported secondary stream nor a supported thumbnail can rescue
  // an unsupported real primary. Unsupported real secondaries remain rejected.
  const hevc = video.replace('h264', 'hevc');
  const supportedPicture = picture.replace('mjpeg', 'h264');
  for (const lines of [[hevc, video, audio], [supportedPicture, hevc, audio], [video, hevc, audio],
    [video, picture.replace(' (attached pic)', ''), audio], [picture, audio], [picture, video],
    [video, audio.replace('aac', 'mp3'), audio], [video, audio, audio.replace('aac', 'mp3')]]) {
    assert.throws(() => parseFfmpegMetadata(log(lines)), /supported MP4/);
  }
});

test('clip validation keeps original-relative order and enforces every range and output bound', () => {
  const clips = [{ start: 20, end: 25 }, { start: 2, end: 8 }];
  validateVideoClips(clips, 300);
  assert.throws(() => validateVideoClips([], 300), /at least one/);
  assert.throws(() => validateVideoClips([{ start: 2, end: 2 }], 300), /later than its start/);
  assert.throws(() => validateVideoClips([{ start: 5, end: 4 }], 300), /later than its start/);
  assert.throws(() => validateVideoClips([{ start: Number.NaN, end: 2 }], 300), /finite/);
  assert.throws(() => validateVideoClips([{ start: 0, end: 301 }], 300), /within the original/);
  assert.throws(() => validateVideoClips(Array.from({ length: 21 }, () => ({ start: 0, end: 1 })), 300), /no more than 20/);
  assert.throws(() => validateVideoClips([{ start: 0, end: 200 }, { start: 0, end: 101 }], 300), /combined output/);
});

test('a new plan replaces the prior plan and render receives intervals in displayed order', async () => {
  const { controller, rendered } = harness();
  await select(controller);
  const plan = [{ start: 20, end: 23 }, { start: 3, end: 7 }];
  assert.equal(controller.setSegments(plan), true);
  assert.deepEqual(controller.getSnapshot().segments, plan);
  await controller.cut(command(controller, 'cut-a'));
  assert.deepEqual(rendered[0], plan);
  controller.setSegments([{ start: 11, end: 14 }]);
  assert.deepEqual(controller.getSnapshot().segments, [{ start: 11, end: 14 }]);
  controller.dispose();
});

test('repeated cut IDs return the same task and render once', async () => {
  const gate = deferred<Blob>();
  const { controller } = harness({ render: async () => gate.promise });
  await select(controller);
  controller.setSegments([{ start: 1, end: 5 }]);
  const operation = command(controller, 'same-cut');
  const first = controller.cut(operation);
  const repeated = controller.cut(operation);
  assert.strictEqual(repeated, first);
  gate.resolve(new Blob(['only-once']));
  await first;
  assert.equal(controller.getSnapshot().hasOutput, true);
  controller.dispose();
});

test('one-level Undo restores first output after two cuts and cannot pop again', async () => {
  const { controller } = harness();
  await select(controller);
  const firstPlan = [{ start: 1, end: 4 }];
  controller.setSegments(firstPlan);
  await controller.cut(command(controller, 'cut-1'));
  const firstOutput = controller.getSnapshot().previewUrl;
  const secondPlan = [{ start: 8, end: 12 }];
  controller.setSegments(secondPlan);
  await controller.cut(command(controller, 'cut-2'));
  const secondOutput = controller.getSnapshot().previewUrl;

  assert.equal(controller.undo(command(controller, 'undo-2')), true);
  assert.equal(controller.getSnapshot().previewUrl, firstOutput);
  assert.deepEqual(controller.getSnapshot().segments, firstPlan);
  assert.equal(controller.getSnapshot().canUndo, false);
  assert.equal(controller.undo(command(controller, 'undo-2')), false);
  assert.equal(controller.undo(command(controller, 'another-undo')), false);
  assert.equal(controller.getSnapshot().previewUrl, firstOutput);
  assert.notEqual(firstOutput, secondOutput);
  controller.dispose();
});

test('Undo of a fresh first cut restores the original', async () => {
  const { controller } = harness();
  await select(controller);
  const originalUrl = controller.getSnapshot().originalUrl;
  controller.setSegments([{ start: 1, end: 4 }]);
  await controller.cut(command(controller, 'first-cut'));
  assert.equal(controller.undo(command(controller, 'first-undo')), true);
  assert.equal(controller.getSnapshot().originalUrl, originalUrl);
  assert.equal(controller.getSnapshot().previewUrl, null);
  assert.equal(controller.getSnapshot().hasOutput, false);
  assert.deepEqual(controller.getSnapshot().segments, []);
  controller.dispose();
});

test('accepted IDs cannot execute again after result-cache eviction with a fresh version', async () => {
  const { controller, rendered } = harness();
  await select(controller);
  controller.setSegments([{ start: 1, end: 4 }]);
  await controller.cut(command(controller, 'accepted-cut'));
  assert.equal(controller.undo(command(controller, 'accepted-undo')), true);
  for (let index = 0; index < 45; index++) {
    controller.setSegments([{ start: index, end: index + 1 }]);
    await controller.cut(command(controller, `later-cut-${index}`));
  }
  const before = controller.getSnapshot();
  const renders = rendered.length;
  assert.equal(controller.getOperationStatus('accepted-undo'), undefined);
  assert.equal(controller.undo(command(controller, 'accepted-undo')), false);
  await controller.cut(command(controller, 'accepted-cut'));
  assert.equal(rendered.length, renders);
  assert.strictEqual(controller.getSnapshot(), before);
  assert.equal(controller.undo(command(controller, 'fresh-undo')), true);
  controller.dispose();
});

test('Undo from a changed source generation or stale version cannot affect current output', async () => {
  const { controller } = harness();
  await select(controller);
  controller.setSegments([{ start: 0, end: 2 }]);
  await controller.cut(command(controller, 'cut-1'));
  const stale = command(controller, 'stale-undo');
  controller.setSegments([{ start: 3, end: 5 }]);
  assert.equal(controller.undo(stale), false);
  const currentUrl = controller.getSnapshot().previewUrl;
  await controller.selectSource(file('replacement.mp4'), 'replacement');
  assert.equal(controller.undo({ ...stale, operationId: 'old-source-undo' }), false);
  assert.notEqual(controller.getSnapshot().previewUrl, currentUrl);
  controller.dispose();
});

test('cancellation and renderer failure retain the previous completed preview and plan', async () => {
  const pending = deferred<Blob>();
  let shouldFail = false;
  const { controller } = harness({ render: async (_file, _clips, signal) => {
    if (shouldFail) throw new Error('controlled render failure');
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    return pending.promise;
  } });
  await select(controller);
  const originalPlan = [{ start: 1, end: 3 }];
  controller.setSegments(originalPlan);
  const firstTask = controller.cut(command(controller, 'cancel-me'));
  controller.cancel();
  pending.resolve(new Blob(['late output']));
  await firstTask;
  assert.equal(controller.getSnapshot().hasOutput, false);
  assert.deepEqual(controller.getSnapshot().segments, originalPlan);
  assert.equal(controller.getOperationStatus('cancel-me'), 'cancelled');

  const { controller: working } = harness({ render: async () => {
    if (shouldFail) throw new Error('controlled render failure');
    return new Blob(['first']);
  } });
  await select(working);
  working.setSegments(originalPlan);
  await working.cut(command(working, 'good-cut'));
  const before = working.getSnapshot();
  shouldFail = true;
  working.setSegments([{ start: 6, end: 9 }]);
  const failedTask = working.cut(command(working, 'fail-cut'));
  await failedTask;
  assert.equal(working.getSnapshot().previewUrl, before.previewUrl);
  assert.deepEqual(working.getSnapshot().segments, [{ start: 6, end: 9 }]);
  assert.match(working.getSnapshot().error ?? '', /previous preview and clip plan were kept/);
  controller.dispose();
  working.dispose();
});

test('source replacement makes older inspection completion stale', async () => {
  const oldInspection = deferred<VideoMetadata>();
  const { controller } = harness({ inspect: (input) => input.name === 'old.mp4' ? oldInspection.promise : Promise.resolve(metadata) });
  const oldTask = controller.selectSource(file('old.mp4'), 'old-source');
  const nextTask = controller.selectSource(file('new.mp4'), 'new-source');
  await nextTask;
  oldInspection.resolve({ ...metadata, duration: 20 });
  await oldTask;
  assert.equal(controller.getSnapshot().fileName, 'new.mp4');
  assert.equal(controller.getSnapshot().duration, 300);
  assert.equal(controller.getOperationStatus('old-source'), 'stale');
  controller.dispose();
});

test('every completion keeps only current and one previous output through at least four cuts', async () => {
  const { controller, revoked } = harness();
  await select(controller);
  const retainedBlobs = () => {
    const blobs = new Set<Blob>();
    const seen = new Set<object>();
    const visit = (value: unknown): void => {
      if (value instanceof Blob) { blobs.add(value); return; }
      if (!value || typeof value !== 'object' || seen.has(value)) return;
      seen.add(value);
      if (value instanceof Map || value instanceof Set) for (const entry of value.values()) visit(entry);
      else for (const entry of Object.values(value)) visit(entry);
    };
    visit(controller);
    return blobs.size;
  };
  for (let index = 1; index <= 6; index++) {
    controller.setSegments([{ start: index, end: index + 1 }]);
    await controller.cut(command(controller, `cut-${index}`));
    // The source is URL 1; exactly the two latest output URLs remain live.
    assert.equal(revoked.length, Math.max(0, index - 2));
    assert.equal(retainedBlobs(), 1 + Math.min(index, 2), 'source plus at most two output blobs');
  }
  assert.deepEqual(revoked, ['blob:test-2', 'blob:test-3', 'blob:test-4', 'blob:test-5']);
  assert.equal(controller.getSnapshot().canUndo, true);
  controller.undo(command(controller, 'undo-latest'));
  assert.equal(controller.getSnapshot().previewUrl, 'blob:test-6');
  assert.equal(controller.getSnapshot().canUndo, false);
  controller.dispose();
  assert.equal(retainedBlobs(), 0);
});

test('audio normalization preserves delayed onset and pads each sliced interval', (context) => {
  for (const start of [0, 1]) {
    const end = 6;
    const result = spawnSync('ffmpeg', [
      '-v', 'error', '-f', 'lavfi', '-i',
      'testsrc2=size=64x64:rate=10:duration=6[out0];sine=frequency=440:sample_rate=48000:duration=2,asetpts=PTS+1.978/TB[out1]',
      '-filter_complex', videoScissorsFilter([{ start, end }]),
      '-map', '[outv]', '-f', 'null', 'pipe:2',
      '-map', '[outa]', '-c:a', 'pcm_f32le', '-f', 'f32le', 'pipe:1',
    ], { maxBuffer: 4_000_000, timeout: 15_000 });
    if ((result.error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') {
      context.skip('Native FFmpeg unavailable; host browser/WASM fixture remains required.');
      return;
    }
    assert.equal(result.status, 0, result.stderr.toString());
    const samples = new DataView(result.stdout.buffer, result.stdout.byteOffset, result.stdout.byteLength);
    assert.equal(samples.byteLength / 4, (end - start) * 48000);
    const rms = (from: number, to: number) => {
      let squareSum = 0;
      for (let sample = Math.round(from * 48000); sample < Math.round(to * 48000); sample++) squareSum += samples.getFloat32(sample * 4, true) ** 2;
      return Math.sqrt(squareSum / Math.round((to - from) * 48000));
    };
    assert.equal(rms(0, 1.95 - start), 0, 'delayed input audio must not advance');
    assert.ok(rms(2.1 - start, 3.5 - start) > 0.05, 'tone stays at its source-relative position');
    assert.equal(rms(4.1 - start, 5.9 - start), 0, 'trailing gap must be padded through the clip end');
  }
});

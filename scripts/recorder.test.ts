import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectRecordingFormat } from '../app/recorder/lib/recording-format.ts';
import { reserveWebmDuration, durationBytes } from '../app/recorder/lib/webm-duration.ts';
import { DiskWriter, MEMORY_DOWNLOAD_LIMIT } from '../app/recorder/lib/disk-writer.ts';
import { RecordingEngine } from '../app/recorder/lib/recording-engine.ts';

const aac = selectRecordingFormat('audio', () => true);
const webm = selectRecordingFormat('audio', mime => mime.includes('webm'));
// Minimal Chromium-shaped unknown-size Segment; unrelated media bytes retained.
const header = Buffer.from('1a45dfa3801853806701ffffffffffffff1549a966872ad7b1830f42401654ae6b801f43b67501ffffffffffffffe78100', 'hex');
const webmBlob = () => new Blob([header, new Uint8Array(100)], { type: webm.mimeType });

test('explicit AAC preferred; never guess AAC from generic MP4 support', () => {
  assert.equal(aac.mimeType, 'audio/mp4;codecs=mp4a.40.2');
  assert.equal(aac.extension, '.m4a');
  assert.equal(selectRecordingFormat('audio', mime => mime === 'audio/mp4' || mime.includes('webm')).extension, '.webm');
  assert.throws(() => selectRecordingFormat('audio', () => false), /cannot encode/);
  assert.equal(selectRecordingFormat('video', () => true).mimeType, 'video/webm;codecs=vp8,opus');
});

test('bounded WebM Duration reservation preserves unknown Segment and media bytes', async () => {
  const original = webmBlob();
  const result = await reserveWebmDuration(original);
  const bytes = new Uint8Array(await result.chunk.arrayBuffer());
  assert.deepEqual(bytes.slice(9, 17), new Uint8Array(header.subarray(9, 17)));
  assert.deepEqual(bytes.slice(-100), new Uint8Array(100));
  assert.equal(result.scale, 1_000_000);
  bytes.set(durationBytes(60_123, result.scale), result.offset);
  assert.equal(new DataView(bytes.buffer).getFloat64(result.offset), 60_123);
  await assert.rejects(reserveWebmDuration(new Blob(['not webm'])), /header/);
  assert.throws(() => durationBytes(0, 1_000_000), /empty/);
});

test('header processing never reads a whole long recording', async () => {
  let largestRead = 0;
  class GuardedBlob extends Blob {
    override arrayBuffer(): Promise<ArrayBuffer> { throw new Error('whole file read'); }
    override slice(start = 0, end = this.size, type = ''): Blob {
      const result = super.slice(start, end, type);
      if (start === 0) largestRead = Math.max(largestRead, result.size);
      return result;
    }
  }
  const result = await reserveWebmDuration(new GuardedBlob([header, new Uint8Array(2_000_000)]));
  assert.equal(largestRead, 65536);
  assert.equal(result.chunk.size, header.length + 2_000_000 + 11);
});

function globals(values: Record<string, unknown>) {
  const descriptors = new Map(Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, value, writable: true });
  return () => { for (const [key, descriptor] of descriptors) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } };
}

async function disk(format = aac, overrides: Record<string, unknown> = {}) {
  const actions: string[] = [];
  const writes: unknown[] = [];
  const restore = globals({ window: { showSaveFilePicker: async (options: { types: unknown }) => {
    writes.push(options.types);
    return { name: `recording${format.extension}`, createWritable: async () => ({
      write: async (value: unknown) => { actions.push('write'); writes.push(value); },
      close: async () => { actions.push('close'); }, abort: async () => { actions.push('abort'); }, ...overrides,
    }) };
  } } });
  return { writer: await DiskWriter.create(`recording${format.extension}`, format), restore, actions, writes };
}

test('disk queue awaits slow final data before close; picker agrees with encoder', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const d = await disk(aac, { write: async () => { await gate; d.actions.push('written'); } });
  try {
    const write = d.writer.write(new Blob(['final bytes']));
    const close = d.writer.close(10);
    await Promise.resolve(); assert.deepEqual(d.actions, []);
    release(); await write; await close;
    assert.deepEqual(d.actions, ['written', 'close']);
    assert.match(JSON.stringify(d.writes[0]), /audio\/mp4/);
  } finally { d.restore(); }
});

test('WebM disk patches only eight bytes at Stop; no whole-recording buffer', async () => {
  const d = await disk(webm);
  try {
    await d.writer.write(webmBlob());
    for (let i = 0; i < 200; i++) await d.writer.write(new Blob([new Uint8Array(1024)]));
    await d.writer.close(60_000);
    const patch = d.writes.at(-1) as { type: string; position: number; data: Uint8Array };
    assert.equal(patch.type, 'write'); assert.equal(patch.data.length, 8);
    assert.equal(new DataView(patch.data.buffer).getFloat64(0), 60_000);
    assert.equal(d.actions.at(-1), 'close');
  } finally { d.restore(); }
});

test('picker cancel does not fall back; empty/write/close failures reject', async () => {
  const restore = globals({ window: { showSaveFilePicker: async () => { throw new DOMException('Cancelled', 'AbortError'); } } });
  try { await assert.rejects(DiskWriter.create('recording.m4a', aac), { name: 'AbortError' }); } finally { restore(); }
  const empty = await disk();
  try { await assert.rejects(empty.writer.close(0), /empty/); await empty.writer.abort(); } finally { empty.restore(); }
  for (const stage of ['write', 'close']) {
    const d = await disk(aac, { [stage]: async () => { throw new Error('disk full'); } });
    try {
      if (stage === 'write') await assert.rejects(d.writer.write(new Blob(['x'])), /disk full/);
      else await d.writer.write(new Blob(['x']));
      await assert.rejects(d.writer.close(100), /disk full/);
      await d.writer.abort(); assert.equal(d.actions.at(-1), 'abort');
    } finally { d.restore(); }
  }
});

test('slow-disk backlog has an explicit byte bound', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const d = await disk(aac, { write: async () => gate });
  try {
    const pending = d.writer.write(new Blob([new Uint8Array(16 * 1024 * 1024)]));
    await assert.rejects(d.writer.write(new Blob(['x'])), /cannot keep up/);
    release(); await pending; await d.writer.abort();
  } finally { d.restore(); }
});

test('one oversized browser delivery is accepted without whole-Blob reads', async () => {
  const d = await disk();
  try {
    class LargeBlob extends Blob { override arrayBuffer(): Promise<ArrayBuffer> { throw new Error('whole Blob read'); } }
    await d.writer.write(new LargeBlob([new Uint8Array(17 * 1024 * 1024)]));
    await d.writer.close(1000); assert.equal(d.actions.at(-1), 'close');
  } finally { d.restore(); }
});

test('fallback uses selected MIME/name and enforces a documented memory limit', async () => {
  let name = ''; let blob: Blob | undefined;
  const restore = globals({ window: {}, setTimeout: () => 0, document: { body: { appendChild() {} }, createElement: () => ({ set download(value: string) { name = value; }, click() {}, remove() {} }) } });
  const old = URL.createObjectURL; URL.createObjectURL = b => { blob = b as Blob; return 'blob:synthetic'; };
  try {
    const writer = await DiskWriter.create('recording.webm', webm);
    assert.equal(writer.isDiskWriter(), false);
    await writer.write(webmBlob()); await writer.close(2500);
    assert.equal(name, 'recording.webm'); assert.equal(blob?.type, webm.mimeType);
    const limited = await DiskWriter.create('long.m4a', aac);
    const piece = new Blob([new Uint8Array(16 * 1024 * 1024)]);
    for (let i = 0; i < MEMORY_DOWNLOAD_LIMIT / piece.size; i++) await limited.write(piece);
    await assert.rejects(limited.write(new Blob(['x'])), /256 MiB/); await limited.abort();
  } finally { restore(); URL.createObjectURL = old; }
});

test('engine immediate Stop, pause/resume, repeat cycles and failures settle only after saving', async () => {
  let time = 1000; let stoppedTracks = 0;
  const track = { stop: () => { stoppedTracks++; } };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track], getVideoTracks: () => [] };
  class Recorder {
    static latest: Recorder;
    state = 'inactive'; ondataavailable?: (e: { data: Blob }) => void; onstop?: () => Promise<void>;
    constructor() { Recorder.latest = this; }
    start() { this.state = 'recording'; } pause() { this.state = 'paused'; } resume() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; this.ondataavailable?.({ data: new Blob(['final']) }); void this.onstop?.(); }
  }
  const node = { connect() {}, disconnect() {}, gain: { setValueAtTime() {} } };
  class Context {
    currentTime = 0;
    createMediaStreamDestination() { return { stream, channelCount: 2, disconnect() {} }; }
    createMediaStreamSource() { return node; } createGain() { return node; }
    close() { return Promise.resolve(); }
  }
  const restore = globals({ navigator: { mediaDevices: { getUserMedia: async () => stream } }, MediaStream: class { addTrack() {} }, MediaRecorder: Recorder, AudioContext: Context, performance: { now: () => time } });
  try {
    for (const pause of [false, true, false]) {
      const d = await disk();
      try {
        const engine = new RecordingEngine({ mode: 'audio', audioBitrate: 128000, timeslice: 1000 });
        let saved = false; let duration = -1;
        engine.addEventListener('stopped', event => { saved = true; duration = (event as CustomEvent).detail.duration; });
        await engine.start(d.writer);
        time += 10;
        if (pause) { engine.pause(); time += 5000; engine.resume(); time += 90; }
        const stop = engine.stop(); assert.equal(saved, false); await stop;
        assert.equal(saved, true); assert.equal(duration, pause ? 100 : 10);
        assert.equal(d.actions.at(-1), 'close');
      } finally { d.restore(); }
    }
    const d = await disk(aac, { close: async () => { throw new Error('cannot save'); } });
    try {
      const engine = new RecordingEngine({ mode: 'audio', audioBitrate: 128000, timeslice: 1000 });
      let saved = false; let failed = false;
      engine.addEventListener('stopped', () => { saved = true; }); engine.addEventListener('recordingerror', () => { failed = true; });
      await engine.start(d.writer); time += 10; await assert.rejects(engine.stop(), /cannot save/);
      assert.equal(saved, false); assert.equal(failed, true);
    } finally { d.restore(); }
    for (const failWrite of [false, true]) {
      let release!: () => void;
      const gate = new Promise<void>(resolve => { release = resolve; });
      const slow = await disk(aac, { write: async () => { await gate; if (failWrite) throw new Error('late write failed'); } });
      try {
        const engine = new RecordingEngine({ mode: 'audio', audioBitrate: 128000, timeslice: 1000 });
        let saved = false; let failed = false;
        engine.addEventListener('stopped', () => { saved = true; }); engine.addEventListener('recordingerror', () => { failed = true; });
        await engine.start(slow.writer); time += 10;
        const before = stoppedTracks;
        const stopping = engine.stop();
        assert.ok(stoppedTracks > before, 'Stop releases microphone before pending writes settle');
        assert.equal(saved, false);
        release();
        if (failWrite) { await assert.rejects(stopping, /late write failed/); assert.equal(saved, false); assert.equal(failed, true); }
        else { await stopping; assert.equal(saved, true); }
      } finally { slow.restore(); }
    }
    assert.ok(stoppedTracks >= 4);
  } finally { restore(); }
});

// Reserve Duration in the first bounded WebM header, then patch only eight bytes
// at Stop. Never parse/remux the recording or turn its unknown-size Segment into
// a finite first-chunk Segment. Chromium MediaRecorder emits Info before Tracks.
const HEADER_LIMIT = 64 * 1024;
type Element = { id: number; start: number; data: number; end: number; unknown: boolean };

function element(bytes: Uint8Array, offset: number): Element {
  const start = offset;
  const width = (value: number, maximum: number) => {
    let n = 1;
    while (n <= maximum && !(value & (1 << (8 - n)))) n++;
    if (n > maximum) throw new Error('Unsupported WebM header.');
    return n;
  };
  const idWidth = width(bytes[offset], 4);
  let id = 0;
  for (let i = 0; i < idWidth; i++) id = id * 256 + bytes[offset++];
  const sizeWidth = width(bytes[offset], 8);
  let size = bytes[offset++] & ((1 << (8 - sizeWidth)) - 1);
  let unknown = size === ((1 << (8 - sizeWidth)) - 1);
  for (let i = 1; i < sizeWidth; i++) {
    unknown = unknown && bytes[offset] === 255;
    size = size * 256 + bytes[offset++];
  }
  if (offset > bytes.length) throw new Error('Truncated WebM header.');
  return { id, start, data: offset, end: unknown ? bytes.length : offset + size, unknown };
}

function sizeBytes(size: number): Uint8Array<ArrayBuffer> {
  let width = 1;
  while (size >= 2 ** (7 * width) - 1) width++;
  const bytes = new Uint8Array(width);
  for (let i = width - 1; i >= 0; i--) { bytes[i] = size % 256; size = Math.floor(size / 256); }
  bytes[0] |= 1 << (8 - width);
  return bytes;
}

export async function reserveWebmDuration(chunk: Blob): Promise<{ chunk: Blob; offset: number; scale: number }> {
  const bytes = new Uint8Array(await chunk.slice(0, HEADER_LIMIT).arrayBuffer());
  const ebml = element(bytes, 0);
  if (ebml.id !== 0x1a45dfa3 || ebml.unknown || ebml.end > bytes.length) throw new Error('Invalid WebM header.');
  const segment = element(bytes, ebml.end);
  if (segment.id !== 0x18538067 || !segment.unknown) throw new Error('Unsupported WebM Segment header.');
  let cursor = segment.data;
  while (cursor < bytes.length) {
    const info = element(bytes, cursor);
    // Inserting bytes would invalidate an existing SeekHead's relative offsets.
    if (info.id === 0x114d9b74) throw new Error('Indexed WebM headers are not supported for streaming recording.');
    if (info.unknown || info.end > bytes.length) throw new Error('WebM metadata exceeds the bounded header limit.');
    if (info.id === 0x1549a966) {
      let scale = 1_000_000;
      const parts: Uint8Array<ArrayBuffer>[] = [];
      let length = 0;
      for (let p = info.data; p < info.end;) {
        const child = element(bytes, p);
        if (child.unknown || child.end > info.end) throw new Error('Invalid WebM Info.');
        if (child.id === 0x2ad7b1) {
          scale = 0;
          for (const value of bytes.slice(child.data, child.end)) scale = scale * 256 + value;
          if (!Number.isSafeInteger(scale) || scale <= 0) throw new Error('Invalid WebM time scale.');
        }
        if (child.id !== 0x4489) { const part = bytes.slice(p, child.end); parts.push(part); length += part.length; }
        p = child.end;
      }
      const duration = new Uint8Array([0x44, 0x89, 0x88, 0, 0, 0, 0, 0, 0, 0, 0]);
      const size = sizeBytes(length + duration.length);
      const offset = info.start + 4 + size.length + length + 3;
      return {
        chunk: new Blob([bytes.slice(0, info.start), bytes.slice(info.start, info.start + 4), size, ...parts, duration, chunk.slice(info.end)], { type: chunk.type }),
        offset, scale,
      };
    }
    cursor = info.end;
  }
  throw new Error('WebM Info missing from first recording chunk.');
}

export function durationBytes(milliseconds: number, scale: number): Uint8Array<ArrayBuffer> {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) throw new Error('Recording is empty. Record for longer before saving.');
  const result = new Uint8Array(8);
  new DataView(result.buffer).setFloat64(0, milliseconds * 1_000_000 / scale, false);
  return result;
}

import type { RecordingFormat } from './recording-format.ts';
import { reserveWebmDuration, durationBytes } from './webm-duration.ts';

export const MEMORY_DOWNLOAD_LIMIT = 256 * 1024 * 1024;
const PENDING_WRITE_LIMIT = 16 * 1024 * 1024;

export class DiskWriter {
  private writer: FileSystemWritableFileStream | null = null;
  private chunks: Blob[] = [];
  private queue: Promise<void> = Promise.resolve();
  private failure: Error | null = null;
  private pendingBytes = 0;
  private size = 0;
  private durationOffset: number | null = null;
  private scale = 1_000_000;
  private ended = false;
  readonly format: RecordingFormat;
  private suggestedName: string;

  private constructor(name: string, format: RecordingFormat) { this.suggestedName = name; this.format = format; }
  static isSupported(): boolean { return typeof window.showSaveFilePicker === 'function'; }

  static async create(name: string, format: RecordingFormat): Promise<DiskWriter> {
    const result = new DiskWriter(name, format);
    if (this.isSupported()) {
      // Cancellation/errors do not silently start an in-memory recording.
      const handle = await window.showSaveFilePicker({ suggestedName: name, types: [{ description: format.description, accept: { [format.mimeType.split(';')[0]]: [format.extension] } }] });
      if (!handle.name.toLowerCase().endsWith(format.extension)) throw new Error(`Save this recording with the ${format.extension} extension.`);
      result.writer = await handle.createWritable();
    }
    return result;
  }

  write(source: Blob): Promise<void> {
    if (this.ended) return Promise.reject(new Error('Recording writer is closed.'));
    // A browser can emit one large Blob after throttling/backgrounding. Accept
    // that single delivery without copying it; bound additional waiting data.
    const weight = Math.min(source.size, PENDING_WRITE_LIMIT);
    if (this.pendingBytes + weight > PENDING_WRITE_LIMIT) return Promise.reject(new Error('The disk cannot keep up with recording. Recording stopped; no successful save was reported.'));
    this.pendingBytes += weight;
    const task = this.queue.then(async () => {
      if (this.failure) throw this.failure;
      let chunk = source;
      if (this.size === 0 && this.format.container === 'webm') {
        const header = await reserveWebmDuration(source);
        chunk = header.chunk; this.durationOffset = header.offset; this.scale = header.scale;
      }
      if (this.writer) await this.writer.write(chunk);
      else {
        if (this.size + chunk.size > MEMORY_DOWNLOAD_LIMIT) throw new Error('In-memory recording reached its 256 MiB limit. Use a browser with direct disk saving for longer recordings.');
        this.chunks.push(chunk);
      }
      this.size += chunk.size;
    });
    const tracked = task.finally(() => { this.pendingBytes -= weight; });
    this.queue = tracked.catch(error => { this.failure = error instanceof Error ? error : new Error('Recording write failed.'); });
    return tracked;
  }

  async close(milliseconds: number): Promise<void> {
    if (this.ended) throw new Error('Recording writer is closed.');
    this.ended = true;
    await this.queue;
    if (this.failure) throw this.failure;
    if (!this.size) throw new Error('Recording is empty. Record for longer before saving.');
    let blob = new Blob(this.chunks, { type: this.format.mimeType });
    if (this.durationOffset !== null) {
      const bytes = durationBytes(milliseconds, this.scale);
      if (this.writer) await this.writer.write({ type: 'write', position: this.durationOffset, data: bytes });
      else blob = new Blob([blob.slice(0, this.durationOffset), bytes, blob.slice(this.durationOffset + 8)], { type: this.format.mimeType });
    }
    if (this.writer) await this.writer.close();
    else {
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a'); link.href = url; link.download = this.suggestedName;
      document.body.appendChild(link); link.click(); link.remove();
      // Allow the browser download to acquire the Blob before revocation.
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    }
    this.chunks = [];
  }

  async abort(): Promise<void> {
    this.ended = true;
    await this.queue;
    this.chunks = [];
    if (this.writer) { try { await this.writer.abort(); } catch { /* It may already have closed/failed. */ } }
  }
  isDiskWriter(): boolean { return this.writer !== null; }
}

// Revision-bound lifecycle, independent of the browser encoder for deterministic tests.
export type MotionRenderer = (
  png: Blob,
  background: string,
  signal: AbortSignal,
  progress: (percent: number) => void,
) => Promise<Blob>;
export class RemixMotion {
  private pending: AbortController | null = null;
  private generation = 0;
  private identity = "";
  output: Blob | null = null;
  bind(identity: string): boolean {
    if (identity === this.identity) return false;
    this.identity = identity;
    this.cancel();
    this.output = null;
    return true;
  }
  cancel() {
    this.generation++;
    this.pending?.abort();
    this.pending = null;
  }
  async render(
    png: Blob,
    background: string,
    renderer: MotionRenderer,
    progress: (percent: number) => void,
  ): Promise<boolean> {
    if (this.pending) throw new Error("A motion export is already running.");
    const abort = new AbortController(),
      ticket = ++this.generation;
    this.pending = abort;
    try {
      const output = await renderer(png, background, abort.signal, (p) => {
        if (ticket === this.generation) progress(p);
      });
      if (ticket !== this.generation || abort.signal.aborted) return false;
      if (output.type !== "video/mp4" || !output.size)
        throw new Error(
          "Video processing returned an empty or invalid output.",
        );
      this.output = output;
      return true;
    } catch (error) {
      if (ticket !== this.generation || abort.signal.aborted) return false;
      throw error;
    } finally {
      if (ticket === this.generation) this.pending = null;
    }
  }
}

export function motionBackground(value: string): string {
  if (!/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(value))
    throw new Error("Choose a valid scene background color.");
  if (value.length === 9 && value.slice(7).toLowerCase() !== "ff")
    throw new Error(
      "MP4 does not support a transparent background. Apply an opaque background or keep the PNG export.",
    );
  return value.slice(0, 7);
}

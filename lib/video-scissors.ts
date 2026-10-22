import { isCoverPresetId, TITLE_CARD_SECONDS, type CoverPresetId } from './video-scissors-covers.ts';

export const VIDEO_SCISSORS_LIMITS = {
  maxSourceBytes: 100_000_000,
  maxDurationSeconds: 300,
  maxPixels: 1920 * 1080,
  maxFramesPerSecond: 30,
  maxClips: 20,
  maxOutputSeconds: 300,
  rememberedOperations: 20,
} as const;

export interface VideoClip {
  start: number;
  end: number;
}

export function videoScissorsFilter(clips: VideoClip[]): string {
  const parts: string[] = [];
  clips.forEach((clip, index) => {
    const start = clip.start.toFixed(6);
    const end = clip.end.toFixed(6);
    // Subtract the requested boundary, not the first video frame's PTS.
    parts.push(`[0:V:0]trim=start=${start}:end=${end},setpts=PTS-${start}/TB[v${index}]`);
    // Materialize the input audio origin and trailing silence before slicing.
    parts.push(`[0:a:0]aresample=async=1:first_pts=0,apad,atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS[a${index}]`);
  });
  parts.push(`${clips.map((_, index) => `[v${index}][a${index}]`).join('')}concat=n=${clips.length}:v=1:a=1[outv][outa]`);
  return parts.join(';');
}

export function videoScissorsCoverFilter(clips: VideoClip[], width: number, height: number): string {
  const footage = videoScissorsFilter(clips).replace('[outv][outa]', '[footv][foota]');
  return [footage,
    `[1:v]trim=duration=${TITLE_CARD_SECONDS},setpts=PTS-STARTPTS,setsar=1,format=yuv420p[cardv]`,
    `anullsrc=r=48000:cl=stereo,atrim=duration=${TITLE_CARD_SECONDS},asetpts=PTS-STARTPTS[carda]`,
    `[footv]scale=${width}:${height},setsar=1,fps=30,format=yuv420p[video]`,
    '[foota]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[audio]',
    '[cardv][carda][video][audio]concat=n=2:v=1:a=1[outv][outa]',
  ].join(';');
}

export interface VideoMetadata {
  duration: number;
  width: number;
  height: number;
  framesPerSecond: number;
  videoCodec: string;
  audioCodec: string;
}

function parseClock(value: string): number | null {
  const match = /^(\d+):(\d{2}):(\d{2}(?:\.\d+)?)$/.exec(value);
  if (!match) return null;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

export function parseFfmpegMetadata(log: string): VideoMetadata {
  // The zero-frame inspection also reports its null output codecs. Only the
  // input section describes the selected media.
  log = log.split(/\n\s*(?:Stream mapping:|Output #)/, 1)[0];
  const inputLine = log.split('\n').find((line) => /^\s*Input #0,/.test(line));
  if (!inputLine || !/^\s*Input #0,\s*(?:mov,mp4|mp4|mov)(?:,|\s)/i.test(inputLine)) {
    throw new Error('The selected file is not a supported MP4 video or is corrupt.');
  }
  const durationMatch = /Duration:\s*(\d+:\d{2}:\d{2}(?:\.\d+)?)/.exec(log);
  // Match actual input stream headers, not metadata tags containing codec words.
  const streamLines = log.split('\n').filter((line) => /^\s*Stream #0:\d+(?:\[[^\]]*\])?(?:\([^)]*\))?:\s+(?:Video|Audio):/.test(line));
  // Cover art is a video entry too. Keep the existing guards for every real
  // video/audio stream, then use the first real video and first audio as V:0/a:0.
  const videoLines = streamLines.filter((line) => /\bVideo:/.test(line) && !/\(attached pic\)/i.test(line));
  const audioLines = streamLines.filter((line) => /\bAudio:/.test(line));
  const videoLine = videoLines[0];
  const audioLine = audioLines[0];
  if (!videoLine || videoLines.some((line) => !/Video:\s*h264\b/i.test(line)) || !audioLine || audioLines.some((line) => !/Audio:\s*aac\b/i.test(line))) {
    throw new Error('The selected file is not a supported MP4 video or is corrupt.');
  }
  const dimensions = videoLine && /(?:^|\s)(\d{2,5})x(\d{2,5})(?:\s|,|$)/.exec(videoLine);
  const frameRate = videoLine && /(?:^|\s)(\d+(?:\.\d+)?)\s+fps\b/.exec(videoLine);
  const duration = durationMatch ? parseClock(durationMatch[1]) : null;
  if (!duration || !dimensions || !frameRate) {
    throw new Error('The selected file is not a supported MP4 video or is corrupt.');
  }
  return {
    duration,
    width: Number(dimensions[1]),
    height: Number(dimensions[2]),
    framesPerSecond: Number(frameRate[1]),
    videoCodec: 'h264',
    audioCodec: 'aac',
  };
}

export interface VideoScissorsSnapshot {
  sourceGeneration: number;
  version: number;
  fileName: string | null;
  duration: number;
  originalUrl: string | null;
  previewUrl: string | null;
  segments: VideoClip[];
  busy: boolean;
  progress: number;
  status: string;
  error: string | null;
  canUndo: boolean;
  hasOutput: boolean;
  coverPresetId: CoverPresetId | null;
}

export interface VideoScissorsCommand {
  operationId: string;
  sourceGeneration: number;
  version: number;
}

export interface VideoScissorsRenderer {
  inspect(file: File, signal: AbortSignal): Promise<VideoMetadata>;
  render(
    file: File,
    clips: VideoClip[],
    signal: AbortSignal,
    onProgress: (progress: number) => void,
    cover?: { presetId: CoverPresetId; metadata: VideoMetadata },
  ): Promise<Blob>;
}

export interface VideoScissorsControllerOptions {
  renderer: VideoScissorsRenderer;
  createObjectURL?: (blob: Blob) => string;
  revokeObjectURL?: (url: string) => void;
}

export function validateSourceSize(bytes: number): void {
  if (!Number.isFinite(bytes) || bytes < 0) throw new Error('The selected file has an invalid size.');
  if (bytes > VIDEO_SCISSORS_LIMITS.maxSourceBytes) {
    throw new Error('Choose an MP4 file no larger than 100,000,000 bytes.');
  }
}

export function validateMetadata(metadata: VideoMetadata): void {
  if (!Number.isFinite(metadata.duration) || metadata.duration <= 0) {
    throw new Error('The MP4 duration could not be read. Check that the file is not corrupt.');
  }
  if (metadata.duration > VIDEO_SCISSORS_LIMITS.maxDurationSeconds) {
    throw new Error('Choose an MP4 video no longer than 300 seconds.');
  }
  if (!Number.isInteger(metadata.width) || !Number.isInteger(metadata.height) || metadata.width <= 0 || metadata.height <= 0) {
    throw new Error('The video dimensions could not be read. Check that the file is not corrupt.');
  }
  if (metadata.width * metadata.height > VIDEO_SCISSORS_LIMITS.maxPixels) {
    throw new Error('Choose a video with no more than 1080p pixels.');
  }
  if (!Number.isFinite(metadata.framesPerSecond) || metadata.framesPerSecond <= 0 || metadata.framesPerSecond > VIDEO_SCISSORS_LIMITS.maxFramesPerSecond) {
    throw new Error('Choose a video recorded at no more than 30 frames per second.');
  }
  if (metadata.videoCodec !== 'h264' || metadata.audioCodec !== 'aac') {
    throw new Error('Only MP4 files with H.264 video and AAC audio are supported.');
  }
}

export function validateVideoClips(clips: VideoClip[], duration: number): void {
  if (clips.length === 0) throw new Error('Add at least one clip before cutting the video.');
  if (clips.length > VIDEO_SCISSORS_LIMITS.maxClips) {
    throw new Error('A cut can contain no more than 20 clips.');
  }
  let total = 0;
  for (const clip of clips) {
    if (!Number.isFinite(clip.start) || !Number.isFinite(clip.end)) {
      throw new Error('Clip times must be finite numbers.');
    }
    if (clip.start < 0 || clip.end > duration) {
      throw new Error('Each clip must stay within the original video duration.');
    }
    if (clip.end <= clip.start) throw new Error('Each clip end must be later than its start.');
    total += clip.end - clip.start;
  }
  if (total > VIDEO_SCISSORS_LIMITS.maxOutputSeconds) {
    throw new Error('The combined output cannot be longer than 300 seconds.');
  }
}

interface StableView {
  segments: VideoClip[];
  previewUrl: string | null;
  outputBlob: Blob | null;
  coverPresetId: CoverPresetId | null;
}

interface ActiveOperation {
  id: string;
  kind: 'inspect' | 'cut';
  sourceGeneration: number;
  abort: AbortController;
}

export type OperationStatus = 'running' | 'completed' | 'failed' | 'cancelled' | 'stale';

export class VideoScissorsController {
  private readonly renderer: VideoScissorsRenderer;
  private readonly makeUrl: (blob: Blob) => string;
  private readonly revokeUrl: (url: string) => void;
  private readonly listeners = new Set<() => void>();
  private readonly commandResults = new Map<string, Promise<unknown>>();
  // Session-lifetime tombstones contain IDs only, never media or result closures.
  private readonly acceptedIds = new Set<string>();
  private readonly operationStatuses = new Map<string, OperationStatus>();
  private completed: StableView | null = null;
  private snapshot: VideoScissorsSnapshot = {
    sourceGeneration: 0,
    version: 0,
    fileName: null,
    duration: 0,
    originalUrl: null,
    previewUrl: null,
    segments: [],
    busy: false,
    progress: 0,
    status: '',
    error: null,
    canUndo: false,
    hasOutput: false,
    coverPresetId: null,
  };
  private source: File | null = null;
  private metadata: VideoMetadata | null = null;
  private active: ActiveOperation | null = null;
  private outputBlob: Blob | null = null;
  private latestCompletedPlan: VideoClip[] = [];
  private disposed = false;

  constructor(options: VideoScissorsControllerOptions) {
    this.renderer = options.renderer;
    this.makeUrl = options.createObjectURL ?? ((blob) => URL.createObjectURL(blob));
    this.revokeUrl = options.revokeObjectURL ?? ((url) => URL.revokeObjectURL(url));
  }

  getSnapshot = (): VideoScissorsSnapshot => this.snapshot;

  getOperationStatus(operationId: string): OperationStatus | undefined {
    return this.operationStatuses.get(operationId);
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  selectSource(file: File, operationId = this.newOperationId('source')): Promise<void> {
    const existing = this.commandResults.get(operationId) as Promise<void> | undefined;
    if (existing) return existing;
    if (this.disposed || this.acceptedIds.has(operationId)) return Promise.resolve();
    this.acceptedIds.add(operationId);
    const generation = this.snapshot.sourceGeneration + 1;
    this.invalidateActive();
    this.clearOutputHistory();
    if (this.snapshot.originalUrl) this.revokeUrl(this.snapshot.originalUrl);
    this.source = null;
    this.metadata = null;
    this.outputBlob = null;
    this.latestCompletedPlan = [];
    this.snapshot = {
      sourceGeneration: generation,
      version: this.snapshot.version + 1,
      fileName: file.name,
      duration: 0,
      originalUrl: this.makeUrl(file),
      previewUrl: null,
      segments: [],
      busy: true,
      progress: 0,
      status: 'Checking local video…',
      error: null,
      canUndo: false,
      hasOutput: false,
      coverPresetId: null,
    };
    this.publish();
    const abort = new AbortController();
    this.active = { id: operationId, kind: 'inspect', sourceGeneration: generation, abort };
    this.operationStatuses.set(operationId, 'running');
    const task = this.inspectSource(file, operationId, generation, abort);
    this.rememberCommand(operationId, task);
    return task;
  }

  setSegments(segments: VideoClip[], sourceGeneration = this.snapshot.sourceGeneration): boolean {
    if (this.disposed || this.snapshot.busy || !this.source || sourceGeneration !== this.snapshot.sourceGeneration) return false;
    // Keep temporary editor values visible; the Cut operation validates the complete plan.
    this.snapshot = { ...this.snapshot, version: this.snapshot.version + 1, segments: segments.map((clip) => ({ ...clip })), error: null, status: '' };
    this.publish();
    return true;
  }

  cut(command: VideoScissorsCommand): Promise<void> {
    return this.renderPlan(command, this.snapshot.segments, this.snapshot.coverPresetId);
  }

  applyCoverPreset(command: VideoScissorsCommand, presetId: unknown): Promise<void> {
    if (!isCoverPresetId(presetId)) return Promise.resolve();
    // Always render from the original source, never prepend to a rendered output.
    const clips = this.snapshot.segments.length ? this.snapshot.segments : [{ start: 0, end: this.snapshot.duration }];
    return this.renderPlan(command, clips, presetId);
  }

  private renderPlan(command: VideoScissorsCommand, plan: VideoClip[], presetId: CoverPresetId | null): Promise<void> {
    const existing = this.commandResults.get(command.operationId) as Promise<void> | undefined;
    if (existing) return existing;
    if (this.acceptedIds.has(command.operationId)) return Promise.resolve();
    if (!this.isCurrent(command) || !this.source || !this.metadata || this.snapshot.busy) return Promise.resolve();
    if (!this.validateCutPlan(plan, presetId)) return Promise.resolve();
    const source = this.source;
    this.acceptedIds.add(command.operationId);
    const generation = this.snapshot.sourceGeneration;
    const clips = plan.map((clip) => ({ ...clip }));
    const before: StableView = { segments: this.latestCompletedPlan.map((clip) => ({ ...clip })), previewUrl: this.snapshot.previewUrl, outputBlob: this.outputBlob, coverPresetId: this.snapshot.coverPresetId };
    const abort = new AbortController();
    this.active = { id: command.operationId, kind: 'cut', sourceGeneration: generation, abort };
    this.operationStatuses.set(command.operationId, 'running');
    this.snapshot = { ...this.snapshot, version: this.snapshot.version + 1, busy: true, progress: 0, status: 'Preparing local video…', error: null };
    this.publish();
    const task = this.renderCut(command.operationId, generation, source, clips, before, abort, presetId);
    this.rememberCommand(command.operationId, task);
    return task;
  }

  validateCutPlan(clips: VideoClip[], presetId = this.snapshot.coverPresetId): boolean {
    try {
      validateVideoClips(clips, this.snapshot.duration);
      if (presetId && clips.reduce((total, clip) => total + clip.end - clip.start, TITLE_CARD_SECONDS) > VIDEO_SCISSORS_LIMITS.maxOutputSeconds) {
        throw new Error('The title card and clips together cannot exceed 300 seconds. Shorten the clip plan.');
      }
      return true;
    }
    catch (error) { this.setError(error instanceof Error ? error.message : 'The clip plan is invalid.'); return false; }
  }

  cancel(): void {
    if (!this.active) return;
    const active = this.active;
    active.abort.abort();
    this.active = null;
    this.operationStatuses.set(active.id, 'cancelled');
    this.snapshot = { ...this.snapshot, version: this.snapshot.version + 1, busy: false, progress: 0, status: 'Processing cancelled. Your previous preview and clip plan were kept.' };
    this.publish();
  }

  undo(command: VideoScissorsCommand): boolean {
    if (this.acceptedIds.has(command.operationId)) return false;
    if (!this.isCurrent(command) || this.snapshot.busy || !this.completed) return false;
    this.acceptedIds.add(command.operationId);
    const latest = this.completed;
    this.completed = null;
    if (this.snapshot.previewUrl && this.snapshot.previewUrl !== latest.previewUrl) this.revokeUrl(this.snapshot.previewUrl);
    this.outputBlob = latest.outputBlob;
    this.latestCompletedPlan = latest.segments.map((clip) => ({ ...clip }));
    this.snapshot = {
      ...this.snapshot,
      version: this.snapshot.version + 1,
      segments: latest.segments.map((clip) => ({ ...clip })),
      previewUrl: latest.previewUrl,
      coverPresetId: latest.coverPresetId,
      canUndo: false,
      hasOutput: this.outputBlob !== null,
      status: 'Previous completed edit restored.',
      error: null,
    };
    this.rememberCommand(command.operationId, Promise.resolve(true));
    this.operationStatuses.set(command.operationId, 'completed');
    this.publish();
    return true;
  }

  createDownload(): { blob: Blob; fileName: string } | null {
    if (!this.outputBlob || !this.snapshot.hasOutput) return null;
    const baseName = (this.snapshot.fileName ?? 'video').replace(/\.mp4$/i, '') || 'video';
    return { blob: this.outputBlob, fileName: `${baseName}-cut.mp4` };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.invalidateActive();
    const urls = new Set<string>();
    if (this.snapshot.originalUrl) urls.add(this.snapshot.originalUrl);
    if (this.snapshot.previewUrl) urls.add(this.snapshot.previewUrl);
    if (this.completed?.previewUrl) urls.add(this.completed.previewUrl);
    for (const url of urls) this.revokeUrl(url);
    this.completed = null;
    this.outputBlob = null;
    this.source = null;
    this.listeners.clear();
  }

  private async inspectSource(file: File, id: string, generation: number, abort: AbortController): Promise<void> {
    try {
      validateSourceSize(file.size);
      const metadata = await this.renderer.inspect(file, abort.signal);
      validateMetadata(metadata);
      if (!this.isActive(id, generation) || abort.signal.aborted) {
        if (this.operationStatuses.get(id) === 'running') this.operationStatuses.set(id, 'stale');
        return;
      }
      this.source = file;
      this.metadata = metadata;
      this.active = null;
      this.operationStatuses.set(id, 'completed');
      this.snapshot = { ...this.snapshot, version: this.snapshot.version + 1, duration: metadata.duration, busy: false, status: 'Video ready. Clip times use the original video.', error: null };
      this.publish();
    } catch (error) {
      if (!this.isActive(id, generation)) {
        if (this.operationStatuses.get(id) === 'running') this.operationStatuses.set(id, 'stale');
        return;
      }
      this.active = null;
      this.operationStatuses.set(id, abort.signal.aborted ? 'cancelled' : 'failed');
      this.snapshot = { ...this.snapshot, version: this.snapshot.version + 1, duration: 0, busy: false, status: '', error: abort.signal.aborted ? 'Video inspection was cancelled.' : this.message(error, 'The selected file is not a supported MP4 video.') };
      this.publish();
    }
  }

  private async renderCut(id: string, generation: number, source: File, clips: VideoClip[], before: StableView, abort: AbortController, presetId: CoverPresetId | null): Promise<void> {
    try {
      const output = await this.renderer.render(source, clips, abort.signal, (progress) => {
        if (!this.isActive(id, generation) || !Number.isFinite(progress)) return;
        this.snapshot = { ...this.snapshot, progress: Math.max(0, Math.min(99, Math.round(progress))) };
        this.publish();
      }, presetId ? { presetId, metadata: this.metadata! } : undefined);
      if (!this.isActive(id, generation) || abort.signal.aborted) {
        if (this.operationStatuses.get(id) === 'running') this.operationStatuses.set(id, 'stale');
        return;
      }
      if (!output.size) throw new Error('The video processor returned an empty output.');
      const url = this.makeUrl(output);
      if (this.snapshot.previewUrl && this.snapshot.previewUrl !== before.previewUrl) this.revokeUrl(this.snapshot.previewUrl);
      // Replace the single Undo snapshot on every completion, releasing older media.
      if (this.completed?.previewUrl && this.completed.previewUrl !== before.previewUrl) this.revokeUrl(this.completed.previewUrl);
      this.completed = before;
      this.outputBlob = output;
      this.latestCompletedPlan = clips.map((clip) => ({ ...clip }));
      this.active = null;
      this.operationStatuses.set(id, 'completed');
      this.snapshot = { ...this.snapshot, version: this.snapshot.version + 1, segments: clips, coverPresetId: presetId, previewUrl: url, hasOutput: true, busy: false, progress: 100, status: presetId ? 'Title card complete. Download your MP4 below.' : 'Cut complete. Your original video is unchanged.', error: null, canUndo: true };
      this.publish();
    } catch (error) {
      if (!this.isActive(id, generation)) {
        if (this.operationStatuses.get(id) === 'running') this.operationStatuses.set(id, 'stale');
        return;
      }
      this.active = null;
      const cancelled = abort.signal.aborted;
      this.operationStatuses.set(id, cancelled ? 'cancelled' : 'failed');
      this.snapshot = { ...this.snapshot, version: this.snapshot.version + 1, busy: false, progress: 0, status: cancelled ? 'Processing cancelled. Your previous preview and clip plan were kept.' : '', error: cancelled ? null : 'Video processing failed. Your previous preview and clip plan were kept.' };
      this.publish();
    }
  }

  private isCurrent(command: VideoScissorsCommand): boolean {
    return !this.disposed && command.sourceGeneration === this.snapshot.sourceGeneration && command.version === this.snapshot.version;
  }

  private isActive(id: string, generation: number): boolean {
    return !this.disposed && this.active?.id === id && this.active.sourceGeneration === generation && this.snapshot.sourceGeneration === generation;
  }

  private invalidateActive(): void {
    if (!this.active) return;
    this.active.abort.abort();
    this.operationStatuses.set(this.active.id, 'stale');
    this.active = null;
  }

  private clearOutputHistory(): void {
    const urls = new Set<string>();
    if (this.snapshot.previewUrl) urls.add(this.snapshot.previewUrl);
    if (this.completed?.previewUrl) urls.add(this.completed.previewUrl);
    for (const url of urls) this.revokeUrl(url);
    this.completed = null;
  }

  private setError(message: string): void {
    this.snapshot = { ...this.snapshot, version: this.snapshot.version + 1, status: '', error: message };
    this.publish();
  }

  private message(error: unknown, fallback: string): string {
    return error instanceof Error && error.message && !error.message.includes('source.mp4') ? error.message : fallback;
  }

  private newOperationId(prefix: string): string {
    return `${prefix}-${this.snapshot.sourceGeneration + 1}-${this.snapshot.version + 1}`;
  }

  private rememberCommand(id: string, result: Promise<unknown>): void {
    this.commandResults.set(id, result);
    while (this.commandResults.size > VIDEO_SCISSORS_LIMITS.rememberedOperations * 2) {
      const oldest = this.commandResults.keys().next().value;
      if (oldest === undefined) break;
      this.commandResults.delete(oldest);
      this.operationStatuses.delete(oldest);
    }
  }

  private publish(): void {
    for (const listener of this.listeners) listener();
  }
}

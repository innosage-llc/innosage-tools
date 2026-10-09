export type ProcessingStage = 'preparing' | 'processing' | 'finalizing' | 'ready' | 'error';

export interface RawProgressEvent {
  progress: number;
  /** ffmpeg.wasm forwards FFmpeg's timestamp in microseconds. */
  time: number;
}

export interface DisplayProgress {
  stage: ProcessingStage;
  percent: number | null;
}

const MICROSECONDS_PER_SECOND = 1_000_000;

export function finitePositive(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

export function isActiveRun(runId: number, currentRunId: number, processing: boolean): boolean {
  return processing && runId === currentRunId;
}

/**
 * Convert the FFmpeg event timestamp into progress for the combined output.
 * The library's `progress` ratio is intentionally not used here: its own API
 * documents that it is only accurate when input and output lengths match,
 * which is false for this two-input concat operation.
 */
export function combinedAudioProgress(event: RawProgressEvent, totalDurationSeconds: number | null | undefined): number | null {
  const total = finitePositive(totalDurationSeconds);
  const elapsedSeconds = finitePositive(event.time);
  if (!total || elapsedSeconds === null) return null;
  const normalized = elapsedSeconds / MICROSECONDS_PER_SECOND / total;
  return Number.isFinite(normalized) && normalized >= 0 && normalized <= 1
    ? normalized
    : normalized > 1 && normalized < 1.05 ? 1 : null;
}

export function displayProgress(stage: ProcessingStage, workProgress: number | null): DisplayProgress {
  if (stage === 'ready') return { stage, percent: 100 };
  if (stage === 'preparing') return { stage, percent: 0 };
  if (stage === 'finalizing') return { stage, percent: 99 };
  if (stage === 'error') return { stage, percent: null };
  if (workProgress === null) return { stage, percent: null };

  // Reserve room for finalization; success/100 is assigned only after output verification.
  const percent = 10 + workProgress * 80;
  return { stage, percent: Math.min(90, Math.max(10, Math.round(percent))) };
}

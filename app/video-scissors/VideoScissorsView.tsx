"use client";

import { ToolsLayout } from '@/components/ToolsLayout';
import {
  Scissors,
  Upload,
  FileVideo,
  Download,
  Undo2,
  XCircle,
  Plus,
  Trash2,
  AlertCircle,
  CheckCircle2,
  ShieldCheck,
  Film,
  Monitor,
  Info,
  Clock,
  Loader2,
} from 'lucide-react';

export interface VideoScissorsViewProps {
  fileName: string | null;
  duration: number;
  originalUrl: string | null;
  previewUrl: string | null;
  segments: Array<{ start: number; end: number }>;
  busy: boolean;
  progress: number;
  status: string;
  error: string | null;
  canUndo: boolean;
  hasOutput: boolean;
  onSelect: (file: File) => void;
  onSegmentsChange: (segments: Array<{ start: number; end: number }>) => void;
  onCut: () => void;
  onCancel: () => void;
  onUndo: () => void;
  onDownload: () => void;
}

function formatSeconds(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0.0s';
  const mins = Math.floor(sec / 60);
  const remainingSecs = sec % 60;
  if (mins > 0) {
    const paddedSecs = Math.floor(remainingSecs).toString().padStart(2, '0');
    const tenths = (remainingSecs % 1).toFixed(1).slice(1);
    return `${mins}:${paddedSecs}${tenths} (${sec.toFixed(1)}s)`;
  }
  return `${sec.toFixed(1)}s`;
}

export default function VideoScissorsView({
  fileName,
  duration,
  originalUrl,
  previewUrl,
  segments,
  busy,
  progress,
  status,
  error,
  canUndo,
  hasOutput,
  onSelect,
  onSegmentsChange,
  onCut,
  onCancel,
  onUndo,
  onDownload,
}: VideoScissorsViewProps) {
  const activePreviewSrc = previewUrl || originalUrl;
  const isEditedPreview = Boolean(previewUrl);

  const plannedOutputDuration = segments.reduce((sum, seg) => {
    const length = seg.end > seg.start ? seg.end - seg.start : 0;
    return sum + length;
  }, 0);

  const handleSegmentChange = (index: number, field: 'start' | 'end', valStr: string) => {
    if (busy) return;
    const parsed = parseFloat(valStr);
    const safeVal = Number.isFinite(parsed) ? parsed : 0;
    const updated = segments.map((seg, i) =>
      i === index ? { ...seg, [field]: safeVal } : seg
    );
    onSegmentsChange(updated);
  };

  const handleAddSegment = () => {
    if (busy) return;
    const lastEnd = segments.length > 0 ? segments[segments.length - 1].end : 0;
    const newStart = duration > 0 ? Math.min(lastEnd, duration) : lastEnd;
    const defaultStep = 5;
    const newEnd = duration > 0 ? Math.min(newStart + defaultStep, duration) : newStart + defaultStep;
    onSegmentsChange([
      ...segments,
      { start: Number(newStart.toFixed(1)), end: Number(newEnd.toFixed(1)) },
    ]);
  };

  const handleRemoveSegment = (index: number) => {
    if (busy) return;
    onSegmentsChange(segments.filter((_, i) => i !== index));
  };

  const normalizedProgress =
    progress <= 1 && progress > 0
      ? Math.round(progress * 100)
      : Math.round(Math.min(100, Math.max(0, progress)));

  return (
    <ToolsLayout>
      <div className="py-8 md:py-12 max-w-4xl mx-auto px-4 space-y-8">
        {/* Header */}
        <div className="text-center max-w-2xl mx-auto space-y-3">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-orange-100 text-orange-700 border border-orange-200">
            <Scissors size={14} className="text-orange-600" />
            <span>Desktop Chrome Local Video Tool</span>
          </div>
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-zinc-900">
            Video Scissors
          </h1>
          <p className="text-base text-zinc-600">
            Cut and splice MP4 video clips locally with sub-second precision. Source and output never leave your browser.
          </p>
        </div>

        {/* Main Card Container */}
        <div className="bg-white border border-zinc-200 rounded-3xl p-6 md:p-8 shadow-sm space-y-8">
          {/* Step 1: Select Video */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-zinc-900 flex items-center">
                <span className="bg-orange-100 text-orange-600 w-7 h-7 rounded-full flex items-center justify-center mr-2.5 text-xs font-bold">
                  1
                </span>
                Select Video File
              </h2>
              {fileName && (
                <span className="text-xs font-medium text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200">
                  Source loaded
                </span>
              )}
            </div>

            <input
              id="video-scissors-upload"
              type="file"
              accept=".mp4,video/mp4"
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  onSelect(file);
                }
                e.target.value = '';
              }}
              className="sr-only"
            />

            <label
              htmlFor="video-scissors-upload"
              className={`border-2 border-dashed rounded-2xl p-6 text-center transition-all flex flex-col items-center justify-center gap-2.5 ${
                busy
                  ? 'border-zinc-200 bg-zinc-50/70 cursor-not-allowed opacity-60'
                  : fileName
                  ? 'border-orange-300 bg-orange-50/30 hover:bg-orange-50/60 cursor-pointer'
                  : 'border-zinc-300 hover:border-orange-400 hover:bg-orange-50/20 bg-white cursor-pointer'
              }`}
            >
              {fileName ? (
                <>
                  <div className="w-12 h-12 rounded-xl bg-orange-100 text-orange-600 flex items-center justify-center">
                    <FileVideo size={24} />
                  </div>
                  <div className="space-y-1">
                    <p className="font-semibold text-zinc-900 break-all">{fileName}</p>
                    <p className="text-xs text-zinc-500">
                      {busy
                        ? 'Processing video in browser...'
                        : 'Click to select a different MP4 video'}
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <div className="w-12 h-12 rounded-xl bg-zinc-100 text-zinc-500 flex items-center justify-center">
                    <Upload size={24} />
                  </div>
                  <div className="space-y-1">
                    <p className="font-semibold text-zinc-900">Choose MP4 video</p>
                    <p className="text-xs text-zinc-500">
                      Click to select an MP4 file (.mp4, H.264 / AAC)
                    </p>
                  </div>
                </>
              )}
            </label>

            {/* Synthetic demo download link */}
            <div className="flex flex-wrap items-center justify-between gap-2 p-3.5 rounded-xl bg-zinc-50/80 border border-zinc-200 text-xs text-zinc-600">
              <div className="flex items-center gap-2">
                <Info size={15} className="text-zinc-400 shrink-0" />
                <span>Need a sample file to test with?</span>
              </div>
              <a
                href="/tools/video-scissors/demo.mp4"
                download="demo.mp4"
                className="inline-flex items-center gap-1.5 font-semibold text-orange-600 hover:text-orange-700 underline underline-offset-2 transition-colors"
              >
                <Download size={14} />
                Download synthetic 60-second sample MP4
              </a>
            </div>
          </div>

          {/* Step 2: Video Preview */}
          <div className="space-y-4 pt-4 border-t border-zinc-200">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-zinc-900 flex items-center">
                <span className="bg-orange-100 text-orange-600 w-7 h-7 rounded-full flex items-center justify-center mr-2.5 text-xs font-bold">
                  2
                </span>
                Video Preview
              </h2>
              {isEditedPreview ? (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                  <CheckCircle2 size={13} />
                  Edited Preview
                </span>
              ) : originalUrl ? (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-zinc-100 text-zinc-700 border border-zinc-200">
                  <Film size={13} />
                  Original Video Preview
                </span>
              ) : null}
            </div>

            <div className="rounded-2xl overflow-hidden bg-black border border-zinc-800">
              {activePreviewSrc ? (
                <video
                  key={activePreviewSrc}
                  src={activePreviewSrc}
                  controls
                  preload="metadata"
                  className="w-full max-h-[440px] object-contain shadow-inner"
                  aria-label={isEditedPreview ? 'Edited video preview' : 'Original video preview'}
                >
                  Your browser does not support the video tag.
                </video>
              ) : (
                <div className="flex flex-col items-center justify-center p-12 text-center text-zinc-400 aspect-video max-h-[380px] w-full">
                  <Film className="w-12 h-12 mb-3 text-zinc-600 stroke-[1.5]" />
                  <p className="text-sm font-medium text-zinc-200">No video loaded</p>
                  <p className="text-xs text-zinc-400 mt-1 max-w-sm">
                    Select an MP4 file above to preview source footage or inspect your cut result.
                  </p>
                  <video controls preload="metadata" className="hidden" aria-label="Empty video preview" />
                </div>
              )}
            </div>

            {/* Durations Overview */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="p-4 rounded-xl bg-zinc-50 border border-zinc-200/90">
                <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-zinc-500">
                  <span>Input Duration</span>
                  <Clock size={14} className="text-zinc-400" />
                </div>
                <div className="mt-1 text-2xl font-bold font-mono text-zinc-900">
                  {duration > 0 ? formatSeconds(duration) : '0.0s'}
                </div>
                <p className="mt-0.5 text-xs text-zinc-500">Original video source length</p>
              </div>

              <div className="p-4 rounded-xl bg-orange-50/50 border border-orange-200/90">
                <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-orange-700">
                  <span>Planned Output Duration</span>
                  <Scissors size={14} className="text-orange-500" />
                </div>
                <div className="mt-1 text-2xl font-bold font-mono text-orange-600">
                  {formatSeconds(plannedOutputDuration)}
                </div>
                <p className="mt-0.5 text-xs text-orange-700/80">
                  Sum of segment lengths ({segments.length} {segments.length === 1 ? 'clip' : 'clips'})
                </p>
              </div>
            </div>
          </div>

          {/* Step 3: Planned Clip Segments */}
          <div className="space-y-4 pt-4 border-t border-zinc-200">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-zinc-900 flex items-center">
                  <span className="bg-orange-100 text-orange-600 w-7 h-7 rounded-full flex items-center justify-center mr-2.5 text-xs font-bold">
                    3
                  </span>
                  Clip Segments
                </h2>
                <p className="text-xs text-zinc-500 mt-0.5">
                  Every clip references original video seconds. Clips are spliced in order; a new cut replaces the plan.
                </p>
              </div>

              <button
                type="button"
                onClick={handleAddSegment}
                disabled={busy}
                aria-label="Add clip segment"
                className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-zinc-900 hover:bg-zinc-800 text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
              >
                <Plus size={14} />
                <span>Add Clip</span>
              </button>
            </div>

            {segments.length === 0 ? (
              <div className="p-8 border border-dashed border-zinc-200 rounded-2xl text-center space-y-2 bg-zinc-50/50">
                <Scissors className="w-8 h-8 text-zinc-400 mx-auto" />
                <p className="text-sm font-medium text-zinc-700">No clips planned yet</p>
                <p className="text-xs text-zinc-500">
                  Click &ldquo;Add Clip&rdquo; above to specify a start and end time in seconds.
                </p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {segments.map((seg, index) => {
                  const segLength = seg.end > seg.start ? seg.end - seg.start : 0;
                  const isInvalid = seg.end <= seg.start;
                  return (
                    <div
                      key={index}
                      className={`p-3.5 rounded-xl border transition-all flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 ${
                        isInvalid
                          ? 'bg-amber-50/50 border-amber-200'
                          : 'bg-white border-zinc-200 hover:border-zinc-300'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="w-7 h-7 rounded-lg bg-orange-100 text-orange-700 font-mono text-xs font-bold flex items-center justify-center shrink-0">
                          #{index + 1}
                        </span>
                        <span className="text-xs font-semibold text-zinc-700 hidden sm:inline">
                          Clip {index + 1}
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-3 flex-1 sm:justify-center">
                        <div className="flex items-center gap-1.5">
                          <label
                            htmlFor={`clip-${index}-start`}
                            className="text-xs font-medium text-zinc-500"
                          >
                            Start:
                          </label>
                          <div className="relative">
                            <input
                              id={`clip-${index}-start`}
                              type="number"
                              step="0.1"
                              min="0"
                              max={duration > 0 ? duration : undefined}
                              value={seg.start}
                              disabled={busy}
                              onChange={(e) => handleSegmentChange(index, 'start', e.target.value)}
                              aria-label={`Clip ${index + 1} start time in seconds`}
                              className="w-24 px-2 py-1.5 text-sm font-mono rounded-lg border border-zinc-300 bg-white text-zinc-900 focus:outline-none focus:ring-2 focus:ring-orange-500 disabled:bg-zinc-100 disabled:text-zinc-400"
                            />
                            <span className="text-[10px] text-zinc-400 absolute right-2 top-2 pointer-events-none">
                              s
                            </span>
                          </div>
                        </div>

                        <span className="text-zinc-300 font-bold">→</span>

                        <div className="flex items-center gap-1.5">
                          <label
                            htmlFor={`clip-${index}-end`}
                            className="text-xs font-medium text-zinc-500"
                          >
                            End:
                          </label>
                          <div className="relative">
                            <input
                              id={`clip-${index}-end`}
                              type="number"
                              step="0.1"
                              min="0"
                              max={duration > 0 ? duration : undefined}
                              value={seg.end}
                              disabled={busy}
                              onChange={(e) => handleSegmentChange(index, 'end', e.target.value)}
                              aria-label={`Clip ${index + 1} end time in seconds`}
                              className="w-24 px-2 py-1.5 text-sm font-mono rounded-lg border border-zinc-300 bg-white text-zinc-900 focus:outline-none focus:ring-2 focus:ring-orange-500 disabled:bg-zinc-100 disabled:text-zinc-400"
                            />
                            <span className="text-[10px] text-zinc-400 absolute right-2 top-2 pointer-events-none">
                              s
                            </span>
                          </div>
                        </div>

                        <div className="text-xs font-mono text-zinc-600 bg-zinc-100 px-2.5 py-1 rounded-md">
                          Length: <strong className="text-zinc-900">{segLength.toFixed(1)}s</strong>
                        </div>
                      </div>

                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => handleRemoveSegment(index)}
                          disabled={busy}
                          aria-label={`Remove clip ${index + 1}`}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-red-600 hover:bg-red-50 hover:text-red-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          <Trash2 size={14} />
                          <span>Remove</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Step 4: Actions & Processing */}
          <div className="space-y-4 pt-4 border-t border-zinc-200">
            {/* Status & Progress */}
            {(busy || status) && (
              <div
                role="status"
                aria-live="polite"
                className="p-4 rounded-2xl bg-orange-50/70 border border-orange-200/90 space-y-2.5"
              >
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2 font-medium text-orange-950">
                    {busy && <Loader2 className="w-4 h-4 animate-spin text-orange-600" />}
                    <span>{status || (busy ? 'Cutting and re-encoding video...' : 'Status')}</span>
                  </div>
                  <span className="font-mono text-xs font-bold text-orange-800">
                    {normalizedProgress}%
                  </span>
                </div>
                <div
                  className="w-full bg-orange-200/70 rounded-full h-2 overflow-hidden"
                  role="progressbar"
                  aria-valuenow={normalizedProgress}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <div
                    className="bg-orange-600 h-2 rounded-full transition-all duration-300"
                    style={{ width: `${normalizedProgress}%` }}
                  />
                </div>
              </div>
            )}

            {/* Error Alert */}
            {error && (
              <div
                role="alert"
                className="p-4 bg-red-50 border border-red-200 text-red-800 rounded-2xl flex items-start gap-3 text-sm font-medium"
              >
                <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="font-semibold text-red-900">Processing Error</p>
                  <p className="mt-0.5">{error}</p>
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex flex-wrap items-center gap-3">
              {/* Primary Action: Cut Video */}
              <button
                type="button"
                onClick={onCut}
                disabled={busy || !fileName || segments.length === 0}
                aria-label="Cut video segments"
                className="flex-1 min-w-[200px] py-3.5 px-6 rounded-xl font-bold text-base flex items-center justify-center gap-2 transition-all bg-orange-600 hover:bg-orange-700 text-white shadow-sm hover:shadow disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {busy ? (
                  <>
                    <Loader2 className="animate-spin" size={20} />
                    <span>Processing Cut...</span>
                  </>
                ) : (
                  <>
                    <Scissors size={20} />
                    <span>Cut Video</span>
                  </>
                )}
              </button>

              {/* Cancel: Enabled only while busy */}
              <button
                type="button"
                onClick={onCancel}
                disabled={!busy}
                aria-label="Cancel processing"
                className="py-3.5 px-5 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-colors border border-zinc-300 text-zinc-700 bg-white hover:bg-zinc-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <XCircle size={18} />
                <span>Cancel</span>
              </button>

              {/* Undo: Enabled with canUndo and !busy */}
              <button
                type="button"
                onClick={onUndo}
                disabled={!canUndo || busy}
                aria-label="Undo cut and restore previous plan"
                className="py-3.5 px-5 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-colors border border-zinc-300 text-zinc-700 bg-white hover:bg-zinc-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Undo2 size={18} />
                <span>Undo</span>
              </button>

              {/* Download: Enabled only with hasOutput and !busy */}
              <button
                type="button"
                onClick={onDownload}
                disabled={!hasOutput || busy}
                aria-label="Download cut MP4 video"
                className="py-3.5 px-6 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Download size={18} />
                <span>Download MP4</span>
              </button>
            </div>
          </div>
        </div>

        {/* Technical Specifications and Privacy Notes Card */}
        <div className="rounded-3xl bg-zinc-50/80 border border-zinc-200/90 p-6 space-y-5 text-xs text-zinc-600">
          <div className="flex items-center gap-2 text-zinc-900 font-bold text-sm">
            <ShieldCheck className="w-5 h-5 text-emerald-600" />
            <span>Technical Specifications &amp; Privacy</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-3">
              <div className="flex items-start gap-2.5">
                <Monitor className="w-4 h-4 text-zinc-500 shrink-0 mt-0.5" />
                <div>
                  <strong className="text-zinc-900">Desktop Chrome Required:</strong>{' '}
                  This tool runs local video decoding and encoding in Desktop Google Chrome.
                </div>
              </div>

              <div className="flex items-start gap-2.5">
                <Film className="w-4 h-4 text-zinc-500 shrink-0 mt-0.5" />
                <div>
                  <strong className="text-zinc-900">Supported Input:</strong>{' '}
                  MP4 format (H.264 video codec, AAC audio codec).
                </div>
              </div>

              <div className="flex items-start gap-2.5">
                <Info className="w-4 h-4 text-zinc-500 shrink-0 mt-0.5" />
                <div>
                  <strong className="text-zinc-900">Provisional Limits:</strong>{' '}
                  Up to 100 MB, 5 minutes, 1080p, 30 fps. Desktop Chrome.
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-start gap-2.5">
                <Scissors className="w-4 h-4 text-zinc-500 shrink-0 mt-0.5" />
                <div>
                  <strong className="text-zinc-900">Re-encoded Output:</strong>{' '}
                  Output is re-encoded, not lossless compression.
                </div>
              </div>

              <div className="flex items-start gap-2.5">
                <Clock className="w-4 h-4 text-zinc-500 shrink-0 mt-0.5" />
                <div>
                  <strong className="text-zinc-900">Session &amp; File Safety:</strong>{' '}
                  Original source is always retained and never modified. Downloaded files are not deleted. Undo restores the previous completed plan/preview. Keep this browser tab open; reloading will require reselecting your video.
                </div>
              </div>

              <div className="flex items-start gap-2.5">
                <Download className="w-4 h-4 text-zinc-500 shrink-0 mt-0.5" />
                <div>
                  <strong className="text-zinc-900">Explicit Downloads:</strong>{' '}
                  No automatic downloads except upon your explicit &ldquo;Download MP4&rdquo; click.
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </ToolsLayout>
  );
}

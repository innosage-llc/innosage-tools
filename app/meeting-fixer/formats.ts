export type MeetingOutputFormat = 'mp3' | 'm4a' | 'wav';

export interface MeetingOutputDefinition {
  id: MeetingOutputFormat;
  label: string;
  description: string;
  extension: `.${MeetingOutputFormat}`;
  mimeType: string;
  codec: string;
  bitrate?: string;
  sampleRate: number;
  channels: number;
  ffmpegArgs: string[];
}

const COMMON_AUDIO_FILTER = '[0:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[a0];[1:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[a1];[a0][a1]concat=n=2:v=0:a=1[out]';

export const MEETING_OUTPUT_FORMATS: Record<MeetingOutputFormat, MeetingOutputDefinition> = {
  mp3: { id: 'mp3', label: 'MP3', description: 'MPEG Layer III audio', extension: '.mp3', mimeType: 'audio/mpeg', codec: 'libmp3lame', bitrate: '128k', sampleRate: 44100, channels: 2, ffmpegArgs: ['-c:a', 'libmp3lame', '-b:a', '128k', '-ar', '44100', '-ac', '2'] },
  m4a: { id: 'm4a', label: 'M4A (AAC)', description: 'AAC audio in an MP4 container', extension: '.m4a', mimeType: 'audio/mp4', codec: 'aac', bitrate: '128k', sampleRate: 44100, channels: 2, ffmpegArgs: ['-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2', '-movflags', '+faststart'] },
  wav: { id: 'wav', label: 'WAV (PCM)', description: 'Uncompressed 16-bit PCM audio', extension: '.wav', mimeType: 'audio/wav', codec: 'pcm_s16le', sampleRate: 48000, channels: 2, ffmpegArgs: ['-c:a', 'pcm_s16le', '-ar', '48000', '-ac', '2'] },
};

export const DEFAULT_MEETING_OUTPUT_FORMAT: MeetingOutputFormat = 'mp3';

export function outputDefinition(format: MeetingOutputFormat): MeetingOutputDefinition {
  return MEETING_OUTPUT_FORMATS[format];
}

export function outputFilename(format: MeetingOutputFormat): string {
  return `fixed_meeting${outputDefinition(format).extension}`;
}

export function outputCommand(format: MeetingOutputFormat, outputName: string): string[] {
  return ['-filter_complex', COMMON_AUDIO_FILTER, '-map', '[out]', ...outputDefinition(format).ffmpegArgs, outputName];
}

export function estimateWavBytes(durationSeconds: number | null): number | null {
  if (!durationSeconds || !Number.isFinite(durationSeconds) || durationSeconds <= 0) return null;
  return Math.ceil(durationSeconds * 48000 * 2 * 2) + 44;
}

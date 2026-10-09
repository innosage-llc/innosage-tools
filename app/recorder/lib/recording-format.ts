export type RecordingFormat = {
  mimeType: string;
  extension: '.m4a' | '.webm';
  description: string;
  container: 'mp4' | 'webm';
};

export function selectRecordingFormat(
  mode: 'audio' | 'video',
  supported: (mime: string) => boolean = mime => MediaRecorder.isTypeSupported(mime),
): RecordingFormat {
  const candidates: RecordingFormat[] = mode === 'audio' ? [
    { mimeType: 'audio/mp4;codecs=mp4a.40.2', extension: '.m4a', description: 'M4A Audio (AAC)', container: 'mp4' },
    { mimeType: 'audio/webm;codecs=opus', extension: '.webm', description: 'WebM Audio (Opus)', container: 'webm' },
  ] : [
    { mimeType: 'video/webm;codecs=vp8,opus', extension: '.webm', description: 'WebM Video', container: 'webm' },
    { mimeType: 'video/webm', extension: '.webm', description: 'WebM Video', container: 'webm' },
  ];
  const format = candidates.find(candidate => supported(candidate.mimeType));
  if (!format) throw new Error('This browser cannot encode the supported recording formats. Try a current Chrome, Edge or Safari browser.');
  return format;
}

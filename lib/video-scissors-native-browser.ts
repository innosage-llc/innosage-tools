import { validateBrowserMetadata, validateSourceSize, type BrowserVideoMetadata } from './video-scissors';

const DECODE_ERROR = 'This browser could not decode the MP4 video. Try a current desktop Chrome with HEVC support, or choose a browser-playable MP4. The file may also be damaged.';

// Every operation owns its video and URL. Nothing is uploaded or retained after
// completion, timeout, cancellation or source replacement.
async function withNativeVideo<T>(file: File, signal: AbortSignal, run: (video: HTMLVideoElement, signal: AbortSignal) => Promise<T>): Promise<T> {
  signal.throwIfAborted();
  validateSourceSize(file.size);
  const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  signal.throwIfAborted();
  if (String.fromCharCode(...header.slice(4, 8)) !== 'ftyp') throw new Error('Choose a valid MP4 video. This file has no MP4 container header.');
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(20_000)]);
  const video = document.createElement('video');
  video.preload = 'auto'; video.muted = true; video.playsInline = true;
  const url = URL.createObjectURL(file);
  try {
    await videoReady(video, bounded, () => { video.src = url; video.load(); });
    validateBrowserMetadata({ duration: video.duration, width: video.videoWidth, height: video.videoHeight });
    return await run(video, bounded);
  } catch (error) {
    signal.throwIfAborted();
    if (bounded.aborted) throw new Error('Local video decoding timed out. Try again or choose another browser-playable MP4.');
    throw error;
  } finally {
    video.pause(); video.removeAttribute('src'); video.load();
    URL.revokeObjectURL(url);
  }
}

function videoReady(video: HTMLVideoElement, signal: AbortSignal, start: () => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const events = ['loadeddata', 'canplay', 'seeked'];
    const cleanup = () => {
      events.forEach(event => video.removeEventListener(event, check));
      video.removeEventListener('error', fail); signal.removeEventListener('abort', abort);
    };
    const check = () => {
      // HAVE_CURRENT_DATA after seeked means the frame at the new position is
      // decoded. No playback/audio or guessed frame rate is needed, even at 0.
      if (!video.seeking && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) { cleanup(); resolve(); }
    };
    const fail = () => { cleanup(); reject(new Error(DECODE_ERROR)); };
    const abort = () => { cleanup(); reject(signal.reason); };
    events.forEach(event => video.addEventListener(event, check));
    video.addEventListener('error', fail); signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) return abort();
    try { start(); check(); } catch (error) { cleanup(); reject(error); }
  });
}

export function inspectBrowserVideo(file: File, signal: AbortSignal): Promise<BrowserVideoMetadata> {
  return withNativeVideo(file, signal, async video => ({ duration: video.duration, width: video.videoWidth, height: video.videoHeight }));
}

export function extractBrowserFrame(file: File, timeSeconds: number, signal: AbortSignal): Promise<Blob> {
  return withNativeVideo(file, signal, async (video, bounded) => {
    if (!Number.isFinite(timeSeconds) || timeSeconds < 0 || timeSeconds >= video.duration) throw new Error('Frame time must be before the end of the original video.');
    if (video.currentTime !== timeSeconds) await videoReady(video, bounded, () => { video.currentTime = timeSeconds; });
    bounded.throwIfAborted();
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    try {
      const context = canvas.getContext('2d');
      if (!context) throw new Error('This browser could not create a PNG canvas.');
      context.drawImage(video, 0, 0);
      let onAbort: (() => void) | undefined;
      try {
        return await new Promise<Blob>((resolve, reject) => {
          onAbort = () => reject(bounded.reason);
          bounded.addEventListener('abort', onAbort, { once: true });
          canvas.toBlob(blob => {
            if (bounded.aborted) reject(bounded.reason);
            else if (!blob?.size) reject(new Error('This browser could not encode the PNG.'));
            else resolve(blob);
          }, 'image/png');
        });
      } finally {
        if (onAbort) bounded.removeEventListener('abort', onAbort);
      }
    } finally {
      canvas.width = 0; canvas.height = 0;
    }
  });
}

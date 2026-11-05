import type { FFmpeg } from '@ffmpeg/ffmpeg';
import { parseFfmpegMetadata, videoScissorsFilter, videoScissorsCoverFilter, type VideoScissorsRenderer } from './video-scissors';
import { createTitleCard } from './video-scissors-cover-canvas';
import { TITLE_CARD_SECONDS } from './video-scissors-covers';

import { withFfmpeg } from './local-ffmpeg-browser';

const PROBE_INPUT = 'source.mp4';
const OUTPUT = 'cut.mp4';

async function writeSource(ffmpeg: FFmpeg, file: File, signal: AbortSignal): Promise<void> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
  await ffmpeg.writeFile(PROBE_INPUT, bytes, { signal });
}

export const videoScissorsRenderer: VideoScissorsRenderer = {
  extractFrame(file, timeSeconds, metadata, signal) {
    return withFfmpeg(signal, async (ffmpeg) => {
      await writeSource(ffmpeg, file, signal);
      // Decode from the source origin (not a keyframe seek or edited output).
      // Extend the last decoded frame through EOF, including variable-rate tails
      // or audio longer than video. Only one output frame is encoded.
      const time = Math.min(timeSeconds, metadata.duration);
      const code = await ffmpeg.exec(['-hide_banner', '-i', PROBE_INPUT,
        '-ss', time.toFixed(6), '-map', '0:V:0', '-vf', 'tpad=stop_mode=clone:stop_duration=300', '-frames:v', '1',
        '-fps_mode', 'passthrough', '-c:v', 'png', 'frame.png'], -1, { signal });
      signal.throwIfAborted();
      if (code !== 0) throw new Error('Frame extraction failed.');
      const data = await ffmpeg.readFile('frame.png', undefined, { signal });
      if (typeof data === 'string' || !data.byteLength) throw new Error('Empty PNG');
      return new Blob([data.slice()], { type: 'image/png' });
    });
  },
  inspect(file, signal) {
    return withFfmpeg(signal, async (ffmpeg, logs) => {
      await writeSource(ffmpeg, file, signal);
      const code = await ffmpeg.exec(['-hide_banner', '-i', PROBE_INPUT, '-map', '0:V:0', '-map', '0:a:0', '-t', '0', '-f', 'null', '-'], -1, { signal });
      const parsed = parseFfmpegMetadata(logs.join('\n'));
      // ffmpeg may return a non-zero status for a zero-frame null output; input metadata is still parsed and validated.
      if (code !== 0 && parsed.duration <= 0) throw new Error('The selected file is not a supported MP4 video or is corrupt.');
      return parsed;
    });
  },
  render(file, clips, signal, onProgress, cover) {
    return withFfmpeg(signal, async (ffmpeg) => {
      await writeSource(ffmpeg, file, signal);
      const width = cover ? Math.floor(cover.metadata.width / 2) * 2 : 0;
      const height = cover ? Math.floor(cover.metadata.height / 2) * 2 : 0;
      if (cover) {
        const png = await createTitleCard(file.name, cover.presetId, width, height);
        if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
        await ffmpeg.writeFile('title.png', png, { signal });
      }
      const onProgressEvent = ({ progress }: { progress: number }) => onProgress(progress * 100);
      ffmpeg.on('progress', onProgressEvent);
      try {
        const code = await ffmpeg.exec([
          '-hide_banner', '-i', PROBE_INPUT,
          ...(cover ? ['-loop', '1', '-framerate', '30', '-i', 'title.png'] : []),
          '-filter_complex', cover ? videoScissorsCoverFilter(clips, width, height) : videoScissorsFilter(clips),
          '-map', '[outv]', '-map', '[outa]',
          '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-pix_fmt', 'yuv420p',
          '-c:a', 'aac', '-movflags', '+faststart',
          ...(cover ? ['-t', (clips.reduce((sum, clip) => sum + clip.end - clip.start, TITLE_CARD_SECONDS)).toFixed(6)] : []), OUTPUT,
        ], -1, { signal });
        if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
        if (code !== 0) throw new Error('Video processing failed. Your previous preview and clip plan were kept.');
        const data = await ffmpeg.readFile(OUTPUT, undefined, { signal });
        if (typeof data === 'string' || data.byteLength === 0) throw new Error('Video processing returned an empty output.');
        return new Blob([data.slice()], { type: 'video/mp4' });
      } finally {
        ffmpeg.off('progress', onProgressEvent);
      }
    });
  },
};

import { withFfmpeg } from "./local-ffmpeg-browser";
import { motionBackground, type MotionRenderer } from "./visual-remix-motion";

async function verifyVideo(blob: Blob, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  const url = URL.createObjectURL(blob),
    video = document.createElement("video");
  try {
    await new Promise<void>((resolve, reject) => {
      const finish = (error?: Error) => {
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        video.onloadedmetadata = null;
        video.onerror = null;
        if (error) reject(error);
        else resolve();
      };
      const abort = () => finish(new DOMException("Cancelled", "AbortError"));
      const timer = setTimeout(
        () =>
          finish(
            new Error(
              "Video verification timed out. Try current desktop Chrome.",
            ),
          ),
        15000,
      );
      signal.addEventListener("abort", abort, { once: true });
      video.onloadedmetadata = () => {
        if (
          video.videoWidth !== 1080 ||
          video.videoHeight !== 1440 ||
          Math.abs(video.duration - 5) > 0.15
        )
          finish(
            new Error("Video dimensions or duration could not be verified."),
          );
        else finish();
      };
      video.onerror = () =>
        finish(
          new Error(
            "This browser cannot play the exported H.264 MP4. Try current desktop Chrome.",
          ),
        );
      video.preload = "metadata";
      video.src = url;
    });
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}
export const renderRemixMotion: MotionRenderer = async (
  png,
  background,
  signal,
  progress,
) => {
  const opaqueBackground = motionBackground(background);
  if (png.type !== "image/png" || !png.size || png.size > 10 * 1024 * 1024)
    throw new Error("Use a valid applied PNG under 10 MB.");
  progress(0);
  return withFfmpeg(signal, async (ffmpeg) => {
    signal.throwIfAborted();
    await ffmpeg.writeFile(
      "scene.png",
      new Uint8Array(await png.arrayBuffer()),
      { signal },
    );
    const onProgress = ({ progress: value }: { progress: number }) =>
      progress(Math.min(99, Math.max(0, value * 100)));
    ffmpeg.on("progress", onProgress);
    try {
      const code = await ffmpeg.exec(
        [
          "-hide_banner",
          "-loop",
          "1",
          "-framerate",
          "24",
          "-i",
          "scene.png",
          "-vf",
          `fade=t=in:st=0:d=0.5:color=${opaqueBackground},format=yuv420p`,
          "-t",
          "5",
          "-an",
          "-c:v",
          "libx264",
          "-preset",
          "ultrafast",
          "-crf",
          "18",
          "-threads",
          "1",
          "-pix_fmt",
          "yuv420p",
          "-movflags",
          "+faststart",
          "scene.mp4",
        ],
        120000,
        { signal },
      );
      signal.throwIfAborted();
      if (code !== 0)
        throw new Error(
          "MP4 export failed or exceeded two minutes. Your PNG is preserved; try desktop Chrome or a simpler image.",
        );
      const data = await ffmpeg.readFile("scene.mp4", undefined, { signal });
      if (
        typeof data === "string" ||
        !data.byteLength ||
        data.byteLength > 32 * 1024 * 1024
      )
        throw new Error("Video output was empty or exceeded 32 MB.");
      const result = new Blob([data.slice()], { type: "video/mp4" });
      await verifyVideo(result, signal);
      signal.throwIfAborted();
      progress(100);
      return result;
    } finally {
      ffmpeg.off("progress", onProgress);
    }
  });
};

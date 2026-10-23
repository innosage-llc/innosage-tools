import type { FFmpeg } from "@ffmpeg/ffmpeg";

const RUNTIME = "/tools/video-scissors/ffmpeg";

async function loadFfmpeg(
  ffmpeg: FFmpeg,
  signal: AbortSignal,
): Promise<string> {
  if (typeof DecompressionStream === "undefined")
    throw new Error(
      "This browser cannot load the local video processor. Use a current desktop Chrome.",
    );
  const response = await fetch(`${RUNTIME}/core.wasm.gz`, {
    signal,
    credentials: "same-origin",
    cache: "force-cache",
  });
  if (!response.ok || !response.body)
    throw new Error("The local video processor could not be loaded.");
  const decompressed = response.body.pipeThrough(
    new DecompressionStream("gzip"),
  );
  const wasmBlob = await new Response(decompressed).blob();
  signal.throwIfAborted();
  const wasmBlobUrl = URL.createObjectURL(wasmBlob);
  try {
    // Turbopack can give bundled import.meta.url a file: base. Absolute HTTP
    // asset URLs keep the browser worker on this application's actual origin.
    const runtimeUrl = new URL(`${RUNTIME}/`, window.location.href);
    await ffmpeg.load(
      {
        classWorkerURL: new URL("worker.js", runtimeUrl).href,
        coreURL: new URL("ffmpeg-core.js", runtimeUrl).href,
        wasmURL: wasmBlobUrl,
      },
      { signal },
    );
    return wasmBlobUrl;
  } catch {
    URL.revokeObjectURL(wasmBlobUrl);
    throw new Error("The local video processor could not be started.");
  }
}

export async function withFfmpeg<T>(
  signal: AbortSignal,
  run: (ffmpeg: FFmpeg, logs: string[]) => Promise<T>,
): Promise<T> {
  if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
  const { FFmpeg: BrowserFFmpeg } = await import("@ffmpeg/ffmpeg");
  signal.throwIfAborted();
  const ffmpeg = new BrowserFFmpeg();
  const logs: string[] = [];
  const onLog = ({ message }: { message: string }) => {
    logs.push(message);
  };
  const onAbort = () => ffmpeg.terminate();
  ffmpeg.on("log", onLog);
  signal.addEventListener("abort", onAbort, { once: true });
  let wasmUrl: string | null = null;
  try {
    wasmUrl = await loadFfmpeg(ffmpeg, signal);
    if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
    return await run(ffmpeg, logs);
  } finally {
    ffmpeg.off("log", onLog);
    signal.removeEventListener("abort", onAbort);
    ffmpeg.terminate();
    if (wasmUrl) URL.revokeObjectURL(wasmUrl);
  }
}

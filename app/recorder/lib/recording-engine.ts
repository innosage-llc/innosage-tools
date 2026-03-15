import fixWebmDuration from "fix-webm-duration";

export type RecordingConfig = {
  mode: "audio" | "video";
  micDeviceId?: string;
  audioBitrate?: number; // default 128000
  videoBitrate?: number; // default 2500000
  timeslice?: number; // default 1000 (ms)
};

export class AudioMixer {
  private context: AudioContext;
  private destination: MediaStreamAudioDestinationNode;
  private sources: Map<string, { source: MediaStreamAudioSourceNode; gain: GainNode }> = new Map();

  constructor() {
    this.context = new window.AudioContext();
    this.destination = this.context.createMediaStreamDestination();
  }

  addStream(stream: MediaStream, label: string) {
    if (stream.getAudioTracks().length === 0) return;

    const source = this.context.createMediaStreamSource(stream);
    const gain = this.context.createGain();

    source.connect(gain);
    gain.connect(this.destination);

    this.sources.set(label, { source, gain });
  }

  getGainNode(label: string): GainNode | undefined {
    return this.sources.get(label)?.gain;
  }

  getMixedStream(): MediaStream {
    return this.destination.stream;
  }

  dispose() {
    this.sources.forEach(({ source, gain }) => {
      source.disconnect();
      gain.disconnect();
    });
    this.sources.clear();
    this.destination.disconnect();
    if (this.context.state !== "closed") {
      this.context.close();
    }
  }
}

export class DiskWriter {
  private writer: FileSystemWritableFileStream | null = null;
  private fileHandle: FileSystemFileHandle | null = null;
  private fallbackChunks: Blob[] = [];
  public isFallback = false;

  static async create(suggestedName: string): Promise<DiskWriter> {
    const diskWriter = new DiskWriter();

    if (DiskWriter.isSupported()) {
      try {
        const handle = await (window as Window & { showSaveFilePicker?: (options: unknown) => Promise<FileSystemFileHandle> }).showSaveFilePicker!({
          suggestedName,
          types: [
            {
              description: "WebM Media",
              accept: { "video/webm": [".webm"] },
            },
          ],
        });
        diskWriter.fileHandle = handle;
        diskWriter.writer = await handle.createWritable();
        return diskWriter;
      } catch (e: unknown) {
        // In Playwright headless testing or if user cancels the prompt,
        // we'll catch AbortError and gracefully fall back to Blob buffer
        // rather than breaking the application flow.
        console.warn("showSaveFilePicker failed or was aborted, falling back to Blob buffer", e);
        diskWriter.isFallback = true;
      }
    } else {
      diskWriter.isFallback = true;
    }

    return diskWriter;
  }

  static isSupported(): boolean {
    return "showSaveFilePicker" in window;
  }

  async write(chunk: Blob) {
    if (this.isFallback) {
      this.fallbackChunks.push(chunk);
    } else if (this.writer) {
      await this.writer.write(chunk);
    }
  }

  async close(): Promise<Blob | null> {
    if (this.isFallback) {
      const finalBlob = new Blob(this.fallbackChunks, { type: "video/webm" });
      this.fallbackChunks = [];
      return finalBlob;
    } else if (this.writer) {
      await this.writer.close();
      this.writer = null;
    }
    return null;
  }
}

export class RecordingEngine extends EventTarget {
  private config: RecordingConfig;
  private recorder: MediaRecorder | null = null;
  private mixer: AudioMixer | null = null;
  private writer: DiskWriter | null = null;
  private streamsToStop: MediaStream[] = [];

  private startTime: number = 0;
  private pauseTime: number = 0;
  private totalPausedDuration: number = 0;
  private tickInterval: number | null = null;

  public state: "inactive" | "recording" | "paused" | "setup" = "setup";
  public writtenBytes: number = 0;

  constructor(config: RecordingConfig) {
    super();
    this.config = {
      audioBitrate: 128000,
      videoBitrate: 2500000,
      timeslice: 1000,
      ...config,
    };
  }

  async start() {
    try {
      // 1. Ask for File Handle FIRST to preserve user gesture
      const dateStr = new Date().toISOString().replace(/[:.]/g, "-");
      const ext = this.config.mode === "audio" ? "webm" : "webm"; // both use webm container for now
      const suggestedName = `recording-${dateStr}.${ext}`;
      this.writer = await DiskWriter.create(suggestedName);

      // 2. Get Mic Stream
      const micConstraints: MediaStreamConstraints = {
        audio: this.config.micDeviceId ? { deviceId: { exact: this.config.micDeviceId } } : true,
      };
      const micStream = await navigator.mediaDevices.getUserMedia(micConstraints);
      this.streamsToStop.push(micStream);

      // 2. Get Display Stream (System Audio + Video)
      const displayConstraints: MediaStreamConstraints = {
        video: this.config.mode === "video" ? { frameRate: { ideal: 30 } } : true, // need video to capture system audio in Chrome, will stop track if audio-only
        audio: { suppressLocalAudioPlayback: true } as unknown as boolean, // using boolean type assertion to bypass strict TS checking for experimental property
      };

      let displayStream: MediaStream | null = null;
      try {
        displayStream = await navigator.mediaDevices.getDisplayMedia(displayConstraints);
        this.streamsToStop.push(displayStream);
      } catch (e) {
        console.warn("Failed to get display media (system audio/video)", e);
        // Fallback to mic only if display media fails or user denies
      }

      // 3. Audio-only logic
      if (this.config.mode === "audio" && displayStream) {
        displayStream.getVideoTracks().forEach(track => track.stop());
      }

      // 4. Mix Audio
      this.mixer = new AudioMixer();
      this.mixer.addStream(micStream, "mic");
      if (displayStream && displayStream.getAudioTracks().length > 0) {
        this.mixer.addStream(displayStream, "system");
      }

      // 5. Final Stream
      let finalStream: MediaStream;
      if (this.config.mode === "audio") {
        finalStream = this.mixer.getMixedStream();
      } else {
        const videoTracks = displayStream ? displayStream.getVideoTracks() : [];
        finalStream = new MediaStream([...videoTracks, ...this.mixer.getMixedStream().getAudioTracks()]);
      }

      // 6. MediaRecorder
      const mimeType = this.config.mode === "audio"
          ? "audio/webm;codecs=opus"
          : "video/webm;codecs=vp8,opus";

      const fallbackMimeType = this.config.mode === "audio" ? "audio/webm" : "video/webm";

      const options: MediaRecorderOptions = {
        mimeType: MediaRecorder.isTypeSupported(mimeType) ? mimeType : fallbackMimeType,
        audioBitsPerSecond: this.config.audioBitrate,
      };
      if (this.config.mode === "video") {
         options.videoBitsPerSecond = this.config.videoBitrate;
      }

      this.recorder = new MediaRecorder(finalStream, options);

      this.recorder.ondataavailable = async (e) => {
        if (e.data.size > 0 && this.writer) {
          this.writtenBytes += e.data.size;
          await this.writer.write(e.data);
          this.dispatchEvent(new Event("chunk"));
        }
      };

      // 8. Start
      this.recorder.start(this.config.timeslice);
      this.state = "recording";
      this.startTime = Date.now();
      this.totalPausedDuration = 0;
      this.startTicker();
      this.dispatchEvent(new Event("statechange"));

      // Handle user stopping stream via browser UI
      if (displayStream) {
        const videoTrack = displayStream.getVideoTracks()[0];
        if (videoTrack) {
          videoTrack.onended = () => {
             if (this.state !== "inactive") this.stop();
          };
        }
      }

    } catch (error) {
      this.dispatchEvent(new CustomEvent("error", { detail: error }));
      throw error;
    }
  }

  async stop() {
    if (this.state === "inactive" || !this.recorder) return;

    return new Promise<void>((resolve, reject) => {
      this.recorder!.onstop = async () => {
        this.stopTicker();

        // Stop tracks
        this.streamsToStop.forEach(stream => {
          stream.getTracks().forEach(track => track.stop());
        });

        if (this.mixer) {
          this.mixer.dispose();
          this.mixer = null;
        }

        const duration = Date.now() - this.startTime - this.totalPausedDuration;

        try {
            const fallbackBlob = await this.writer!.close();

            if (fallbackBlob) {
                // Fix duration for fallback blob and trigger download
                 fixWebmDuration(fallbackBlob, duration, (fixedBlob: Blob) => {
                    const url = URL.createObjectURL(fixedBlob);
                    const a = document.createElement("a");
                    a.style.display = "none";
                    a.href = url;
                    a.download = `recording-fallback-${new Date().getTime()}.webm`;
                    document.body.appendChild(a);
                    a.click();
                    setTimeout(() => {
                        document.body.removeChild(a);
                        URL.revokeObjectURL(url);
                    }, 100);
                     resolve();
                 });
            } else {
                 resolve();
            }
        } catch(e) {
            reject(e);
        } finally {
            this.state = "inactive";
            this.dispatchEvent(new Event("statechange"));
        }
      };

      this.recorder!.stop();
    });
  }

  pause() {
    if (this.state === "recording" && this.recorder) {
      this.recorder.pause();
      this.state = "paused";
      this.pauseTime = Date.now();
      this.dispatchEvent(new Event("statechange"));
    }
  }

  resume() {
    if (this.state === "paused" && this.recorder) {
      this.recorder.resume();
      this.state = "recording";
      this.totalPausedDuration += Date.now() - this.pauseTime;
      this.dispatchEvent(new Event("statechange"));
    }
  }

  private startTicker() {
    this.tickInterval = window.setInterval(() => {
      if (this.state === "recording") {
        const elapsed = Date.now() - this.startTime - this.totalPausedDuration;
        this.dispatchEvent(new CustomEvent("tick", { detail: elapsed }));
      }
    }, 1000) as unknown as number;
  }

  private stopTicker() {
    if (this.tickInterval !== null) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
  }

  getMixer() {
      return this.mixer;
  }
}

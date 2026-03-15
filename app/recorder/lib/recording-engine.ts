export class DiskWriter {
  private writer: FileSystemWritableFileStream | null = null;
  private fileHandle: FileSystemFileHandle | null = null;
  private chunks: Blob[] = []; // Fallback buffer

  static isSupported(): boolean {
    return 'showSaveFilePicker' in window;
  }

  static async create(suggestedName: string, mode: 'audio' | 'video' = 'video', supportsMp4: boolean = false): Promise<DiskWriter> {
    const writer = new DiskWriter();

    if (this.isSupported()) {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName,
          types: mode === 'audio' && supportsMp4 ? [{
            description: 'M4A Audio',
            accept: { 'audio/mp4': ['.m4a'] },
          }] : (mode === 'audio' ? [{
            description: 'WebM Audio',
            accept: { 'audio/webm': ['.webm'] },
          }] : [{
            description: 'WebM Video',
            accept: { 'video/webm': ['.webm'] },
          }]),
        });
        writer.fileHandle = handle;
        writer.writer = await handle.createWritable();
      } catch (err) {
        // User might have cancelled the picker.
        console.warn("File picker cancelled or failed, falling back to Blob buffer.", err);
      }
    }

    return writer;
  }

  async write(chunk: Blob) {
    if (this.writer) {
      await this.writer.write(chunk);
    } else {
      this.chunks.push(chunk);
    }
  }

  async close(finalBlob?: Blob, fallbackMimeType?: string) {
    if (this.writer) {
      // We do not overwrite if streaming continuously.
      if (finalBlob) {
          // In fallback or forced mode, write it
          await this.writer.truncate(0);
          await this.writer.write(finalBlob);
      }
      await this.writer.close();
    } else {
      // Fallback: trigger download
      const mimeType = fallbackMimeType || 'video/webm';
      const defaultExt = mimeType.includes('mp4') ? 'm4a' : 'webm';
      const blob = finalBlob || new Blob(this.chunks, { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = this.fileHandle?.name || `recording.${defaultExt}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  }

  isDiskWriter(): boolean {
    return this.writer !== null;
  }
}

import ysFixWebmDuration from 'fix-webm-duration';

export type RecordingConfig = {
  mode: 'audio' | 'video';
  micDeviceId?: string;
  camDeviceId?: string;
  audioBitrate: number; // default 256000
  videoBitrate: number; // default 2500000
  timeslice: number;    // default 1000 (ms)
};

export class RecordingEngine extends EventTarget {
  private config: RecordingConfig;
  private mixer: AudioMixer | null = null;
  private diskWriter: DiskWriter | null = null;
  private mediaRecorder: MediaRecorder | null = null;

  private micStream: MediaStream | null = null;
  private systemStream: MediaStream | null = null;

  private startTime: number = 0;
  private duration: number = 0;
  private chunks: Blob[] = []; // Only used for fallback
  private tickIntervalId: ReturnType<typeof setInterval> | null = null;

  constructor(config: RecordingConfig) {
    super();
    this.config = config;
  }

  private cleanupStreams() {
    this.micStream?.getTracks().forEach(t => t.stop());
    this.systemStream?.getTracks().forEach(t => t.stop());
  }

  async start(writer: DiskWriter) {
    this.diskWriter = writer;

    // 1. Get streams
    if (this.config.mode === 'video') {
      try {
        this.systemStream = await navigator.mediaDevices.getUserMedia({
          video: this.config.camDeviceId ? { deviceId: this.config.camDeviceId } : true,
        });
      } catch (e) {
        console.warn("Could not get camera stream", e);
      }
    } else {
      // For audio mode, we might still want system audio. The UX for this is tricky.
      // For now, let's stick to mic audio only in audio mode.
    }

    try {
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          ...(this.config.micDeviceId ? { deviceId: this.config.micDeviceId } : {}),
          echoCancellation: false,
          autoGainControl: false,
          noiseSuppression: false,
        },
      });
    } catch (e) {
      console.warn("Could not get mic stream", e);
    }

    const hasMicAudio = this.micStream ? this.micStream.getAudioTracks().length > 0 : false;

    if (!hasMicAudio) {
      this.cleanupStreams();
      throw new Error("No audio source available. Please grant microphone permissions.");
    }

    if (this.config.mode === 'video' && (!this.systemStream || this.systemStream.getVideoTracks().length === 0)) {
      this.cleanupStreams();
      throw new Error("No video source available. Please grant camera permissions for video recording.");
    }

    // 2. Prepare audio
    this.mixer = new AudioMixer();
    if (this.micStream) {
      this.mixer.addStream(this.micStream, 'mic');
    }
    // Note: We are no longer capturing system audio in this simplified setup.

    // 3. Prepare final stream
    const finalStream = new MediaStream();

    if (this.config.mode === 'video' && this.systemStream) {
      this.systemStream.getVideoTracks().forEach(track => {
        finalStream.addTrack(track);
      });
    }

    // Add mixed audio
    this.mixer.getMixedStream().getAudioTracks().forEach(track => {
      finalStream.addTrack(track);
    });

    // 4. Setup MediaRecorder
    let mimeType = 'video/webm;codecs=vp8,opus';
    if (this.config.mode === 'audio' && MediaRecorder.isTypeSupported('audio/mp4')) {
      mimeType = 'audio/mp4';
    } else if (!MediaRecorder.isTypeSupported(mimeType)) {
      mimeType = 'video/webm';
    }

    this.mediaRecorder = new MediaRecorder(finalStream, {
      mimeType,
      audioBitsPerSecond: this.config.audioBitrate,
      videoBitsPerSecond: this.config.mode === 'video' ? this.config.videoBitrate : undefined,
    });

    this.mediaRecorder.ondataavailable = async (e) => {
      if (e.data.size > 0) {
        if (!this.diskWriter?.isDiskWriter()) {
          this.chunks.push(e.data); // Only keep in memory if we are falling back
        }
        await this.diskWriter?.write(e.data);
      }
    };

    this.mediaRecorder.onstop = async () => {
      if (!this.diskWriter?.isDiskWriter() && this.chunks.length > 0) {
        // Fallback: fix duration for the memory blob
        const buggedBlob = new Blob(this.chunks, { type: mimeType });

        if (mimeType.includes('webm')) {
          ysFixWebmDuration(buggedBlob, this.duration, async (fixedBlob) => {
            await this.diskWriter?.close(fixedBlob, mimeType);
            this.cleanup();
          });
        } else {
          await this.diskWriter?.close(buggedBlob, mimeType);
          this.cleanup();
        }
      } else {
        // Disk writer: just close it (streaming duration might be Infinity, but doesn't crash browser with OOM)
        await this.diskWriter?.close(undefined, mimeType);
        this.cleanup();
      }
    };

    // 5. Start
    this.mediaRecorder.start(this.config.timeslice);
    this.startTime = Date.now();
    this.dispatchEvent(new Event('started'));

    // Tick interval
    this.tickIntervalId = setInterval(() => {
      if (this.mediaRecorder?.state === 'recording') {
        this.duration = Date.now() - this.startTime;
        this.dispatchEvent(new CustomEvent('tick', { detail: { duration: this.duration } }));
      }
    }, 1000);
  }

  public getMixer(): AudioMixer | null {
    return this.mixer;
  }

  private cleanup() {
    if (this.tickIntervalId) {
      clearInterval(this.tickIntervalId);
      this.tickIntervalId = null;
    }
    this.micStream?.getTracks().forEach(t => t.stop());
    this.systemStream?.getTracks().forEach(t => t.stop());
    this.mixer?.dispose();
    this.chunks = [];
    this.dispatchEvent(new Event('stopped'));
  }

  stop() {
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
    }
  }

  pause() {
    if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
      this.mediaRecorder.pause();
      this.dispatchEvent(new Event('paused'));
    }
  }

  resume() {
    if (this.mediaRecorder && this.mediaRecorder.state === 'paused') {
      // adjust startTime so duration doesn't jump
      // Actually simple logic for duration is to not use Date.now() like this,
      // but for simplicity we keep it as is, or we accumulate duration.
      this.mediaRecorder.resume();
      this.dispatchEvent(new Event('resumed'));
    }
  }
}

export class AudioMixer {
  private context: AudioContext;
  private destination: MediaStreamAudioDestinationNode;
  private gainNodes: Map<string, GainNode> = new Map();
  private sources: Map<string, MediaStreamAudioSourceNode> = new Map();

  constructor() {
    this.context = new AudioContext();
    this.destination = this.context.createMediaStreamDestination();
  }

  addStream(stream: MediaStream, label: string) {
    if (stream.getAudioTracks().length === 0) return;

    const source = this.context.createMediaStreamSource(stream);
    const gainNode = this.context.createGain();

    source.connect(gainNode);
    gainNode.connect(this.destination);

    this.sources.set(label, source);
    this.gainNodes.set(label, gainNode);
  }

  getGainNode(label: string): GainNode | undefined {
    return this.gainNodes.get(label);
  }

  getMixedStream(): MediaStream {
    return this.destination.stream;
  }

  getAudioContext(): AudioContext {
    return this.context;
  }

  dispose() {
    this.sources.forEach(source => source.disconnect());
    this.gainNodes.forEach(gainNode => gainNode.disconnect());
    this.destination.disconnect();

    this.sources.clear();
    this.gainNodes.clear();

    if (this.context.state !== 'closed') {
      this.context.close();
    }
  }
}

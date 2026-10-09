import { DiskWriter } from './disk-writer.ts';
export { DiskWriter } from './disk-writer.ts';

export type RecordingConfig = {
  mode: 'audio' | 'video';
  micDeviceId?: string;
  camDeviceId?: string;
  captureSystemAudio?: boolean;
  voiceEnhancement?: boolean;
  audioBitrate: number; // default 128000
  videoBitrate?: number; // optional fallback
  timeslice: number;    // default 1000 (ms)
};

export class RecordingEngine extends EventTarget {
  private config: RecordingConfig;
  private mixer: AudioMixer | null = null;
  private diskWriter: DiskWriter | null = null;
  private mediaRecorder: MediaRecorder | null = null;

  private micStream: MediaStream | null = null;
  private systemStream: MediaStream | null = null;
  private displayStream: MediaStream | null = null;

  private startTime: number = 0;
  private duration: number = 0;
  private elapsed: number = 0;
  private stopPromise: Promise<void> | null = null;
  private settle: (() => void) | null = null;
  private rejectStop: ((error: Error) => void) | null = null;
  private failure: Error | null = null;
  private tickIntervalId: ReturnType<typeof setInterval> | null = null;

  constructor(config: RecordingConfig) {
    super();
    this.config = config;
  }

  private cleanupStreams() {
    this.micStream?.getTracks().forEach(t => t.stop());
    this.systemStream?.getTracks().forEach(t => t.stop());
    this.displayStream?.getTracks().forEach(t => t.stop());
  }

  async start(writer: DiskWriter) {
    this.diskWriter = writer;
    try {

    // 1. Get streams
    if (this.config.mode === 'video') {
      try {
        this.systemStream = await navigator.mediaDevices.getUserMedia({
          video: this.config.camDeviceId ? { deviceId: this.config.camDeviceId } : true,
        });
      } catch (e) {
        console.warn("Could not get camera stream", e);
      }
    }

    if (this.config.captureSystemAudio) {
      try {
        this.displayStream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: {
            echoCancellation: false,
            autoGainControl: false,
            noiseSuppression: false,
            googEchoCancellation: false,
            googAutoGainControl: false,
            googNoiseSuppression: false,
            googHighpassFilter: false,
            channelCount: 2,
            sampleRate: 48000,
          } as MediaTrackConstraints,
        });
      } catch (e) {
        console.warn("Could not get display media for system audio", e);
      }
    }

    try {
      const audioConstraints: MediaTrackConstraints = {
        echoCancellation: this.config.voiceEnhancement ?? false,
        autoGainControl: this.config.voiceEnhancement ?? false,
        noiseSuppression: this.config.voiceEnhancement ?? false,
        // Chrome specific non-standard constraints for raw audio
        ...(!this.config.voiceEnhancement ? {
          googEchoCancellation: false,
          googAutoGainControl: false,
          googNoiseSuppression: false,
          googHighpassFilter: false,
        } : {}),
        channelCount: 1, // Voice is mono; forces cleaner capture especially on Bluetooth HFP
        sampleRate: 48000,
      } as MediaTrackConstraints;
      if (this.config.micDeviceId) {
        audioConstraints.deviceId = this.config.micDeviceId;
      }
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints,
      });
    } catch (e) {
      console.warn("Could not get mic stream", e);
    }

    const hasMicAudio = this.micStream ? this.micStream.getAudioTracks().length > 0 : false;
    const hasSysAudio = this.displayStream ? this.displayStream.getAudioTracks().length > 0 : false;

    if (!hasMicAudio && !hasSysAudio) {
      this.cleanupStreams();
      throw new Error("No audio source available. Please grant microphone permissions or share system audio.");
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
    if (this.displayStream && hasSysAudio) {
      this.mixer.addStream(this.displayStream, 'system');
      
      // Enable sidechain ducking if both exist
      if (this.micStream) {
        this.mixer.enableDucking('mic', 'system');
      }
    }

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

    // 4. Calculate Dynamic Video Bitrate (matching framecut-editor)
    let videoBitrate = this.config.videoBitrate || 5_000_000;
    if (this.config.mode === 'video') {
      const videoTrack = finalStream.getVideoTracks()[0];
      if (videoTrack) {
        const settings = videoTrack.getSettings();
        const width = settings.width || 0;
        const height = settings.height || 0;
        const pixelCount = width * height;

        if (pixelCount > 2_073_600) {
          videoBitrate = 12_000_000; // > 1080p
        } else if (pixelCount > 921_600) {
          videoBitrate = 8_000_000; // > 720p
        } else {
          videoBitrate = 5_000_000; // Baseline
        }
      }
    }

    // 5. Setup MediaRecorder
    this.mediaRecorder = new MediaRecorder(finalStream, {
      mimeType: writer.format.mimeType,
      audioBitsPerSecond: this.config.audioBitrate,
      videoBitsPerSecond: this.config.mode === 'video' ? videoBitrate : undefined,
    });

    this.stopPromise = new Promise<void>((resolve, reject) => { this.settle = resolve; this.rejectStop = reject; });
    // Async capture failures are surfaced through recordingerror even if the UI
    // hasn't called Stop yet. The same rejection remains observable by Stop.
    void this.stopPromise.catch(() => {});
    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        void writer.write(e.data).catch(error => this.fail(error));
      }
    };
    this.mediaRecorder.onerror = () => this.fail(new Error('The browser could not continue recording.'));
    this.mediaRecorder.onstop = async () => {
      this.captureDuration();
      this.cleanupStreams();
      try {
        if (this.failure) throw this.failure;
        await writer.close(this.duration);
        this.cleanup();
        this.dispatchEvent(new CustomEvent('stopped', { detail: { duration: this.duration } }));
        this.settle?.();
      } catch (error) {
        await writer.abort();
        this.fail(error);
        this.cleanup();
        this.rejectStop?.(this.failure!);
      }
    };

    // 5. Start
    this.mediaRecorder.start(this.config.timeslice);
    this.startTime = performance.now();
    this.dispatchEvent(new Event('started'));

    // Tick interval
    this.tickIntervalId = setInterval(() => {
      if (this.mediaRecorder?.state === 'recording') {
        this.duration = this.elapsed + performance.now() - this.startTime;
        this.dispatchEvent(new CustomEvent('tick', { detail: { duration: this.duration } }));
      }
    }, 1000);
    } catch (error) {
      this.cleanup();
      await writer.abort();
      throw error;
    }
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
    this.displayStream?.getTracks().forEach(t => t.stop());
    this.mixer?.dispose();
  }

  private captureDuration() {
    if (this.startTime !== 0) {
      this.elapsed += performance.now() - this.startTime;
      this.startTime = 0;
    }
    this.duration = this.elapsed;
  }

  private fail(error: unknown) {
    if (this.failure) return;
    this.failure = error instanceof Error ? error : new Error('Recording could not be saved.');
    this.dispatchEvent(new CustomEvent('recordingerror', { detail: { error: this.failure } }));
    if (this.mediaRecorder?.state !== 'inactive') void this.stop().catch(() => {});
  }

  stop(): Promise<void> {
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.captureDuration();
      this.mediaRecorder.stop();
      this.cleanupStreams();
    }
    return this.stopPromise || Promise.resolve();
  }

  pause() {
    if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
      this.captureDuration();
      this.mediaRecorder.pause();
      this.dispatchEvent(new Event('paused'));
    }
  }

  resume() {
    if (this.mediaRecorder && this.mediaRecorder.state === 'paused') {
      this.mediaRecorder.resume();
      this.startTime = performance.now();
      this.dispatchEvent(new Event('resumed'));
    }
  }
}

export class AudioMixer {
  private context: AudioContext;
  private destination: MediaStreamAudioDestinationNode;
  private gainNodes: Map<string, GainNode> = new Map();
  private sources: Map<string, MediaStreamAudioSourceNode> = new Map();

  // Ducking state
  private duckingInterval: ReturnType<typeof setInterval> | null = null;
  private micAnalyser: AnalyserNode | null = null;
  private sysDuckingNode: GainNode | null = null;

  constructor() {
    // 1. Initialize context with hardware-native settings to avoid resampling artifacts
    this.context = new AudioContext({
      latencyHint: 'interactive',
      sampleRate: 48000,
    });
    
    // 2. Create destination and ensure stereo
    this.destination = this.context.createMediaStreamDestination();
    this.destination.channelCount = 2;

    // 4. Connect chain (Bypassing compressor node to ensure raw high-fidelity audio without metallic artifacts)
  }

  addStream(stream: MediaStream, label: string) {
    if (stream.getAudioTracks().length === 0) return;

    const source = this.context.createMediaStreamSource(stream);
    const gainNode = this.context.createGain();

    // Headroom: Mic at 0.8, System at 0.4 to prevent clipping and ensure voice clarity
    const targetGain = label === 'mic' ? 0.8 : 0.4;
    gainNode.gain.setValueAtTime(targetGain, this.context.currentTime);

    source.connect(gainNode);
    
    // If this is the system stream, we might want to insert a ducking node
    if (label === 'system') {
      this.sysDuckingNode = this.context.createGain();
      gainNode.connect(this.sysDuckingNode);
      this.sysDuckingNode.connect(this.destination);
    } else {
      gainNode.connect(this.destination);
    }

    this.sources.set(label, source);
    this.gainNodes.set(label, gainNode);
  }

  enableDucking(triggerLabel: string, targetLabel: string) {
    const triggerSource = this.sources.get(triggerLabel);
    if (!triggerSource || targetLabel !== 'system' || !this.sysDuckingNode) return;

    // 1. Create analyser to monitor mic levels
    this.micAnalyser = this.context.createAnalyser();
    this.micAnalyser.fftSize = 256;
    triggerSource.connect(this.micAnalyser);

    const dataArray = new Uint8Array(this.micAnalyser.frequencyBinCount);
    
    // 2. Monitoring loop for "Sidechain Ducking"
    this.duckingInterval = setInterval(() => {
      if (!this.micAnalyser || !this.sysDuckingNode) return;
      
      this.micAnalyser.getByteFrequencyData(dataArray);
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
      const average = sum / dataArray.length;

      // Threshold for ducking: if mic average > 25 (talking)
      const isTalking = average > 25;
      const targetGain = isTalking ? 0.15 : 1.0; 
      
      // Exponential transition for natural feel
      const now = this.context.currentTime;
      this.sysDuckingNode.gain.exponentialRampToValueAtTime(targetGain, now + 0.15);
    }, 50);
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
    if (this.duckingInterval) clearInterval(this.duckingInterval);
    this.sources.forEach(source => source.disconnect());
    this.gainNodes.forEach(gainNode => gainNode.disconnect());
    if (this.sysDuckingNode) this.sysDuckingNode.disconnect();
    this.destination.disconnect();

    this.sources.clear();
    this.gainNodes.clear();

    if (this.context.state !== 'closed') {
      this.context.close();
    }
  }
}

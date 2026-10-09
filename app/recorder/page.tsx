"use client";
import { ToolsLayout } from '@/components/ToolsLayout';
import { useState, useRef, useEffect } from 'react';
import { RecordingEngine, DiskWriter } from './lib/recording-engine';
import { selectRecordingFormat } from './lib/recording-format';
import { DeviceSelector } from './components/DeviceSelector';
import { AudioLevelMeter } from './components/AudioLevelMeter';
import { PipTimer } from './components/PipTimer';
import { Play, Square, Pause, Mic, Video, Settings2, Download, AlertCircle } from 'lucide-react';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'An unknown error occurred';
}

function isAbortError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError';
}

export default function RecorderPage() {
  const [state, setState] = useState<'setup' | 'recording' | 'paused' | 'done'>('setup');
  const [mode, setMode] = useState<'audio' | 'video'>('audio');
  const [micId, setMicId] = useState<string>('');
  const [camId, setCamId] = useState<string>('');
  const [captureSystemAudio, setCaptureSystemAudio] = useState<boolean>(false);
  const [voiceEnhancement, setVoiceEnhancement] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const [duration, setDuration] = useState(0);
  const [fileSupported, setFileSupported] = useState(true);
  const [busy, setBusy] = useState<'idle' | 'starting' | 'saving'>('idle');
  const [completedWithDiskWriter, setCompletedWithDiskWriter] = useState(false);

  const engineRef = useRef<RecordingEngine | null>(null);
  const writerRef = useRef<DiskWriter | null>(null);
  const mountedRef = useRef(false);
  const busyRef = useRef<'idle' | 'starting' | 'saving'>('idle');
  const recordingFailureRef = useRef<Error | null>(null);

  const [micAnalyser, setMicAnalyser] = useState<AnalyserNode | null>(null);
  const [sysAnalyser, setSysAnalyser] = useState<AnalyserNode | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    const timer = setTimeout(() => {
      setFileSupported(DiskWriter.isSupported());
    }, 0);

    return () => {
      mountedRef.current = false;
      clearTimeout(timer);

      const engine = engineRef.current;
      engineRef.current = null;
      if (engine) void engine.stop().catch(() => undefined);
    };
  }, []);

  const releaseEngine = (engine: RecordingEngine) => {
    if (engineRef.current !== engine) return;

    engineRef.current = null;
    writerRef.current = null;
    recordingFailureRef.current = null;

    if (mountedRef.current) {
      setMicAnalyser(null);
      setSysAnalyser(null);
    }
  };

  const stopRecording = async (engine: RecordingEngine) => {
    if (busyRef.current === 'saving') return;
    busyRef.current = 'saving';
    if (mountedRef.current) setBusy('saving');
    try {
      await engine.stop();
      if (recordingFailureRef.current) throw recordingFailureRef.current;

      const writer = writerRef.current;
      if (!writer) throw new Error('Could not confirm the recording destination.');

      if (mountedRef.current) {
        setCompletedWithDiskWriter(writer.isDiskWriter());
        setState('done');
      }
    } catch (stopError: unknown) {
      if (mountedRef.current) {
        setError(errorMessage(stopError));
        setState('setup');
      }
    } finally {
      busyRef.current = 'idle';
      if (mountedRef.current) setBusy('idle');
      releaseEngine(engine);
    }
  };

  const handleStart = async () => {
    if (busyRef.current !== 'idle') return;

    busyRef.current = 'starting';
    setBusy('starting');
    setError(null);
    setDuration(0);
    setCompletedWithDiskWriter(false);
    recordingFailureRef.current = null;

    let engine: RecordingEngine | null = null;
    let started = false;

    try {
      const format = selectRecordingFormat(mode);
      const suggestedName = `recording_${new Date().toISOString().replace(/[:.]/g, '-')}${format.extension}`;
      let writer: DiskWriter;

      try {
        writer = await DiskWriter.create(suggestedName, format);
      } catch (pickerError: unknown) {
        if (isAbortError(pickerError)) return;
        throw pickerError;
      }

      if (!mountedRef.current) {
        await writer.abort().catch(() => undefined);
        return;
      }
      writerRef.current = writer;

      const activeEngine = new RecordingEngine({
        mode,
        micDeviceId: micId,
        camDeviceId: camId,
        captureSystemAudio,
        voiceEnhancement,
        audioBitrate: 128000,
        videoBitrate: 5000000,
        timeslice: 1000,
      });
      engine = activeEngine;
      engineRef.current = activeEngine;

      const onPaused = () => {
        if (engineRef.current === activeEngine) setState('paused');
      };
      const onResumed = () => {
        if (engineRef.current === activeEngine) setState('recording');
      };
      const updateDuration = (event: Event) => {
        if (engineRef.current === activeEngine) setDuration((event as CustomEvent<{ duration: number }>).detail.duration);
      };
      const onRecordingError = (event: Event) => {
        if (engineRef.current !== activeEngine) return;
        const detail = (event as CustomEvent<{ error: Error }>).detail;
        recordingFailureRef.current ??= detail?.error instanceof Error ? detail.error : new Error('Recording failed.');
        setError(recordingFailureRef.current.message);
        if (busyRef.current === 'idle') void stopRecording(activeEngine);
      };

      activeEngine.addEventListener('paused', onPaused);
      activeEngine.addEventListener('resumed', onResumed);
      activeEngine.addEventListener('stopped', updateDuration);
      activeEngine.addEventListener('tick', updateDuration);
      activeEngine.addEventListener('recordingerror', onRecordingError);

      await activeEngine.start(writer);
      started = true;

      if (!mountedRef.current) {
        try {
          await activeEngine.stop();
        } catch {
          // The page is gone; stopping the source is still the priority.
        }
        releaseEngine(activeEngine);
        return;
      }

      if (recordingFailureRef.current) {
        await stopRecording(activeEngine);
        return;
      }

      busyRef.current = 'idle';
      setBusy('idle');
      setState('recording');

      const mixer = activeEngine.getMixer();
      if (mixer) {
        const actx = mixer.getAudioContext();

        const mGain = mixer.getGainNode('mic');
        if (mGain) {
          const mAnl = actx.createAnalyser();
          mGain.connect(mAnl);
          setMicAnalyser(mAnl);
        }

        const sGain = mixer.getGainNode('system');
        if (sGain) {
          const sAnl = actx.createAnalyser();
          sGain.connect(sAnl);
          setSysAnalyser(sAnl);
        }
      }
    } catch (startError: unknown) {
      if (engine && started) {
        try {
          await engine.stop();
        } catch {
          // The original startup error is the useful message to show.
        }
      }

      if (engine) releaseEngine(engine);
      if (mountedRef.current) {
        setError(errorMessage(startError));
        setState('setup');
      }
    } finally {
      busyRef.current = 'idle';
      if (mountedRef.current) setBusy('idle');
    }
  };

  const handleStop = async () => {
    const engine = engineRef.current;
    if (engine) await stopRecording(engine);
  };

  const handlePause = () => {
    engineRef.current?.pause();
  };

  const handleResume = () => {
    engineRef.current?.resume();
  };

  const formatTime = (ms: number) => {
    const totalS = Math.floor(ms / 1000);
    const m = Math.floor(totalS / 60).toString().padStart(2, '0');
    const s = (totalS % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  return (
    <ToolsLayout>
      <div className="max-w-4xl mx-auto py-8">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-zinc-900 mb-2">Continuous Recorder</h1>
          <p className="text-zinc-600">Record audio/video directly to your local disk.</p>
        </div>

        <div className="bg-white border border-zinc-200 rounded-2xl p-6 md:p-8 shadow-sm max-w-2xl mx-auto">
          {error && state !== 'setup' && (
            <div role="alert" className="mb-6 bg-red-50 border border-red-200 text-red-800 p-4 rounded-xl flex items-start gap-3 text-sm">
              <AlertCircle className="w-5 h-5 shrink-0" />
              <p>{error}</p>
            </div>
          )}

          {/* Setup State */}
          {state === 'setup' && (
            <div className="space-y-6">
              {error && (
                <div className="bg-red-50 border border-red-200 text-red-800 p-4 rounded-xl flex items-start gap-3 text-sm">
                  <AlertCircle className="w-5 h-5 shrink-0" />
                  <p>{error}</p>
                </div>
              )}

              {!fileSupported && (
                <div className="bg-amber-50 border border-amber-200 text-amber-800 p-4 rounded-xl flex items-start gap-3 text-sm">
                  <AlertCircle className="w-5 h-5 shrink-0" />
                  <p>
                    Your browser doesn&apos;t support direct disk writing. Recordings are buffered in memory with a 256 MiB maximum. On successful stop, a browser download is initiated.
                  </p>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <button
                  onClick={() => setMode('audio')}
                  className={`p-4 rounded-xl border-2 flex flex-col items-center justify-center gap-2 transition-all ${
                    mode === 'audio' ? 'border-orange-500 bg-orange-50 text-orange-700' : 'border-zinc-200 text-zinc-500 hover:border-zinc-300'
                  }`}
                >
                  <Mic className="w-6 h-6" />
                  <span className="font-semibold">Audio Only</span>
                </button>
                <button
                  onClick={() => setMode('video')}
                  className={`p-4 rounded-xl border-2 flex flex-col items-center justify-center gap-2 transition-all ${
                    mode === 'video' ? 'border-orange-500 bg-orange-50 text-orange-700' : 'border-zinc-200 text-zinc-500 hover:border-zinc-300'
                  }`}
                >
                  <Video className="w-6 h-6" />
                  <span className="font-semibold">Video + Audio</span>
                </button>
              </div>

              <div className="bg-zinc-50 p-4 rounded-xl space-y-4 border border-zinc-100">
                <div className="flex items-center gap-2 text-zinc-700 font-semibold pb-2 border-b border-zinc-200">
                  <Settings2 className="w-4 h-4" /> Configuration
                </div>
                <DeviceSelector mediaType="audio" selectedDeviceId={micId} onChange={setMicId} />
                {mode === 'video' && (
                  <DeviceSelector mediaType="video" selectedDeviceId={camId} onChange={setCamId} />
                )}

                <div className="pt-2 space-y-3">
                  <label className="flex items-center gap-3 cursor-pointer group">
                    <div className="relative">
                      <input
                        type="checkbox"
                        className="sr-only"
                        checked={captureSystemAudio}
                        onChange={(e) => setCaptureSystemAudio(e.target.checked)}
                      />
                      <div className={`w-10 h-6 rounded-full transition-colors ${captureSystemAudio ? 'bg-orange-600' : 'bg-zinc-300'}`}></div>
                      <div className={`absolute left-1 top-1 bg-white w-4 h-4 rounded-full transition-transform ${captureSystemAudio ? 'translate-x-4' : ''}`}></div>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-sm font-semibold text-zinc-700">Include System Audio</span>
                      <span className="text-xs text-zinc-500">Captures media output (Ducking enabled)</span>
                    </div>
                  </label>

                  <label className="flex items-center gap-3 cursor-pointer group">
                    <div className="relative">
                      <input
                        type="checkbox"
                        className="sr-only"
                        checked={voiceEnhancement}
                        onChange={(e) => setVoiceEnhancement(e.target.checked)}
                      />
                      <div className={`w-10 h-6 rounded-full transition-colors ${voiceEnhancement ? 'bg-orange-600' : 'bg-zinc-300'}`}></div>
                      <div className={`absolute left-1 top-1 bg-white w-4 h-4 rounded-full transition-transform ${voiceEnhancement ? 'translate-x-4' : ''}`}></div>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-sm font-semibold text-zinc-700">Voice Enhancement</span>
                      <span className="text-xs text-zinc-500">Enable Noise Suppression & Echo Cancellation</span>
                    </div>
                  </label>

                  {captureSystemAudio && (
                    <div className="bg-blue-50 border border-blue-100 p-3 rounded-lg flex items-center gap-2 text-blue-700 text-xs mt-2">
                      <AlertCircle className="w-4 h-4" />
                      <span>Recommended: Use headphones to prevent audio loopback.</span>
                    </div>
                  )}
                </div>
              </div>

              <button
                onClick={handleStart}
                disabled={busy !== 'idle'}
                aria-busy={busy !== 'idle'}
                className="w-full py-4 bg-orange-600 hover:bg-orange-700 disabled:opacity-60 disabled:cursor-wait text-white rounded-xl font-bold text-lg flex items-center justify-center gap-2 transition-colors shadow-sm"
              >
                <Play className="w-5 h-5 fill-current" />
                {busy === 'starting' ? 'Starting…' : busy === 'saving' ? 'Saving…' : 'Start Recording'}
              </button>
            </div>
          )}

          {/* Recording / Paused State */}
          {(state === 'recording' || state === 'paused') && (
            <div className="space-y-8 flex flex-col items-center" aria-busy={busy === 'saving'}>

              <div className="text-center">
                <div className={`text-5xl font-mono font-bold tracking-tight ${state === 'paused' ? 'text-zinc-400' : 'text-zinc-900'} transition-colors`}>
                  {formatTime(duration)}
                </div>
                <div className="text-sm font-medium text-zinc-500 mt-2 flex items-center justify-center gap-2 uppercase tracking-widest">
                  {state === 'recording' ? (
                    <><span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" /> Recording</>
                  ) : (
                    <><span className="w-2 h-2 rounded-full bg-yellow-500" /> Paused</>
                  )}
                </div>
              </div>

              <div className="w-full flex flex-col gap-4 items-center max-w-xs">
                {micAnalyser && <AudioLevelMeter analyser={micAnalyser} label="Microphone" />}
                {sysAnalyser && <AudioLevelMeter analyser={sysAnalyser} label="System Audio" />}
              </div>

              <div className="flex items-center gap-4">
                {state === 'recording' ? (
                  <button onClick={handlePause} disabled={busy === 'saving'} aria-label="Pause recording" className="w-14 h-14 rounded-full bg-yellow-100 text-yellow-600 flex items-center justify-center hover:bg-yellow-200 disabled:opacity-50 transition-colors">
                    <Pause className="w-6 h-6 fill-current" />
                  </button>
                ) : (
                  <button onClick={handleResume} disabled={busy === 'saving'} aria-label="Resume recording" className="w-14 h-14 rounded-full bg-green-100 text-green-600 flex items-center justify-center hover:bg-green-200 disabled:opacity-50 transition-colors">
                    <Play className="w-6 h-6 fill-current" />
                  </button>
                )}

                <button onClick={handleStop} disabled={busy === 'saving'} aria-label="Stop recording" className="w-16 h-16 rounded-full bg-red-100 text-red-600 flex items-center justify-center hover:bg-red-200 disabled:opacity-50 transition-colors group">
                  <Square className="w-6 h-6 fill-current group-hover:scale-90 transition-transform" />
                </button>
              </div>

              {busy === 'saving' && <p role="status" className="text-sm font-medium text-zinc-600">Saving recording…</p>}

              <div className="pt-4 border-t border-zinc-100 w-full flex justify-center">
                <PipTimer duration={duration} isActive={state === 'recording'} />
              </div>
            </div>
          )}

          {/* Done State */}
          {state === 'done' && (
            <div className="text-center space-y-6 py-4">
              <div className="w-20 h-20 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-6">
                <Download className="w-10 h-10" />
              </div>
              <h2 className="text-2xl font-bold text-zinc-900">Recording Finalized</h2>
              <p className="text-zinc-600">
                {completedWithDiskWriter
                  ? 'Your recording was finalized at the location you chose.'
                  : 'Your recording was finalized and a browser download was initiated.'}
              </p>

              <div className="pt-6">
                <button
                  onClick={() => {
                    setState('setup');
                    setDuration(0);
                    setError(null);
                    setCompletedWithDiskWriter(false);
                  }}
                  className="px-6 py-3 bg-zinc-900 hover:bg-zinc-800 text-white rounded-xl font-medium transition-colors"
                >
                  Record Another
                </button>
              </div>
            </div>
          )}

        </div>
      </div>
    </ToolsLayout>
  );
}

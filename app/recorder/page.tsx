"use client";

import { ToolsLayout } from '@/components/ToolsLayout';
import { useState, useRef, useEffect } from 'react';
import { RecordingEngine, DiskWriter } from './lib/recording-engine';
import { DeviceSelector } from './components/DeviceSelector';
import { AudioLevelMeter } from './components/AudioLevelMeter';
import { PipTimer } from './components/PipTimer';
import { Play, Square, Pause, Mic, Video, Settings2, Download, AlertCircle } from 'lucide-react';

export default function RecorderPage() {
  const [state, setState] = useState<'setup' | 'recording' | 'paused' | 'done'>('setup');
  const [mode, setMode] = useState<'audio' | 'video'>('audio');
  const [micId, setMicId] = useState<string>('');
  const [camId, setCamId] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  const [duration, setDuration] = useState(0);
  const [fileSupported, setFileSupported] = useState(true);

  // Engine instance
  const engineRef = useRef<RecordingEngine | null>(null);

  // We need to export analysers from the mixer to meter them
  const [micAnalyser, setMicAnalyser] = useState<AnalyserNode | null>(null);
  const [sysAnalyser, setSysAnalyser] = useState<AnalyserNode | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setFileSupported(DiskWriter.isSupported());
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  const handleStart = async () => {
    setError(null);
    try {
      const ext = '.webm';
      const suggestedName = `recording_${new Date().toISOString().replace(/[:.]/g, '-')}${ext}`;

      const writer = await DiskWriter.create(suggestedName);

      const engine = new RecordingEngine({
        mode,
        micDeviceId: micId,
        camDeviceId: camId,
        audioBitrate: 128000,
        videoBitrate: 2500000,
        timeslice: 1000,
      });

      engine.addEventListener('started', () => setState('recording'));
      engine.addEventListener('paused', () => setState('paused'));
      engine.addEventListener('resumed', () => setState('recording'));
      engine.addEventListener('stopped', () => {
        setState('done');
        setMicAnalyser(null);
        setSysAnalyser(null);
      });

      engine.addEventListener('tick', (e: Event) => {
        setDuration((e as CustomEvent<{ duration: number }>).detail.duration);
      });

      await engine.start(writer);
      engineRef.current = engine;

      // Hook up analysers if we want meters (optional extension to RecordingEngine, but we can access it if we expose it)
      const mixer = engine.getMixer();
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
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleStop = () => {
    engineRef.current?.stop();
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
                  <p>Your browser doesn&apos;t support direct disk writing. The recording will be kept in memory and downloaded when you stop.</p>
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
              </div>

              <button
                onClick={handleStart}
                className="w-full py-4 bg-orange-600 hover:bg-orange-700 text-white rounded-xl font-bold text-lg flex items-center justify-center gap-2 transition-colors shadow-sm"
              >
                <Play className="w-5 h-5 fill-current" />
                Start Recording
              </button>
            </div>
          )}

          {/* Recording / Paused State */}
          {(state === 'recording' || state === 'paused') && (
            <div className="space-y-8 flex flex-col items-center">

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
                  <button onClick={handlePause} className="w-14 h-14 rounded-full bg-yellow-100 text-yellow-600 flex items-center justify-center hover:bg-yellow-200 transition-colors">
                    <Pause className="w-6 h-6 fill-current" />
                  </button>
                ) : (
                  <button onClick={handleResume} className="w-14 h-14 rounded-full bg-green-100 text-green-600 flex items-center justify-center hover:bg-green-200 transition-colors">
                    <Play className.tsx="w-6 h-6 fill-current" />
                  </button>
                )}

                <button onClick={handleStop} className="w-16 h-16 rounded-full bg-red-100 text-red-600 flex items-center justify-center hover:bg-red-200 transition-colors group">
                  <Square className="w-6 h-6 fill-current group-hover:scale-90 transition-transform" />
                </button>
              </div>

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
              <h2 className="text-2xl font-bold text-zinc-900">Recording Saved!</h2>
              <p className="text-zinc-600">
                Your recording has been finalized.
                {fileSupported ? ' It was saved directly to the location you chose.' : ' Your browser has downloaded the file.'}
              </p>

              <div className="pt-6">
                <button
                  onClick={() => {
                    setState('setup');
                    setDuration(0);
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

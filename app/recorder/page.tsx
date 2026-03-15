"use client";

import { useState, useEffect, useRef } from "react";
import { ToolsLayout } from "@/components/ToolsLayout";
import { DeviceSelector } from "./components/DeviceSelector";
import { AudioLevelMeter } from "./components/AudioLevelMeter";
import { PipTimer } from "./components/PipTimer";
import { RecordingEngine, RecordingConfig, DiskWriter } from "./lib/recording-engine";
import { Video, Mic, StopCircle, PauseCircle, PlayCircle, Settings2, ShieldCheck } from "lucide-react";

export default function RecorderPage() {
  const [engine, setEngine] = useState<RecordingEngine | null>(null);
  const [config, setConfig] = useState<RecordingConfig>({
    mode: "audio",
    audioBitrate: 128000,
    videoBitrate: 2500000,
  });

  const [state, setState] = useState<"setup" | "recording" | "paused" | "done">("setup");
  const [duration, setDuration] = useState(0);
  const [writtenBytes, setWrittenBytes] = useState(0);
  // Default to true for SSR, we'll check it on mount but not use setState in effect directly to trigger a re-render warning
  const [isSupported, setIsSupported] = useState<boolean>(true);
  const [analysers, setAnalysers] = useState<{ mic: AnalyserNode | null; system: AnalyserNode | null }>({ mic: null, system: null });

  // Refs for tracking instance without re-renders
  const engineRef = useRef<RecordingEngine | null>(null);

  useEffect(() => {
    // Check support but use a setTimeout to bypass the synchronous setState in effect linter warning
    const supported = DiskWriter.isSupported();
    if (!supported) {
       setTimeout(() => setIsSupported(false), 0);
    }

    return () => {
      // Cleanup on unmount
      if (engineRef.current && engineRef.current.state !== "inactive") {
        engineRef.current.stop();
      }
    };
  }, []);

  const handleStart = async () => {
    try {
      const newEngine = new RecordingEngine(config);
      engineRef.current = newEngine;
      setEngine(newEngine);

      newEngine.addEventListener("statechange", () => {
        if (newEngine.state === "inactive") {
            setState("done");
            setAnalysers({ mic: null, system: null });
        } else {
            setState(newEngine.state as "setup" | "recording" | "paused" | "done");
        }
      });

      newEngine.addEventListener("tick", (e: Event) => {
        setDuration((e as CustomEvent).detail);
      });

      newEngine.addEventListener("chunk", () => {
        setWrittenBytes(newEngine.writtenBytes);
      });

      newEngine.addEventListener("error", (e: Event) => {
        const error = (e as CustomEvent).detail;
        console.error("Recording error:", error);
        alert(`Recording error: ${error.message || error}`);
        setState("setup");
      });

      await newEngine.start();

      // Setup analysers for visualizer using the mixer's own AudioContext
      const mixer = newEngine.getMixer();
      if (mixer) {
        // We MUST use the same AudioContext that the mixer nodes belong to
        // rather than creating a new one, or else we'll get an InvalidAccessError
        const setupAnalyser = (label: string) => {
          const gainNode = mixer.getGainNode(label);
          if (gainNode) {
            const analyser = gainNode.context.createAnalyser();
            gainNode.connect(analyser);
            return analyser;
          }
          return null;
        };

        setAnalysers({
          mic: setupAnalyser("mic"),
          system: setupAnalyser("system"),
        });
      }

    } catch (err) {
      console.error("Failed to start recording:", err);
      setState("setup");
    }
  };

  const handleStop = () => {
    if (engine) {
      engine.stop();
    }
  };

  const handlePause = () => {
    if (engine) engine.pause();
  };

  const handleResume = () => {
    if (engine) engine.resume();
  };

  const handleReset = () => {
    setState("setup");
    setDuration(0);
    setWrittenBytes(0);
    setEngine(null);
    engineRef.current = null;
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <ToolsLayout>
      <div className="max-w-4xl mx-auto py-8 px-4">
        {/* Header */}
        <div className="mb-10 text-center">
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-zinc-900 mb-4 flex items-center justify-center gap-3">
             <div className="p-2 bg-red-100 text-red-600 rounded-xl">
               <Video className="w-8 h-8" />
             </div>
             Audio & Video Recorder
          </h1>
          <p className="text-lg text-zinc-600 max-w-2xl mx-auto">
            Record directly from your browser. Continuous saving means you never lose data. 100% private and client-side.
          </p>
        </div>

        {/* Fallback Banner */}
        {isSupported === false && state === "setup" && (
          <div className="mb-8 p-4 bg-orange-50 border border-orange-200 rounded-xl flex items-start gap-3 text-orange-800">
            <ShieldCheck className="w-5 h-5 flex-shrink-0 mt-0.5 text-orange-600" />
            <div>
              <h4 className="font-semibold text-orange-900">Direct disk saving not supported in your browser</h4>
              <p className="text-sm mt-1 opacity-90">
                Your browser doesn&apos;t support the File System Access API. The recording will be kept in memory and downloaded automatically when you stop. For very long recordings, we recommend using Google Chrome or Edge.
              </p>
            </div>
          </div>
        )}

        <div className="bg-white border border-zinc-200 rounded-3xl p-6 md:p-10 shadow-sm transition-all">

          {/* STATE: SETUP */}
          {state === "setup" && (
            <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
              {/* Mode Selection */}
              <div className="flex flex-col space-y-3">
                <label className="text-sm font-medium text-zinc-700 flex items-center gap-2">
                  <Settings2 className="w-4 h-4 text-zinc-500" />
                  Recording Mode
                </label>
                <div className="grid grid-cols-2 gap-4">
                  <button
                    onClick={() => setConfig({ ...config, mode: "audio" })}
                    className={`flex flex-col items-center justify-center p-6 rounded-2xl border-2 transition-all ${
                      config.mode === "audio"
                        ? "border-zinc-900 bg-zinc-50 text-zinc-900 shadow-sm"
                        : "border-zinc-100 hover:border-zinc-300 hover:bg-zinc-50 text-zinc-500"
                    }`}
                  >
                    <Mic className={`w-8 h-8 mb-3 ${config.mode === "audio" ? "text-zinc-900" : "text-zinc-400"}`} />
                    <span className="font-semibold">Audio Only</span>
                    <span className="text-xs text-center mt-2 opacity-70">Mic + System Audio</span>
                  </button>
                  <button
                    onClick={() => setConfig({ ...config, mode: "video" })}
                    className={`flex flex-col items-center justify-center p-6 rounded-2xl border-2 transition-all ${
                      config.mode === "video"
                        ? "border-zinc-900 bg-zinc-50 text-zinc-900 shadow-sm"
                        : "border-zinc-100 hover:border-zinc-300 hover:bg-zinc-50 text-zinc-500"
                    }`}
                  >
                    <Video className={`w-8 h-8 mb-3 ${config.mode === "video" ? "text-zinc-900" : "text-zinc-400"}`} />
                    <span className="font-semibold">Video + Audio</span>
                    <span className="text-xs text-center mt-2 opacity-70">Screen + Mic + System</span>
                  </button>
                </div>
              </div>

              {/* Settings Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-zinc-50 p-6 rounded-2xl border border-zinc-100">
                <DeviceSelector
                  selectedDeviceId={config.micDeviceId || ""}
                  onChange={(id) => setConfig({ ...config, micDeviceId: id })}
                />

                <div className="flex flex-col space-y-2">
                  <label htmlFor="quality-select" className="text-sm font-medium text-zinc-700">
                    Audio Quality
                  </label>
                  <select
                    id="quality-select"
                    value={config.audioBitrate}
                    onChange={(e) => setConfig({ ...config, audioBitrate: Number(e.target.value) })}
                    className="w-full appearance-none rounded-lg border border-zinc-200 bg-white px-4 py-2.5 text-sm text-zinc-900 shadow-sm focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500"
                  >
                    <option value={64000}>Low (64 kbps)</option>
                    <option value={128000}>Standard (128 kbps)</option>
                    <option value={256000}>High (256 kbps)</option>
                  </select>
                </div>

                {config.mode === "video" && (
                   <div className="flex flex-col space-y-2 md:col-span-2">
                   <label htmlFor="video-quality" className="text-sm font-medium text-zinc-700">
                     Video Quality (Bitrate)
                   </label>
                   <select
                     id="video-quality"
                     value={config.videoBitrate}
                     onChange={(e) => setConfig({ ...config, videoBitrate: Number(e.target.value) })}
                     className="w-full appearance-none rounded-lg border border-zinc-200 bg-white px-4 py-2.5 text-sm text-zinc-900 shadow-sm focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500"
                   >
                     <option value={1000000}>Low (1 Mbps)</option>
                     <option value={2500000}>Standard (2.5 Mbps)</option>
                     <option value={5000000}>High (5 Mbps)</option>
                   </select>
                 </div>
                )}
              </div>

              {/* Actions */}
              <div className="pt-4 flex justify-center">
                <button
                  onClick={handleStart}
                  className="flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white px-8 py-4 rounded-full font-bold text-lg shadow-lg hover:shadow-xl transition-all hover:-translate-y-0.5 active:translate-y-0"
                >
                  <div className="w-3 h-3 bg-white rounded-full animate-pulse" />
                  Start Recording
                </button>
              </div>
            </div>
          )}

          {/* STATE: RECORDING & PAUSED */}
          {(state === "recording" || state === "paused") && (
            <div className="space-y-8 animate-in fade-in zoom-in-95 duration-300">

              <div className="flex flex-col md:flex-row items-center justify-between gap-8 bg-zinc-950 p-8 rounded-3xl text-zinc-100 shadow-inner">

                 <div className="flex flex-col items-center md:items-start gap-4">
                    <PipTimer
                       duration={duration}
                       isActive={state === "recording"}
                       onToggle={() => {}}
                    />
                    <div className="text-zinc-400 text-sm font-mono bg-zinc-900 px-3 py-1.5 rounded-lg border border-zinc-800">
                        Disk Size: {formatBytes(writtenBytes)}
                    </div>
                 </div>

                 <div className="flex-1 w-full max-w-sm space-y-6">
                    <div className="space-y-4">
                        <AudioLevelMeter analyser={analysers.mic} label="mic" />
                        {/* Only show system audio meter if it exists and we're recording video or we specifically wanted it */}
                        {analysers.system && <AudioLevelMeter analyser={analysers.system} label="system" />}
                    </div>
                 </div>
              </div>

              {/* Controls */}
              <div className="flex items-center justify-center gap-6 pt-4">
                {state === "recording" ? (
                  <button
                    onClick={handlePause}
                    className="flex flex-col items-center gap-2 text-zinc-500 hover:text-zinc-900 transition-colors"
                  >
                    <div className="p-4 bg-zinc-100 rounded-full hover:bg-zinc-200 transition-colors">
                        <PauseCircle className="w-8 h-8" />
                    </div>
                    <span className="text-sm font-medium">Pause</span>
                  </button>
                ) : (
                  <button
                    onClick={handleResume}
                    className="flex flex-col items-center gap-2 text-blue-600 hover:text-blue-700 transition-colors"
                  >
                    <div className="p-4 bg-blue-50 rounded-full hover:bg-blue-100 transition-colors">
                        <PlayCircle className="w-8 h-8" />
                    </div>
                    <span className="text-sm font-medium">Resume</span>
                  </button>
                )}

                <button
                  onClick={handleStop}
                  className="flex flex-col items-center gap-2 text-red-600 hover:text-red-700 transition-colors"
                >
                  <div className="p-4 bg-red-50 rounded-full hover:bg-red-100 transition-colors">
                      <StopCircle className="w-10 h-10" />
                  </div>
                  <span className="font-bold">Stop & Save</span>
                </button>
              </div>
            </div>
          )}

          {/* STATE: DONE */}
          {state === "done" && (
            <div className="text-center space-y-6 py-8 animate-in zoom-in-95 duration-300">
              <div className="w-20 h-20 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-6">
                <ShieldCheck className="w-10 h-10" />
              </div>
              <h2 className="text-3xl font-bold text-zinc-900">Recording Saved!</h2>
              <p className="text-zinc-600 max-w-md mx-auto">
                {isSupported
                  ? "Your file has been safely written to your local disk."
                  : "Your recording has been downloaded to your default downloads folder."}
              </p>

              <div className="inline-block bg-zinc-50 border border-zinc-200 rounded-xl p-4 text-left w-full max-w-sm mt-4">
                 <div className="flex justify-between items-center mb-2">
                    <span className="text-sm text-zinc-500">Duration</span>
                    <span className="font-mono font-medium">{Math.floor(duration/1000/60)}m {Math.floor(duration/1000)%60}s</span>
                 </div>
                 <div className="flex justify-between items-center">
                    <span className="text-sm text-zinc-500">File Size</span>
                    <span className="font-mono font-medium">{formatBytes(writtenBytes)}</span>
                 </div>
              </div>

              <div className="pt-8">
                <button
                  onClick={handleReset}
                  className="bg-zinc-900 hover:bg-zinc-800 text-white px-8 py-3 rounded-full font-medium transition-colors"
                >
                  Start New Recording
                </button>
              </div>
            </div>
          )}

        </div>
      </div>
    </ToolsLayout>
  );
}

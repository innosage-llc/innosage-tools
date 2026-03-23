"use client";

import { ToolsLayout } from '@/components/ToolsLayout';
import { useState, useRef, useEffect } from 'react';
import { FileAudio, Mic, Play, Square, Download, AlertCircle, ArrowRight, RefreshCcw, CheckCircle2 } from 'lucide-react';
import { useReactMediaRecorder } from "react-media-recorder";
import type { FFmpeg } from '@ffmpeg/ffmpeg';

export default function MeetingFixerClient() {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [originalFile, setOriginalFile] = useState<File | null>(null);
  const [stitchedUrl, setStitchedUrl] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const ffmpegRef = useRef<FFmpeg | null>(null);
  const [ffmpegLoaded, setFfmpegLoaded] = useState(false);

  const {
    status,
    startRecording,
    stopRecording,
    mediaBlobUrl,
    clearBlobUrl
  } = useReactMediaRecorder({ audio: true, video: false });

  useEffect(() => {
    // Only load FFmpeg on the client side because it requires Worker
    if (typeof window !== 'undefined') {
      loadFfmpeg();
    }
  }, []);

  const loadFfmpeg = async () => {
    try {
      // Dynamically import FFmpeg and utilities to avoid SSR issues with Worker
      const { FFmpeg } = await import('@ffmpeg/ffmpeg');
      const { toBlobURL } = await import('@ffmpeg/util');

      if (!ffmpegRef.current) {
        ffmpegRef.current = new FFmpeg();
      }
      const ffmpeg = ffmpegRef.current;
      if (ffmpeg.loaded) return;

      ffmpeg.on('progress', ({ progress }) => {
        setProgress(Math.round(progress * 100));
      });
      const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd';
      await ffmpeg.load({
        coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
      });
      setFfmpegLoaded(true);
    } catch (err) {
      console.error("Failed to load FFmpeg:", err);
      setError("Failed to load FFmpeg. Your browser might not support it.");
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setOriginalFile(file);
      setStep(2);
      setError(null);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file && (file.type.startsWith('audio/') || file.type.startsWith('video/'))) {
      setOriginalFile(file);
      setStep(2);
      setError(null);
    } else {
      setError("Please drop a valid audio or video file.");
    }
  };

  const processAudio = async () => {
    if (!originalFile || !mediaBlobUrl) return;

    setIsProcessing(true);
    setError(null);
    setProgress(0);
    setStep(3);

    try {
      const { fetchFile } = await import('@ffmpeg/util');
      const ffmpeg = ffmpegRef.current;
      if (!ffmpeg) throw new Error("FFmpeg not loaded");

      // Load files into FFmpeg
      await ffmpeg.writeFile('input1.ext', await fetchFile(originalFile));
      await ffmpeg.writeFile('input2.ext', await fetchFile(mediaBlobUrl));

      // Execute FFmpeg command to combine
      // Using a complex filter to ensure both are converted to a common sample rate/format and concatenated
      // -y to overwrite if output exists
      await ffmpeg.exec([
        '-i', 'input1.ext',
        '-i', 'input2.ext',
        '-filter_complex', '[0:a][1:a]concat=n=2:v=0:a=1[outa]',
        '-map', '[outa]',
        '-c:a', 'aac',
        '-b:a', '128k',
        'output.m4a'
      ]);

      const data = await ffmpeg.readFile('output.m4a');
      const blob = new Blob([new Uint8Array(data as Uint8Array)], { type: 'audio/mp4' });
      const url = URL.createObjectURL(blob);
      setStitchedUrl(url);
      setStep(4);
    } catch (err: unknown) {
      console.error("FFmpeg processing error:", err);
      setError("An error occurred during processing. Please try again.");
      setStep(2);
    } finally {
      setIsProcessing(false);
    }
  };

  const resetAll = () => {
    setStep(1);
    setOriginalFile(null);
    setStitchedUrl(null);
    clearBlobUrl();
    setError(null);
    setProgress(0);
  };

  return (
    <ToolsLayout>
      <div className="max-w-4xl mx-auto py-8 px-4">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-zinc-900 mb-2">Meeting Fixer</h1>
          <p className="text-zinc-600">Append missing context to your meeting recordings right in the browser.</p>
        </div>

        <div className="bg-white border border-zinc-200 rounded-2xl p-6 md:p-8 shadow-sm max-w-2xl mx-auto">
          {error && (
            <div className="mb-6 bg-red-50 border border-red-200 text-red-800 p-4 rounded-xl flex items-start gap-3 text-sm">
              <AlertCircle className="w-5 h-5 shrink-0" />
              <p>{error}</p>
            </div>
          )}

          {step === 1 && (
            <div className="text-center space-y-4">
              <div className="flex items-center justify-between mb-2">
                 <h2 className="text-xl font-semibold">Step 1: Upload Original Recording</h2>
              </div>
              <div
                className="border-2 border-dashed border-zinc-300 rounded-xl p-12 flex flex-col items-center justify-center cursor-pointer hover:bg-zinc-50 transition-colors group"
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleDrop}
              >
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  accept="audio/*,video/*"
                  className="hidden"
                />
                <div className="w-16 h-16 bg-orange-50 rounded-full flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                  <FileAudio className="w-8 h-8 text-orange-600" />
                </div>
                <p className="text-zinc-700 font-medium">Click to upload or drag and drop</p>
                <p className="text-sm text-zinc-500 mt-2">Any audio or video meeting recording (MP4, WebM, MP3, WAV)</p>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-6">
               <div className="flex items-center justify-between">
                 <h2 className="text-xl font-semibold">Step 2: Record Amendment</h2>
                 <button onClick={() => setStep(1)} className="text-sm text-zinc-500 hover:text-zinc-700 flex items-center gap-1">
                    <RefreshCcw size={14} /> Change Original
                 </button>
              </div>

              <div className="bg-zinc-50 border border-zinc-200 rounded-xl p-4 flex items-center gap-4">
                 <div className="w-10 h-10 bg-zinc-200 rounded-lg flex items-center justify-center shrink-0">
                    <FileAudio className="w-5 h-5 text-zinc-500" />
                 </div>
                 <div className="min-w-0 flex-1">
                    <p className="font-medium text-zinc-900 truncate">{originalFile?.name}</p>
                    <p className="text-xs text-zinc-500">Original Recording • {originalFile ? (originalFile.size / (1024 * 1024)).toFixed(2) : 0} MB</p>
                 </div>
                 <CheckCircle2 className="w-5 h-5 text-green-500 shrink-0" />
              </div>

              <div className="p-8 border border-zinc-200 rounded-xl bg-white shadow-sm flex flex-col items-center text-center">

                <div className="relative mb-6">
                  <div className={`w-20 h-20 rounded-full flex items-center justify-center transition-colors ${status === 'recording' ? 'bg-red-100 text-red-600 animate-pulse' : 'bg-orange-50 text-orange-600'}`}>
                    <Mic className="w-10 h-10" />
                  </div>
                  {status === 'recording' && (
                    <span className="absolute top-0 right-0 w-4 h-4 bg-red-500 rounded-full border-2 border-white"></span>
                  )}
                </div>

                <div className="h-8 mb-4">
                  {status === 'recording' ? (
                     <p className="text-red-600 font-medium animate-pulse">Recording missing context...</p>
                  ) : mediaBlobUrl ? (
                     <p className="text-green-600 font-medium flex items-center justify-center gap-2"><CheckCircle2 className="w-4 h-4"/> Amendment recorded</p>
                  ) : (
                     <p className="text-zinc-600">Press start to record what you forgot to say.</p>
                  )}
                </div>

                {mediaBlobUrl && status !== 'recording' && (
                  <div className="mb-6 w-full max-w-sm">
                    <audio src={mediaBlobUrl} controls className="w-full h-10" />
                    <button onClick={clearBlobUrl} className="text-xs text-zinc-500 hover:text-zinc-700 mt-2 underline">
                       Discard and record again
                    </button>
                  </div>
                )}

                <div className="flex gap-4">
                  {status !== 'recording' ? (
                     <button
                       onClick={startRecording}
                       className="flex items-center gap-2 px-6 py-3 bg-zinc-900 hover:bg-zinc-800 text-white rounded-xl font-medium transition-colors"
                     >
                       <Play className="w-5 h-5 fill-current" />
                       {mediaBlobUrl ? 'Record Again' : 'Start Recording'}
                     </button>
                  ) : (
                    <button
                      onClick={stopRecording}
                      className="flex items-center gap-2 px-6 py-3 bg-red-100 hover:bg-red-200 text-red-700 rounded-xl font-medium transition-colors"
                    >
                      <Square className="w-5 h-5 fill-current" />
                      Stop Recording
                    </button>
                  )}
                </div>
              </div>

              <div className="flex justify-end pt-4">
                <button
                  onClick={processAudio}
                  disabled={!mediaBlobUrl || !ffmpegLoaded || isProcessing}
                  className="flex items-center gap-2 px-8 py-3 bg-orange-600 hover:bg-orange-700 disabled:bg-zinc-300 disabled:text-zinc-500 text-white rounded-xl font-bold transition-colors"
                >
                  Merge Files
                  <ArrowRight className="w-5 h-5" />
                </button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="text-center space-y-6 py-8">
              <h2 className="text-2xl font-semibold text-zinc-900">Stitching Audio</h2>
              <div className="relative w-24 h-24 mx-auto">
                <svg className="animate-spin w-full h-full text-zinc-200" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-sm font-bold text-zinc-700">{progress}%</span>
                </div>
              </div>
              <p className="text-zinc-600 max-w-sm mx-auto">
                Merging original recording with your amendment securely in your browser...
              </p>
            </div>
          )}

          {step === 4 && stitchedUrl && (
            <div className="text-center space-y-6 py-8">
              <div className="w-20 h-20 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-6">
                <CheckCircle2 className="w-10 h-10" />
              </div>
              <h2 className="text-2xl font-bold text-zinc-900">Meeting Fixed!</h2>
              <p className="text-zinc-600 max-w-sm mx-auto">
                Your recordings have been successfully merged into a single file.
              </p>

              <div className="p-4 bg-zinc-50 rounded-xl border border-zinc-200 inline-block w-full max-w-sm">
                 <audio src={stitchedUrl} controls className="w-full" />
              </div>

              <div className="pt-6 flex flex-col sm:flex-row items-center justify-center gap-4">
                <a
                  href={stitchedUrl}
                  download={`fixed-meeting-${new Date().getTime()}.m4a`}
                  className="w-full sm:w-auto px-8 py-3 bg-orange-600 hover:bg-orange-700 text-white rounded-xl font-bold flex items-center justify-center gap-2 transition-colors"
                >
                  <Download className="w-5 h-5" />
                  Download Fixed Audio
                </a>
                <button
                  onClick={resetAll}
                  className="w-full sm:w-auto px-6 py-3 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 rounded-xl font-medium transition-colors"
                >
                  Fix Another
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </ToolsLayout>
  );
}

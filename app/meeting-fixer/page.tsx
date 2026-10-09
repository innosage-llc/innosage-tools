"use client";

import { ToolsLayout } from '@/components/ToolsLayout';
import { useState, useRef, useEffect } from 'react';
import { Upload, Mic, Square, Loader2, Download, AlertCircle } from 'lucide-react';
import dynamic from 'next/dynamic';
import type { FFmpeg } from '@ffmpeg/ffmpeg';
import { combinedAudioProgress, displayProgress, isActiveRun, type ProcessingStage } from './progress';

const ReactMediaRecorder = dynamic(
  () => import('react-media-recorder').then((mod) => mod.ReactMediaRecorder),
  { ssr: false },
);

function MeetingFixerClient() {
  const [baseFile, setBaseFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState<number | null>(0);
  const [processingStage, setProcessingStage] = useState<ProcessingStage>('preparing');
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ffmpegInstance, setFfmpegInstance] = useState<FFmpeg | null>(null);
  const [amendmentBlobUrl, setAmendmentBlobUrl] = useState<string | null>(null);
  const activeRunRef = useRef(0);
  const processingRef = useRef(false);
  const totalDurationRef = useRef<number | null>(null);
  const ffmpegRef = useRef<FFmpeg | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const clearBlobUrlRef = useRef<(() => void) | null>(null);

  useEffect(() => () => {
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
  }, [downloadUrl]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    invalidateActiveRun();
    setBaseFile(file);
    setDownloadUrl(null);
    setError(null);
    setProgress(0);
    setProcessingStage('preparing');
  };

  const invalidateActiveRun = () => {
    activeRunRef.current += 1;
    processingRef.current = false;
    totalDurationRef.current = null;
    if (ffmpegRef.current) {
      ffmpegRef.current.terminate();
      ffmpegRef.current = null;
      setFfmpegInstance(null);
    }
    setIsProcessing(false);
    setProgress(0);
    setProcessingStage('preparing');
  };

  const getMediaDuration = (source: Blob | string): Promise<number | null> =>
    new Promise((resolve) => {
      const media = document.createElement('audio');
      const sourceUrl = typeof source === 'string' ? source : URL.createObjectURL(source);
      let settled = false;
      let timeout = 0;
      const finish = (duration: number | null) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        media.removeAttribute('src');
        media.load();
        if (typeof source !== 'string') URL.revokeObjectURL(sourceUrl);
        resolve(duration);
      };
      timeout = window.setTimeout(() => finish(null), 15_000);
      media.preload = 'metadata';
      media.onloadedmetadata = () => finish(Number.isFinite(media.duration) && media.duration > 0 ? media.duration : null);
      media.onerror = () => finish(null);
      media.src = sourceUrl;
    });

  const initFfmpeg = async () => {
    if (ffmpegRef.current) return ffmpegRef.current;
    if (ffmpegInstance) return ffmpegInstance;
    if (typeof window === 'undefined') return null;
    const { FFmpeg } = await import('@ffmpeg/ffmpeg');
    const ffmpeg = new FFmpeg();
    ffmpeg.on('log', ({ message }) => console.log('FFmpeg log:', message));
    try {
      const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd';
      await ffmpeg.load({ coreURL: `${baseURL}/ffmpeg-core.js`, wasmURL: `${baseURL}/ffmpeg-core.wasm` });
      ffmpegRef.current = ffmpeg;
      setFfmpegInstance(ffmpeg);
      return ffmpeg;
    } catch (err) {
      console.error('Failed to load FFmpeg', err);
      throw new Error('Could not load FFmpeg. Please ensure you are on a modern browser.');
    }
  };

  const handleStitch = async () => {
    if (!baseFile || !amendmentBlobUrl || isProcessing) return;
    const runId = activeRunRef.current + 1;
    activeRunRef.current = runId;
    processingRef.current = true;
    setIsProcessing(true);
    setProgress(0);
    setProcessingStage('preparing');
    setError(null);
    setDownloadUrl(null);
    totalDurationRef.current = null;
    const baseExt = baseFile.name.split('.').pop() || 'mp3';
    const baseName = `base-${runId}.${baseExt}`;
    const amendName = `amendment-${runId}.webm`;
    const outputName = `output-${runId}.mp3`;
    let runFfmpeg: FFmpeg | null = null;
    let progressHandler: ((event: { progress: number; time: number }) => void) | null = null;

    try {
      const [baseDuration, amendmentDuration] = await Promise.all([getMediaDuration(baseFile), getMediaDuration(amendmentBlobUrl)]);
      totalDurationRef.current = baseDuration && amendmentDuration ? baseDuration + amendmentDuration : null;
      runFfmpeg = await initFfmpeg();
      if (!runFfmpeg) throw new Error('FFmpeg failed to initialize.');
      progressHandler = (event: { progress: number; time: number }) => {
        if (!isActiveRun(runId, activeRunRef.current, processingRef.current)) return;
        const display = displayProgress('processing', combinedAudioProgress(event, totalDurationRef.current));
        setProcessingStage(display.stage);
        setProgress(display.percent);
      };
      runFfmpeg.on('progress', progressHandler);
      const { fetchFile } = await import('@ffmpeg/util');
      await runFfmpeg.writeFile(baseName, await fetchFile(baseFile));
      await runFfmpeg.writeFile(amendName, await fetchFile(amendmentBlobUrl));
      setProcessingStage('processing');
      setProgress(null);
      const exitCode = await runFfmpeg.exec(['-i', baseName, '-i', amendName, '-filter_complex', '[0:a][1:a]concat=n=2:v=0:a=1[out]', '-map', '[out]', outputName]);
      if (exitCode !== 0) throw new Error(`FFmpeg could not stitch the recordings (exit code ${exitCode}).`);
      if (activeRunRef.current !== runId) return;
      setProcessingStage('finalizing');
      setProgress(99);
      const fileData = await runFfmpeg.readFile(outputName);
      if (typeof fileData === 'string' || fileData.byteLength === 0) throw new Error('FFmpeg produced an empty or unreadable output file.');
      const url = URL.createObjectURL(new Blob([(fileData as Uint8Array).slice()], { type: 'audio/mp3' }));
      if (activeRunRef.current !== runId) {
        URL.revokeObjectURL(url);
        return;
      }
      setDownloadUrl(url);
      setProcessingStage('ready');
      setProgress(100);
    } catch (err) {
      if (activeRunRef.current !== runId) return;
      console.error(err);
      setProcessingStage('error');
      setProgress(null);
      setError(err instanceof Error ? err.message : 'An error occurred during processing.');
    } finally {
      if (runFfmpeg) {
        if (progressHandler) runFfmpeg.off('progress', progressHandler);
        await Promise.allSettled([runFfmpeg.deleteFile(baseName), runFfmpeg.deleteFile(amendName), runFfmpeg.deleteFile(outputName)]);
      }
      if (activeRunRef.current === runId) {
        processingRef.current = false;
        setIsProcessing(false);
      }
    }
  };

  const handleClear = () => {
    invalidateActiveRun();
    setBaseFile(null);
    setDownloadUrl(null);
    setError(null);
    clearBlobUrlRef.current?.();
    setAmendmentBlobUrl(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const progressLabel = processingStage === 'preparing' ? 'Preparing recordings...' : processingStage === 'processing' ? progress === null ? 'Processing...' : `Processing... ${progress}%` : 'Finalizing output... 99%';

  return (
    <ToolsLayout>
      <div className="py-12 md:py-20 max-w-3xl mx-auto px-4">
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-zinc-900 mb-6 text-center">Meeting Fixer</h1>
        <p className="text-lg text-zinc-600 mb-8 text-center">Upload an incomplete meeting recording, record an amendment, and stitch them together instantly in your browser.</p>
        <div className="bg-white border border-zinc-200 rounded-2xl p-6 shadow-sm space-y-8">
          <div className="space-y-4">
            <h2 className="text-xl font-bold text-zinc-900 flex items-center"><span className="bg-orange-100 text-orange-600 w-8 h-8 rounded-full flex items-center justify-center mr-3 text-sm">1</span>Upload Base Recording</h2>
            <div className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors ${baseFile ? 'border-orange-200 bg-orange-50' : 'border-zinc-300 hover:border-orange-300'}`}>
              <input type="file" accept="audio/*,video/*" onChange={handleFileChange} className="hidden" id="file-upload" ref={fileInputRef} />
              <label htmlFor="file-upload" className="cursor-pointer flex flex-col items-center">{baseFile ? <><Upload className="text-orange-500 mb-3" size={32} /><span className="font-medium text-zinc-900">{baseFile.name}</span><span className="text-sm text-zinc-500 mt-1">{(baseFile.size / (1024 * 1024)).toFixed(2)} MB</span></> : <><Upload className="text-zinc-400 mb-3" size={32} /><span className="font-medium text-zinc-900">Click to upload recording</span><span className="text-sm text-zinc-500 mt-1">Audio or Video files supported</span></>}</label>
            </div>
          </div>
          <div className="space-y-4">
            <h2 className="text-xl font-bold text-zinc-900 flex items-center"><span className="bg-orange-100 text-orange-600 w-8 h-8 rounded-full flex items-center justify-center mr-3 text-sm">2</span>Record Amendment</h2>
            <ReactMediaRecorder audio video={false} render={({ status, startRecording, stopRecording, mediaBlobUrl, clearBlobUrl }) => {
              if (mediaBlobUrl && mediaBlobUrl !== amendmentBlobUrl) setAmendmentBlobUrl(mediaBlobUrl);
              clearBlobUrlRef.current = clearBlobUrl;
              return <div className="bg-zinc-50 rounded-xl p-6 border border-zinc-200 flex flex-col items-center justify-center space-y-4">{status === 'recording' ? <div className="flex items-center space-x-2 text-red-500 animate-pulse font-medium"><div className="w-3 h-3 bg-red-500 rounded-full" /><span>Recording...</span></div> : <div className="text-zinc-500 font-medium">{mediaBlobUrl ? 'Amendment recorded ready.' : 'Ready to record.'}</div>}<div className="flex space-x-4">{status !== 'recording' ? <button onClick={() => { if (mediaBlobUrl) invalidateActiveRun(); startRecording(); }} className="flex items-center px-4 py-2 bg-zinc-900 text-white rounded-lg hover:bg-zinc-800 transition-colors"><Mic size={18} className="mr-2" />{mediaBlobUrl ? 'Re-record' : 'Start Recording'}</button> : <button onClick={stopRecording} className="flex items-center px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"><Square size={18} className="mr-2" />Stop Recording</button>}</div>{mediaBlobUrl && <div className="w-full max-w-md mt-4"><audio src={mediaBlobUrl} controls className="w-full" /></div>}</div>;
            }} />
          </div>
          <div className="space-y-4 pt-4 border-t border-zinc-200">
            {error && <div className="p-4 bg-red-50 text-red-700 rounded-lg flex items-start"><AlertCircle size={20} className="mr-2 flex-shrink-0 mt-0.5" /><p className="text-sm">{error}</p></div>}
            {!downloadUrl ? <button onClick={handleStitch} disabled={!baseFile || !amendmentBlobUrl || isProcessing} className={`w-full py-4 rounded-xl font-bold text-lg flex items-center justify-center transition-colors ${!baseFile || !amendmentBlobUrl ? 'bg-zinc-100 text-zinc-400 cursor-not-allowed' : isProcessing ? 'bg-orange-100 text-orange-600 cursor-wait' : 'bg-orange-600 text-white hover:bg-orange-700'}`}>{isProcessing ? <><Loader2 className="animate-spin mr-2" size={24} />{progressLabel}</> : 'Stitch Recordings'}</button> : <div className="space-y-4"><div className="p-4 bg-green-50 text-green-700 rounded-lg text-center font-medium">Successfully stitched recordings!</div><div className="flex space-x-4"><a href={downloadUrl} download="fixed_meeting.mp3" className="flex-1 py-3 bg-zinc-900 text-white rounded-xl font-bold flex items-center justify-center hover:bg-zinc-800 transition-colors"><Download size={20} className="mr-2" />Download Result</a><button onClick={handleClear} className="py-3 px-6 bg-zinc-100 text-zinc-700 rounded-xl font-bold hover:bg-zinc-200 transition-colors">Start Over</button></div></div>}
          </div>
        </div>
      </div>
    </ToolsLayout>
  );
}

export default dynamic(() => Promise.resolve(MeetingFixerClient), { ssr: false });

"use client";

import { ToolsLayout } from '@/components/ToolsLayout';
import { useState, useRef } from 'react';
import { Upload, Mic, Square, Loader2, Download, AlertCircle } from 'lucide-react';
import dynamic from 'next/dynamic';
import type { FFmpeg } from '@ffmpeg/ffmpeg';

const ReactMediaRecorder = dynamic(
  () => import('react-media-recorder').then((mod) => mod.ReactMediaRecorder),
  { ssr: false }
);

function MeetingFixerClient() {
  const [baseFile, setBaseFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState<number>(0);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ffmpegInstance, setFfmpegInstance] = useState<FFmpeg | null>(null);
  const [amendmentBlobUrl, setAmendmentBlobUrl] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const clearBlobUrlRef = useRef<(() => void) | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setBaseFile(e.target.files[0]);
      setDownloadUrl(null);
      setError(null);
    }
  };

  const initFfmpeg = async () => {
    if (ffmpegInstance) return ffmpegInstance;

    // Check if we are in a browser environment before importing FFmpeg
    if (typeof window === 'undefined') return null;

    // Dynamic import to avoid SSR issues with Worker
    const { FFmpeg } = await import('@ffmpeg/ffmpeg');
    const ffmpeg = new FFmpeg();
    ffmpeg.on('progress', ({ progress }) => {
      setProgress(progress);
    });

    ffmpeg.on('log', ({ message }) => {
      console.log('FFmpeg log:', message);
    });

    try {
      // Use CDN assets to bypass Cloudflare Pages 25MB limit
      const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd';
      await ffmpeg.load({
        coreURL: `${baseURL}/ffmpeg-core.js`,
        wasmURL: `${baseURL}/ffmpeg-core.wasm`,
      });
      setFfmpegInstance(ffmpeg);
      return ffmpeg;
    } catch (err) {
      console.error("Failed to load FFmpeg", err);
      throw new Error("Could not load FFmpeg. Please ensure you are on a modern browser.");
    }
  };

  const handleStitch = async () => {
    if (!baseFile || !amendmentBlobUrl) return;

    setIsProcessing(true);
    setProgress(0);
    setError(null);

    try {
      const ffmpeg = await initFfmpeg();
      if (!ffmpeg) {
        throw new Error('FFmpeg failed to initialize.');
      }

      const { fetchFile } = await import('@ffmpeg/util');

      // Write files to virtual FS
      const baseFileData = await fetchFile(baseFile);
      const amendmentFileData = await fetchFile(amendmentBlobUrl);

      const baseExt = baseFile.name.split('.').pop() || 'mp3';
      const baseName = `base.${baseExt}`;
      const amendName = `amendment.webm`; // react-media-recorder usually outputs webm or mp4

      await ffmpeg.writeFile(baseName, baseFileData);
      await ffmpeg.writeFile(amendName, amendmentFileData);

      // Concatenate files using filter_complex
      const outputName = 'output.mp3';
      await ffmpeg.exec([
        '-i', baseName,
        '-i', amendName,
        '-filter_complex', '[0:a][1:a]concat=n=2:v=0:a=1[out]',
        '-map', '[out]',
        outputName
      ]);

      const fileData = await ffmpeg.readFile(outputName);
      
      if (typeof fileData === 'string') {
        throw new Error('FFmpeg failed to generate the output file.');
      }

      // The output from FFmpeg is a Uint8Array, which may be backed by a SharedArrayBuffer.
      // We convert it to a standard ArrayBuffer using slice() to safely create a Blob.
      const data = fileData as Uint8Array;
      const buffer = new Uint8Array(data);
      const blob = new Blob([buffer.buffer], { type: 'audio/mp3' });
      const url = URL.createObjectURL(blob);

      setDownloadUrl(url);

    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'An error occurred during processing.');
    } finally {
      setIsProcessing(false);
    }
  };


  const handleClear = () => {
    setBaseFile(null);
    setDownloadUrl(null);
    setError(null);
    
    if (clearBlobUrlRef.current) {
      clearBlobUrlRef.current();
    }
    
    setAmendmentBlobUrl(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <ToolsLayout>
      <div className="py-12 md:py-20 max-w-3xl mx-auto px-4">
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-zinc-900 mb-6 text-center">
          Meeting Fixer
        </h1>
        <p className="text-lg text-zinc-600 mb-8 text-center">
          Upload an incomplete meeting recording, record an amendment, and stitch them together instantly in your browser.
        </p>

        <div className="bg-white border border-zinc-200 rounded-2xl p-6 shadow-sm space-y-8">

          {/* Step 1: Upload Base Recording */}
          <div className="space-y-4">
            <h2 className="text-xl font-bold text-zinc-900 flex items-center">
              <span className="bg-orange-100 text-orange-600 w-8 h-8 rounded-full flex items-center justify-center mr-3 text-sm">1</span>
              Upload Base Recording
            </h2>

            <div className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors ${baseFile ? 'border-orange-200 bg-orange-50' : 'border-zinc-300 hover:border-orange-300'}`}>
              <input
                type="file"
                accept="audio/*,video/*"
                onChange={handleFileChange}
                className="hidden"
                id="file-upload"
                ref={fileInputRef}
              />
              <label htmlFor="file-upload" className="cursor-pointer flex flex-col items-center">
                {baseFile ? (
                  <>
                    <Upload className="text-orange-500 mb-3" size={32} />
                    <span className="font-medium text-zinc-900">{baseFile.name}</span>
                    <span className="text-sm text-zinc-500 mt-1">
                      {(baseFile.size / (1024 * 1024)).toFixed(2)} MB
                    </span>
                  </>
                ) : (
                  <>
                    <Upload className="text-zinc-400 mb-3" size={32} />
                    <span className="font-medium text-zinc-900">Click to upload recording</span>
                    <span className="text-sm text-zinc-500 mt-1">Audio or Video files supported</span>
                  </>
                )}
              </label>
            </div>
          </div>

          {/* Step 2: Record Amendment */}
          <div className="space-y-4">
            <h2 className="text-xl font-bold text-zinc-900 flex items-center">
              <span className="bg-orange-100 text-orange-600 w-8 h-8 rounded-full flex items-center justify-center mr-3 text-sm">2</span>
              Record Amendment
            </h2>

            <ReactMediaRecorder
              audio
              video={false}
              render={({ status, startRecording, stopRecording, mediaBlobUrl, clearBlobUrl }) => {
                // Keep the global amendmentBlobUrl in sync for stitching
                if (mediaBlobUrl && mediaBlobUrl !== amendmentBlobUrl) {
                  setAmendmentBlobUrl(mediaBlobUrl);
                }

                // Capture clearBlobUrl in ref
                clearBlobUrlRef.current = clearBlobUrl;

                return (
                  <div className="bg-zinc-50 rounded-xl p-6 border border-zinc-200 flex flex-col items-center justify-center space-y-4">
                    {status === 'recording' ? (
                      <div className="flex items-center space-x-2 text-red-500 animate-pulse font-medium">
                        <div className="w-3 h-3 bg-red-500 rounded-full"></div>
                        <span>Recording...</span>
                      </div>
                    ) : (
                      <div className="text-zinc-500 font-medium">
                        {mediaBlobUrl ? 'Amendment recorded ready.' : 'Ready to record.'}
                      </div>
                    )}

                    <div className="flex space-x-4">
                      {status !== 'recording' ? (
                        <button
                          onClick={startRecording}
                          className="flex items-center px-4 py-2 bg-zinc-900 text-white rounded-lg hover:bg-zinc-800 transition-colors"
                        >
                          <Mic size={18} className="mr-2" />
                          {mediaBlobUrl ? 'Re-record' : 'Start Recording'}
                        </button>
                      ) : (
                        <button
                          onClick={stopRecording}
                          className="flex items-center px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
                        >
                          <Square size={18} className="mr-2" />
                          Stop Recording
                        </button>
                      )}
                    </div>

                    {mediaBlobUrl && (
                      <div className="w-full max-w-md mt-4">
                        <audio src={mediaBlobUrl} controls className="w-full" />
                      </div>
                    )}
                  </div>
                );
              }}
            />
          </div>

          {/* Step 3: Stitch */}
          <div className="space-y-4 pt-4 border-t border-zinc-200">
            {error && (
              <div className="p-4 bg-red-50 text-red-700 rounded-lg flex items-start">
                <AlertCircle size={20} className="mr-2 flex-shrink-0 mt-0.5" />
                <p className="text-sm">{error}</p>
              </div>
            )}

            {!downloadUrl ? (
              <button
                onClick={handleStitch}
                disabled={!baseFile || !amendmentBlobUrl || isProcessing}
                className={`w-full py-4 rounded-xl font-bold text-lg flex items-center justify-center transition-colors ${
                  !baseFile || !amendmentBlobUrl
                    ? 'bg-zinc-100 text-zinc-400 cursor-not-allowed'
                    : isProcessing
                    ? 'bg-orange-100 text-orange-600 cursor-wait'
                    : 'bg-orange-600 text-white hover:bg-orange-700'
                }`}
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="animate-spin mr-2" size={24} />
                    Processing... {Math.round(progress * 100)}%
                  </>
                ) : (
                  'Stitch Recordings'
                )}
              </button>
            ) : (
              <div className="space-y-4">
                <div className="p-4 bg-green-50 text-green-700 rounded-lg text-center font-medium">
                  Successfully stitched recordings!
                </div>
                <div className="flex space-x-4">
                  <a
                    href={downloadUrl}
                    download="fixed_meeting.mp3"
                    className="flex-1 py-3 bg-zinc-900 text-white rounded-xl font-bold flex items-center justify-center hover:bg-zinc-800 transition-colors"
                  >
                    <Download size={20} className="mr-2" />
                    Download Result
                  </a>
                  <button
                    onClick={handleClear}
                    className="py-3 px-6 bg-zinc-100 text-zinc-700 rounded-xl font-bold hover:bg-zinc-200 transition-colors"
                  >
                    Start Over
                  </button>
                </div>
              </div>
            )}
          </div>

        </div>
      </div>
    </ToolsLayout>
  );
}

export default dynamic(() => Promise.resolve(MeetingFixerClient), { ssr: false });

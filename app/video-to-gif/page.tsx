"use client";

import { ToolsLayout } from '@/components/ToolsLayout';
import { useState, useRef } from 'react';
import { Upload, Video, Loader2, Download, AlertCircle } from 'lucide-react';
import dynamic from 'next/dynamic';
import type { FFmpeg } from '@ffmpeg/ffmpeg';

function VideoToGifClient() {
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [preset, setPreset] = useState<'high' | 'medium' | 'small'>('medium');
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState<number>(0);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ffmpegInstance, setFfmpegInstance] = useState<FFmpeg | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const initFfmpeg = async () => {
    if (ffmpegInstance) return ffmpegInstance;
    if (typeof window === 'undefined') return null;

    const { FFmpeg } = await import('@ffmpeg/ffmpeg');
    const ffmpeg = new FFmpeg();

    ffmpeg.on('progress', ({ progress }) => {
      setProgress(progress);
    });

    try {
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

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setVideoFile(e.target.files[0]);
      setDownloadUrl(null);
      setError(null);
    }
  };

  const handleConvert = async () => {
    if (!videoFile) return;

    setIsProcessing(true);
    setProgress(0);
    setError(null);

    try {
      const ffmpeg = await initFfmpeg();
      if (!ffmpeg) {
        throw new Error('FFmpeg failed to initialize.');
      }

      const { fetchFile } = await import('@ffmpeg/util');
      const inputName = 'input_video';
      const outputName = 'output.gif';

      await ffmpeg.writeFile(inputName, await fetchFile(videoFile));

      let filterParams = '';
      if (preset === 'high') {
        filterParams = 'fps=15,scale=640:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse';
      } else if (preset === 'medium') {
        filterParams = 'fps=10,scale=480:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse';
      } else { // small
        filterParams = 'fps=10,scale=320:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse';
      }

      await ffmpeg.exec([
        '-y',
        '-i', inputName,
        '-filter_complex', filterParams,
        outputName
      ]);

      const fileData = await ffmpeg.readFile(outputName);

      if (typeof fileData === 'string') {
        throw new Error('FFmpeg failed to generate the output file.');
      }

      const blob = new Blob([fileData as BlobPart], { type: 'image/gif' });
      const url = URL.createObjectURL(blob);
      setDownloadUrl(url);

    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'An error occurred during conversion.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleClear = async () => {
    setVideoFile(null);
    setDownloadUrl(null);
    setError(null);
    setProgress(0);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }

    // Clean up MEMFS to prevent memory leaks
    if (ffmpegInstance) {
        try {
            await ffmpegInstance.deleteFile('input_video');
            await ffmpegInstance.deleteFile('output.gif');
        } catch {
            // Ignore if files don't exist
        }
    }
  };

  return (
    <ToolsLayout>
      <div className="py-12 md:py-20 max-w-3xl mx-auto px-4">
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-zinc-900 mb-6 text-center">
          Video to GIF Converter
        </h1>
        <p className="text-lg text-zinc-600 mb-8 text-center">
          Convert videos to GIFs instantly in your browser. No server uploads, zero privacy risks.
        </p>

        <div className="bg-white border border-zinc-200 rounded-2xl p-6 shadow-sm space-y-8">

          {/* Step 1: Upload Video */}
          <div className="space-y-4">
            <h2 className="text-xl font-bold text-zinc-900 flex items-center">
              <span className="bg-orange-100 text-orange-600 w-8 h-8 rounded-full flex items-center justify-center mr-3 text-sm">1</span>
              Upload Video
            </h2>

            <div className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors ${videoFile ? 'border-orange-200 bg-orange-50' : 'border-zinc-300 hover:border-orange-300'}`}>
              <input
                type="file"
                accept="video/*"
                onChange={handleFileChange}
                className="hidden"
                id="file-upload"
                ref={fileInputRef}
              />
              <label htmlFor="file-upload" className="cursor-pointer flex flex-col items-center">
                {videoFile ? (
                  <>
                    <Video className="text-orange-500 mb-3" size={32} />
                    <span className="font-medium text-zinc-900">{videoFile.name}</span>
                    <span className="text-sm text-zinc-500 mt-1">
                      {(videoFile.size / (1024 * 1024)).toFixed(2)} MB
                    </span>
                  </>
                ) : (
                  <>
                    <Upload className="text-zinc-400 mb-3" size={32} />
                    <span className="font-medium text-zinc-900">Click to upload video</span>
                    <span className="text-sm text-zinc-500 mt-1">MP4, WebM, MOV supported</span>
                  </>
                )}
              </label>
            </div>
          </div>

          {/* Step 2: Select Quality */}
          <div className="space-y-4">
            <h2 className="text-xl font-bold text-zinc-900 flex items-center">
              <span className="bg-orange-100 text-orange-600 w-8 h-8 rounded-full flex items-center justify-center mr-3 text-sm">2</span>
              Select Quality
            </h2>

            <div className="bg-zinc-50 rounded-xl p-6 border border-zinc-200 flex flex-col space-y-4">
              <label className="text-sm font-medium text-zinc-700">Quality Preset</label>
              <select
                value={preset}
                onChange={(e) => setPreset(e.target.value as 'high' | 'medium' | 'small')}
                className="w-full bg-white border border-zinc-300 rounded-lg px-4 py-2 text-zinc-900 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
              >
                <option value="high">High Quality (Larger file size)</option>
                <option value="medium">Medium Quality (Balanced)</option>
                <option value="small">Small File Size (Best for Discord/Slack)</option>
              </select>
            </div>
          </div>

          {/* Step 3: Convert */}
          <div className="space-y-4 pt-4 border-t border-zinc-200">
            {error && (
              <div className="p-4 bg-red-50 text-red-700 rounded-lg flex items-start">
                <AlertCircle size={20} className="mr-2 flex-shrink-0 mt-0.5" />
                <p className="text-sm">{error}</p>
              </div>
            )}

            {!downloadUrl ? (
              <button
                onClick={handleConvert}
                disabled={!videoFile || isProcessing}
                className={`w-full py-4 rounded-xl font-bold text-lg flex items-center justify-center transition-colors ${
                  !videoFile
                    ? 'bg-zinc-100 text-zinc-400 cursor-not-allowed'
                    : isProcessing
                    ? 'bg-orange-100 text-orange-600 cursor-wait'
                    : 'bg-orange-600 text-white hover:bg-orange-700'
                }`}
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="animate-spin mr-2" size={24} />
                    Converting... {Math.round(progress * 100)}%
                  </>
                ) : (
                  'Convert to GIF'
                )}
              </button>
            ) : (
              <div className="space-y-4">
                <div className="p-4 bg-green-50 text-green-700 rounded-lg text-center font-medium">
                  Successfully generated GIF!
                </div>
                {downloadUrl && (
                    <div className="flex justify-center mb-4">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={downloadUrl} alt="Generated GIF" className="max-w-full h-auto rounded-lg border border-zinc-200" />
                    </div>
                )}
                <div className="flex space-x-4">
                  <a
                    href={downloadUrl}
                    download="converted.gif"
                    className="flex-1 py-3 bg-zinc-900 text-white rounded-xl font-bold flex items-center justify-center hover:bg-zinc-800 transition-colors"
                  >
                    <Download size={20} className="mr-2" />
                    Download GIF
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

export default dynamic(() => Promise.resolve(VideoToGifClient), { ssr: false });

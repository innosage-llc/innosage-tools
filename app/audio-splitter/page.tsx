"use client";

import { ToolsLayout } from '@/components/ToolsLayout';
import { useState, useRef, useEffect } from 'react';
import { Upload, Scissors, Loader2, Download, AlertCircle, Music } from 'lucide-react';
import dynamic from 'next/dynamic';
import type { FFmpeg } from '@ffmpeg/ffmpeg';

interface ChunkInfo {
  name: string;
  url: string;
  size: number;
}

function AudioSplitterClient() {
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [chunkSize, setChunkSize] = useState<number>(25); // MB
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState<number>(0);
  const [chunks, setChunks] = useState<ChunkInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ffmpegInstance, setFfmpegInstance] = useState<FFmpeg | null>(null);

  useEffect(() => {
    return () => {
      chunks.forEach(chunk => URL.revokeObjectURL(chunk.url));
    };
  }, [chunks]);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setAudioFile(e.target.files[0]);
      setChunks([]);
      setError(null);
      setProgress(0);
    }
  };

  const handleClear = () => {
    setAudioFile(null);
    setChunks([]);
    setError(null);
    setProgress(0);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const initFfmpeg = async () => {
    if (ffmpegInstance) return ffmpegInstance;

    if (typeof window === 'undefined') return null;

    const { FFmpeg } = await import('@ffmpeg/ffmpeg');
    const ffmpeg = new FFmpeg();
    ffmpeg.on('progress', ({ progress }) => {
      setProgress(progress);
    });

    ffmpeg.on('log', ({ message }) => {
      console.log('FFmpeg log:', message);
    });

    try {
      const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd';
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

  const getAudioDuration = (file: File): Promise<number> => {
    return new Promise((resolve, reject) => {
      const audio = new Audio();
      audio.src = URL.createObjectURL(file);
      audio.onloadedmetadata = () => {
        URL.revokeObjectURL(audio.src);
        resolve(audio.duration);
      };
      audio.onerror = () => {
        URL.revokeObjectURL(audio.src);
        reject(new Error("Failed to load audio metadata."));
      };
    });
  };

  const handleSplit = async () => {
    if (!audioFile) return;

    setIsProcessing(true);
    setProgress(0);
    setError(null);
    setChunks([]);

    try {
      const duration = await getAudioDuration(audioFile);
      if (!Number.isFinite(duration) || duration <= 0) {
        throw new Error("Invalid audio duration detected. Cannot split this file.");
      }

      const targetSizeBytes = chunkSize * 1024 * 1024;
      const bytesPerSecond = audioFile.size / duration;
      const segmentSeconds = targetSizeBytes / bytesPerSecond;

      if (!Number.isFinite(segmentSeconds) || segmentSeconds <= 0) {
        throw new Error("Invalid split calculation. Please check the target chunk size.");
      }

      const ffmpeg = await initFfmpeg();
      if (!ffmpeg) throw new Error('FFmpeg failed to initialize.');

      const { fetchFile } = await import('@ffmpeg/util');
      const fileData = await fetchFile(audioFile);
      const ext = audioFile.name.split('.').pop() || 'mp3';
      const inputName = `input.${ext}`;

      await ffmpeg.writeFile(inputName, fileData);

      // Using segment muxer with stream copy
      // %03d produces chunk-000, chunk-001, etc.
      await ffmpeg.exec([
        '-i', inputName,
        '-f', 'segment',
        '-segment_time', segmentSeconds.toString(),
        '-c', 'copy',
        `chunk-%03d.${ext}`
      ]);

      const files = await ffmpeg.listDir('.');
      const chunkFiles = files
        .filter(f => f.name.startsWith('chunk-') && !f.isDir)
        .sort((a, b) => a.name.localeCompare(b.name));

      if (chunkFiles.length === 0) {
        throw new Error("No chunks were generated. The file might be too small or incompatible.");
      }

      const newChunks: ChunkInfo[] = [];

      for (const fileInfo of chunkFiles) {
        const data = await ffmpeg.readFile(fileInfo.name);
        if (data instanceof Uint8Array) {
          // The output from FFmpeg is a Uint8Array, which may be backed by a SharedArrayBuffer.
          // We convert it to a standard ArrayBuffer using slice() to safely create a Blob.
          const blob = new Blob([data.slice()], { type: audioFile.type || 'audio/mpeg' });
          const url = URL.createObjectURL(blob);
          newChunks.push({
            name: `${audioFile.name.replace(/\.[^/.]+$/, "")}-part${fileInfo.name.match(/\d+/)?.[0] || 'x'}.${ext}`,
            url,
            size: data.length
          });
        }
        // Cleanup file from FFmpeg FS
        await ffmpeg.deleteFile(fileInfo.name);
      }

      // Cleanup input file
      await ffmpeg.deleteFile(inputName);

      setChunks(newChunks);

    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'An error occurred during splitting.');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <ToolsLayout>
      <div className="py-12 md:py-20 max-w-3xl mx-auto px-4">
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-zinc-900 mb-6 text-center">
          Audio Splitter
        </h1>
        <p className="text-lg text-zinc-600 mb-8 text-center">
          Split large audio files into smaller chunks based on your target size. 100% private, runs entirely in your browser.
        </p>

        <div className="bg-white border border-zinc-200 rounded-2xl p-6 shadow-sm space-y-8">
          {/* Step 1: Upload Audio */}
          <div className="space-y-4">
            <h2 className="text-xl font-bold text-zinc-900 flex items-center">
              <span className="bg-orange-100 text-orange-600 w-8 h-8 rounded-full flex items-center justify-center mr-3 text-sm">1</span>
              Select Audio File
            </h2>

            <div className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors ${audioFile ? 'border-orange-200 bg-orange-50' : 'border-zinc-300 hover:border-orange-300'}`}>
              <input
                type="file"
                accept="audio/*"
                onChange={handleFileChange}
                className="hidden"
                id="file-upload"
                ref={fileInputRef}
              />
              <label htmlFor="file-upload" className="cursor-pointer flex flex-col items-center">
                {audioFile ? (
                  <>
                    <Music className="text-orange-500 mb-3" size={32} />
                    <span className="font-medium text-zinc-900">{audioFile.name}</span>
                    <span className="text-sm text-zinc-500 mt-1">
                      {(audioFile.size / (1024 * 1024)).toFixed(2)} MB
                    </span>
                  </>
                ) : (
                  <>
                    <Upload className="text-zinc-400 mb-3" size={32} />
                    <span className="font-medium text-zinc-900">Click to upload audio</span>
                    <span className="text-sm text-zinc-500 mt-1">MP3, M4A, WAV, and more</span>
                  </>
                )}
              </label>
            </div>
          </div>

          {/* Step 2: Target Chunk Size */}
          <div className="space-y-4">
            <h2 className="text-xl font-bold text-zinc-900 flex items-center">
              <span className="bg-orange-100 text-orange-600 w-8 h-8 rounded-full flex items-center justify-center mr-3 text-sm">2</span>
              Target Chunk Size (MB)
            </h2>
            <div className="flex items-center space-x-4">
              <input
                type="number"
                value={chunkSize}
                onChange={(e) => setChunkSize(Math.max(1, parseInt(e.target.value) || 0))}
                className="block w-full px-4 py-3 rounded-xl border border-zinc-200 focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-none transition-all"
                min="1"
              />
              <span className="text-zinc-500 font-medium">MB</span>
            </div>
            <p className="text-sm text-zinc-500">
              Files will be split into chunks of approximately this size.
            </p>
          </div>

          {/* Step 3: Process */}
          <div className="space-y-4 pt-4 border-t border-zinc-200">
            {error && (
              <div className="p-4 bg-red-50 text-red-700 rounded-lg flex items-start">
                <AlertCircle size={20} className="mr-2 flex-shrink-0 mt-0.5" />
                <p className="text-sm">{error}</p>
              </div>
            )}

            {chunks.length === 0 ? (
              <button
                onClick={handleSplit}
                disabled={!audioFile || isProcessing}
                className={`w-full py-4 rounded-xl font-bold text-lg flex items-center justify-center transition-colors ${
                  !audioFile
                    ? 'bg-zinc-100 text-zinc-400 cursor-not-allowed'
                    : isProcessing
                    ? 'bg-orange-100 text-orange-600 cursor-wait'
                    : 'bg-orange-600 text-white hover:bg-orange-700'
                }`}
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="animate-spin mr-2" size={24} />
                    Splitting... {Math.round(progress * 100)}%
                  </>
                ) : (
                  <>
                    <Scissors className="mr-2" size={20} />
                    Split Audio
                  </>
                )}
              </button>
            ) : (
              <div className="space-y-4">
                <div className="p-4 bg-green-50 text-green-700 rounded-lg text-center font-medium flex items-center justify-center">
                  Successfully split into {chunks.length} chunks!
                </div>

                <div className="grid grid-cols-1 gap-3">
                  {chunks.map((chunk, index) => (
                    <div key={index} className="flex items-center justify-between p-4 bg-zinc-50 border border-zinc-200 rounded-xl">
                      <div className="flex flex-col">
                        <span className="font-medium text-zinc-900">{chunk.name}</span>
                        <span className="text-sm text-zinc-500">{(chunk.size / (1024 * 1024)).toFixed(2)} MB</span>
                      </div>
                      <a
                        href={chunk.url}
                        download={chunk.name}
                        className="p-2 bg-white border border-zinc-200 rounded-lg text-zinc-700 hover:bg-orange-50 hover:border-orange-200 hover:text-orange-600 transition-colors"
                        title="Download chunk"
                      >
                        <Download size={20} />
                      </a>
                    </div>
                  ))}
                </div>

                <button
                  onClick={handleClear}
                  className="w-full py-3 bg-zinc-100 text-zinc-700 rounded-xl font-bold hover:bg-zinc-200 transition-colors"
                >
                  Start Over
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </ToolsLayout>
  );
}

export default dynamic(() => Promise.resolve(AudioSplitterClient), { ssr: false });

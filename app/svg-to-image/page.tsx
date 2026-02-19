"use client";

import React, { useState, useRef } from 'react';
import { 
  Upload, 
  Download, 
  Trash2, 
  Maximize2, 
  Loader2,
  AlertCircle
} from 'lucide-react';
import { ToolsLayout } from '@/components/ToolsLayout';

type Resolution = 1 | 2 | 4;
type ImageFormat = 'image/png' | 'image/jpeg';

export default function SVGToImagePage() {
  const [svgContent, setSvgContent] = useState<string | null>(null);
  const [resolution, setResolution] = useState<Resolution>(1);
  const [format, setFormat] = useState<ImageFormat>('image/png');
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      processFile(file);
    }
  };

  const processFile = (file: File) => {
    if (!file.name.toLowerCase().endsWith('.svg') && file.type !== 'image/svg+xml') {
      setError('Please upload a valid SVG file.');
      return;
    }
    setError(null);

    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      setSvgContent(content);
    };
    reader.onerror = () => {
      setError('Failed to read the SVG file.');
    };
    reader.readAsText(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const file = e.dataTransfer.files?.[0];
    if (file) {
      processFile(file);
    }
  };

  const clearSvg = () => {
    setSvgContent(null);
    setError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const downloadImage = async () => {
    if (!svgContent) return;
    setIsExporting(true);
    
    try {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Could not get canvas context');

      const img = new Image();
      const svgBlob = new Blob([svgContent], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(svgBlob);

      img.onload = () => {
        const width = img.width || 500;
        const height = img.height || 500;
        
        canvas.width = width * resolution;
        canvas.height = height * resolution;
        
        // Fill white background for JPEG
        if (format === 'image/jpeg') {
          ctx.fillStyle = 'white';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
        
        ctx.scale(resolution, resolution);
        ctx.drawImage(img, 0, 0);
        
        const dataUrl = canvas.toDataURL(format, 0.92);
        const link = document.createElement('a');
        const extension = format.split('/')[1];
        link.download = `converted-svg.${extension}`;
        link.href = dataUrl;
        link.click();
        
        URL.revokeObjectURL(url);
        setIsExporting(false);
      };

      img.onerror = () => {
        setError('Failed to render SVG. It might be invalid or have external references.');
        URL.revokeObjectURL(url);
        setIsExporting(false);
      };

      img.src = url;
    } catch (err) {
      console.error('[SVG Export]', err);
      setError('An error occurred during export.');
      setIsExporting(false);
    }
  };

  return (
    <ToolsLayout>
      <div className="h-[calc(100vh-14rem)] flex flex-col items-center">
        <div className="w-full max-w-4xl space-y-6 h-full flex flex-col">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold text-zinc-900 flex items-center gap-2">
              <Maximize2 className="text-orange-500" />
              SVG to Image Converter
            </h1>
          </div>

          {!svgContent ? (
            <div
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              data-testid="drop-zone"
              className="flex-1 border-2 border-dashed border-zinc-300 rounded-3xl p-12 flex flex-col items-center justify-center gap-4 hover:border-orange-500 transition-colors cursor-pointer bg-white/50 backdrop-blur-sm"
            >
              <div className="w-16 h-16 rounded-full bg-orange-50 flex items-center justify-center text-orange-600">
                <Upload size={32} />
              </div>
              <div className="text-center">
                <p className="text-lg font-semibold text-zinc-900">
                  Drop your SVG here or click to upload
                </p>
                <p className="text-sm text-zinc-500">
                  Supports .svg files
                </p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".svg"
                onChange={handleFileSelect}
                className="hidden"
                data-testid="file-input"
              />
            </div>
          ) : (
            <div className="flex-1 grid grid-cols-1 lg:grid-cols-3 gap-6 overflow-hidden">
              {/* Preview Area */}
              <div className="lg:col-span-2 flex flex-col min-h-0">
                <div className="bg-white border border-zinc-200 rounded-3xl p-6 flex flex-col gap-4 h-full">
                  <div className="flex items-center justify-between">
                    <h3 className="font-bold text-zinc-900">Preview</h3>
                    <button
                      onClick={clearSvg}
                      className="p-2 text-zinc-400 hover:text-red-500 transition-colors"
                      data-testid="clear-button"
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                  <div 
                    className="flex-1 bg-zinc-100 rounded-2xl overflow-auto flex items-center justify-center p-8 relative"
                    data-testid="svg-preview"
                    dangerouslySetInnerHTML={{ __html: svgContent }}
                  />
                </div>
              </div>

              {/* Controls Area */}
              <div className="space-y-6">
                <div className="bg-white border border-zinc-200 rounded-3xl p-6 space-y-6 shadow-sm">
                  <div className="space-y-4">
                    <label className="text-sm font-bold text-zinc-500 uppercase tracking-wider">
                      Resolution
                    </label>
                    <div className="flex gap-2">
                      {[1, 2, 4].map((res) => (
                        <button
                          key={res}
                          onClick={() => setResolution(res as Resolution)}
                          data-testid={`res-${res}x`}
                          className={`flex-1 py-2 rounded-xl font-bold transition-all ${
                            resolution === res
                              ? 'bg-zinc-900 text-white shadow-lg scale-105'
                              : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
                          }`}
                        >
                          {res}x
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-4">
                    <label className="text-sm font-bold text-zinc-500 uppercase tracking-wider">
                      Format
                    </label>
                    <div className="flex gap-2">
                      {(['image/png', 'image/jpeg'] as ImageFormat[]).map((fmt) => (
                        <button
                          key={fmt}
                          onClick={() => setFormat(fmt)}
                          data-testid={`format-${fmt.split('/')[1]}`}
                          className={`flex-1 py-2 rounded-xl font-bold transition-all ${
                            format === fmt
                              ? 'bg-zinc-900 text-white shadow-lg scale-105'
                              : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
                          }`}
                        >
                          {fmt.split('/')[1].toUpperCase()}
                        </button>
                      ))}
                    </div>
                  </div>

                  <button
                    onClick={downloadImage}
                    disabled={isExporting}
                    data-testid="download-button"
                    className="w-full py-4 rounded-2xl bg-orange-500 text-white font-bold flex items-center justify-center gap-3 hover:bg-orange-600 active:scale-[0.98] transition-all disabled:opacity-50 shadow-md"
                  >
                    {isExporting ? (
                      <Loader2 size={20} className="animate-spin" />
                    ) : (
                      <Download size={20} />
                    )}
                    <span>Download {format.split('/')[1].toUpperCase()}</span>
                  </button>
                </div>

                {error && (
                  <div className="bg-red-50 border border-red-200 rounded-2xl p-4 flex items-start gap-3 text-red-600">
                    <AlertCircle size={20} className="shrink-0" />
                    <p className="text-sm font-medium">{error}</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <style jsx global>{`
        [data-testid="svg-preview"] svg {
          width: 100%;
          height: 100%;
          max-width: 100%;
          max-height: 100%;
          object-fit: contain;
        }
      `}</style>
    </ToolsLayout>
  );
}

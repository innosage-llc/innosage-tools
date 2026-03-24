"use client";

import React, { useState, useRef, useEffect } from 'react';
import { ToolsLayout } from '@/components/ToolsLayout';
import { ImageViewport } from './ImageViewport';
import { renderJoinedImage, ViewportState } from './CanvasRenderer';
import { Download, Loader2 } from 'lucide-react';

export default function ImageJoinerPage() {
  const [leftState, setLeftState] = useState<ViewportState | null>(null);
  const [rightState, setRightState] = useState<ViewportState | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  // We need to know the viewport dimensions.
  // Let's fix them for now, or use a responsive container and measure it.
  // For simplicity and exact pixel mapping, a fixed aspect ratio or fixed size works best.
  // E.g., each viewport is 400x400.
  const [viewportSize, setViewportSize] = useState({ width: 400, height: 400 });
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleResize = () => {
      if (containerRef.current) {
        // We want two squares side-by-side that fit in the container.
        const containerWidth = containerRef.current.clientWidth;
        // Subtract gap (16px) and divide by 2
        const availableWidth = (containerWidth - 16) / 2;
        // Cap it to a reasonable maximum (e.g., 500px) so it doesn't get too tall on huge screens
        const size = Math.min(availableWidth, 500);
        setViewportSize({ width: size, height: size });
      }
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const canDownload = leftState?.image && rightState?.image && !isProcessing;

  const handleDownload = async () => {
    if (!leftState || !rightState) return;

    setIsProcessing(true);
    try {
      const blob = await renderJoinedImage(
        leftState,
        rightState,
        viewportSize.width,
        viewportSize.height,
        2 // High-res multiplier
      );

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'joined-image.jpg';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to render joined image:', error);
      alert('Failed to generate the joined image. See console for details.');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <ToolsLayout>
      <div className="max-w-5xl mx-auto py-8 px-4">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-zinc-900 mb-2">Image Joiner</h1>
          <p className="text-zinc-600">
            Upload two images, pan and zoom to frame them perfectly, and download them as a single side-by-side image.
          </p>
        </div>

        <div className="bg-white border border-zinc-200 rounded-2xl p-6 shadow-sm">

          <div ref={containerRef} className="flex flex-col md:flex-row gap-4 mb-6 justify-center items-center">
            {/* Left Viewport */}
            <div className="flex-1 flex justify-center">
              <ImageViewport
                onStateChange={setLeftState}
                viewportWidth={viewportSize.width}
                viewportHeight={viewportSize.height}
              />
            </div>

            {/* Right Viewport */}
            <div className="flex-1 flex justify-center">
              <ImageViewport
                onStateChange={setRightState}
                viewportWidth={viewportSize.width}
                viewportHeight={viewportSize.height}
              />
            </div>
          </div>

          <div className="flex justify-end pt-4 border-t border-zinc-100">
            <button
              onClick={handleDownload}
              disabled={!canDownload}
              className={`flex items-center px-6 py-2.5 rounded-xl font-medium transition-all ${
                canDownload
                  ? 'bg-zinc-900 text-white hover:bg-zinc-800'
                  : 'bg-zinc-100 text-zinc-400 cursor-not-allowed'
              }`}
            >
              {isProcessing ? (
                <>
                  <Loader2 className="animate-spin mr-2" size={18} />
                  Processing...
                </>
              ) : (
                <>
                  <Download className="mr-2" size={18} />
                  Download Joined Image
                </>
              )}
            </button>
          </div>

        </div>
      </div>
    </ToolsLayout>
  );
}

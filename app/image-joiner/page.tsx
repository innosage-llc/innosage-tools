"use client";

import { ToolsLayout } from '@/components/ToolsLayout';
import { useState } from 'react';
import { Download } from 'lucide-react';
import { ImageViewport } from './ImageViewport';

export type TransformState = {
  scale: number;
  positionX: number;
  positionY: number;
  originalWidth: number;
  originalHeight: number;
  viewportWidth: number;
  viewportHeight: number;
};

export default function ImageJoinerPage() {
  const [leftImage, setLeftImage] = useState<File | string | null>(null);
  const [rightImage, setRightImage] = useState<File | string | null>(null);

  const [leftTransform, setLeftTransform] = useState<TransformState | null>(null);
  const [rightTransform, setRightTransform] = useState<TransformState | null>(null);

  const [isProcessing, setIsProcessing] = useState(false);

  const [error, setError] = useState<string | null>(null);

  const handleDownload = async () => {
    if (!leftImage || !rightImage || !leftTransform || !rightTransform) return;

    setIsProcessing(true);
    setError(null);
    try {
      const { renderJoinedImage } = await import('./CanvasRenderer');
      const blob = await renderJoinedImage(
        { image: leftImage, transform: leftTransform },
        { image: rightImage, transform: rightTransform }
      );

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `joined-image-${Date.now()}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error(e);
      setError('Failed to process images. Please try again.');
    } finally {
      setIsProcessing(false);
    }
  };

  const isReady = leftImage && rightImage && leftTransform && rightTransform;

  return (
    <ToolsLayout>
      <div className="max-w-6xl mx-auto space-y-6">
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl flex justify-between items-center">
            <span>{error}</span>
            <button onClick={() => setError(null)} className="text-red-500 hover:text-red-700">×</button>
          </div>
        )}
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold text-zinc-900 mb-2">Image Joiner</h1>
            <p className="text-zinc-500">
              Upload two images, crop them using a WYSIWYG interface, and join them side-by-side.
            </p>
          </div>
          <button
            onClick={handleDownload}
            disabled={!isReady || isProcessing}
            className="flex items-center gap-2 bg-orange-600 hover:bg-orange-700 text-white px-6 py-3 rounded-xl font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Download size={20} />
            {isProcessing ? 'Processing...' : 'Download Image'}
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 h-[600px]">
          <div className="bg-zinc-100 rounded-xl border border-zinc-200 flex items-center justify-center relative overflow-hidden">
            <ImageViewport
              image={leftImage}
              onImageChange={(f) => setLeftImage(f)}
              onTransformChange={(t) => setLeftTransform(t)}
              label="Drop left image here"
            />
          </div>
          <div className="bg-zinc-100 rounded-xl border border-zinc-200 flex items-center justify-center relative overflow-hidden">
             <ImageViewport
              image={rightImage}
              onImageChange={(f) => setRightImage(f)}
              onTransformChange={(t) => setRightTransform(t)}
              label="Drop right image here"
            />
          </div>
        </div>
      </div>
    </ToolsLayout>
  );
}

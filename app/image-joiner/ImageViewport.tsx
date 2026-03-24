"use client";

import { useState, useRef, useEffect, DragEvent } from 'react';
import { TransformWrapper, TransformComponent, ReactZoomPanPinchRef } from 'react-zoom-pan-pinch';
import { TransformState } from './page';

interface ImageViewportProps {
  id: string;
  image: File | string | null;
  onImageChange: (file: File) => void;
  onTransformChange: (state: TransformState) => void;
  label?: string;
}

export function ImageViewport({ id: _id, image, onImageChange, onTransformChange, label }: ImageViewportProps) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const transformComponentRef = useRef<ReactZoomPanPinchRef>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [imageDimensions, setImageDimensions] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    if (image instanceof File) {
      const url = URL.createObjectURL(image);
      setImageUrl(url);
      return () => URL.revokeObjectURL(url);
    } else if (typeof image === 'string') {
      setImageUrl(image);
    } else {
      setImageUrl(null);
    }
  }, [image]);

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);

    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith('image/')) {
      onImageChange(file);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type.startsWith('image/')) {
      onImageChange(file);
    }
  };

  const reportTransform = () => {
    if (transformComponentRef.current && containerRef.current && imageDimensions) {
      const { state } = transformComponentRef.current;
      const { scale, positionX, positionY } = state;
      const { clientWidth, clientHeight } = containerRef.current;

      onTransformChange({
        scale,
        positionX,
        positionY,
        originalWidth: imageDimensions.width,
        originalHeight: imageDimensions.height,
        viewportWidth: clientWidth,
        viewportHeight: clientHeight,
      });
    }
  };

  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    setImageDimensions({ width: img.naturalWidth, height: img.naturalHeight });
  };

  // When dimensions change, report the initial transform
  useEffect(() => {
    if (imageDimensions) {
       reportTransform();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageDimensions]);

  return (
    <div
      ref={containerRef}
      className={`w-full h-full relative flex items-center justify-center transition-colors ${isDragging ? 'bg-orange-50' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileSelect}
        accept="image/*"
        className="hidden"
      />
      {imageUrl ? (
        <TransformWrapper
          ref={transformComponentRef}
          initialScale={1}
          minScale={0.1}
          maxScale={10}
          centerOnInit={true}
          limitToBounds={true}
          onTransformed={reportTransform}
        >
          <TransformComponent wrapperClass="w-full h-full" contentClass="w-full h-full flex items-center justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={imageUrl}
              alt={label || "Viewport Image"}
              onLoad={handleImageLoad}
              className="max-w-none pointer-events-none select-none"
              style={{ display: 'block' }}
            />
          </TransformComponent>
        </TransformWrapper>
      ) : (
        <div
          className="text-zinc-500 flex flex-col items-center cursor-pointer hover:text-orange-600 transition-colors z-10 p-8"
          onClick={() => fileInputRef.current?.click()}
        >
          <p className="font-medium text-lg pointer-events-none">{label || "Drop an image here"}</p>
          <p className="text-sm mt-1 pointer-events-none">or click to upload</p>
        </div>
      )}
    </div>
  );
}

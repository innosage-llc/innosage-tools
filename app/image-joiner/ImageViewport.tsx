import React, { useRef, useState, useCallback, useEffect } from 'react';
import { TransformWrapper, TransformComponent, ReactZoomPanPinchRef } from 'react-zoom-pan-pinch';
import { ViewportState } from './CanvasRenderer';
import { ImagePlus } from 'lucide-react';

interface ImageViewportProps {
  onStateChange: (state: ViewportState) => void;
  viewportWidth: number;
  viewportHeight: number;
}

export const ImageViewport: React.FC<ImageViewportProps> = ({
  onStateChange,
  viewportWidth,
  viewportHeight,
}) => {
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [imageElement, setImageElement] = useState<HTMLImageElement | null>(null);
  const transformComponentRef = useRef<ReactZoomPanPinchRef>(null);

  // Default state to pass up when no image
  const defaultState: ViewportState = {
    image: null,
    scale: 1,
    positionX: 0,
    positionY: 0,
    imageWidth: 0,
    imageHeight: 0,
  };

  // Keep track of the current image state
  const reportState = useCallback(
    (scale: number, positionX: number, positionY: number) => {
      onStateChange({
        image: imageElement,
        scale,
        positionX,
        positionY,
        imageWidth: imageElement?.naturalWidth || 0,
        imageHeight: imageElement?.naturalHeight || 0,
      });
    },
    [imageElement, onStateChange]
  );

  // Report initial state on mount or image load
  useEffect(() => {
    if (imageElement && transformComponentRef.current?.state) {
      const { scale, positionX, positionY } = transformComponentRef.current.state;
      reportState(scale, positionX, positionY);
    } else {
      onStateChange(defaultState);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageElement, onStateChange]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      loadImage(file);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) {
      loadImage(file);
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
  };

  const loadImage = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const src = e.target?.result as string;
      console.log("ImageViewport: FileReader loaded src", src.substring(0, 50));
      setImageSrc(src);
    };
    reader.readAsDataURL(file);
  };

  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    console.log("ImageViewport: Image element loaded (onLoad)", img.naturalWidth, img.naturalHeight);
    setImageElement(img);
  };

  // Backup for onLoad if it's flaky in some environments
  useEffect(() => {
    if (imageSrc && !imageElement) {
        const img = new Image();
        img.onload = () => {
            console.log("ImageViewport: Image loaded (useEffect backup)", img.naturalWidth, img.naturalHeight);
            setImageElement(img);
        };
        img.src = imageSrc;
    }
  }, [imageSrc, imageElement]);

  const handleTransform = (ref: ReactZoomPanPinchRef) => {
    if (!ref.state) return;
    const { scale, positionX, positionY } = ref.state;
    console.log("ImageViewport: Transform handled", { scale, positionX, positionY });
    reportState(scale, positionX, positionY);
  };

  // We need to make sure the TransformComponent itself matches the viewport size
  const containerStyle: React.CSSProperties = {
    width: `${viewportWidth}px`,
    height: `${viewportHeight}px`,
    position: 'relative',
    overflow: 'hidden',
    backgroundColor: '#f4f4f5', // zinc-100
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  };

  return (
    <div
      style={containerStyle}
      className="border-2 border-dashed border-zinc-300 rounded-xl transition-colors hover:border-zinc-400 group cursor-pointer relative"
      onDrop={handleDrop}
      onDragOver={handleDragOver}
    >
      {!imageSrc ? (
        <label className="absolute inset-0 flex flex-col items-center justify-center cursor-pointer">
          <div className="w-12 h-12 bg-white rounded-xl shadow-sm border border-zinc-200 flex items-center justify-center mb-3 group-hover:scale-105 transition-transform">
            <ImagePlus className="text-zinc-400" size={24} />
          </div>
          <span className="text-sm font-medium text-zinc-600">Click or Drop Image</span>
          <span className="text-xs text-zinc-400 mt-1">JPEG, PNG, WebP</span>
          <input
            type="file"
            accept="image/*"
            onChange={handleFileChange}
            className="hidden"
          />
        </label>
      ) : (
        <TransformWrapper
          ref={transformComponentRef}
          onTransformed={handleTransform}
          onZoomStop={handleTransform}
          onPanningStop={handleTransform}
          onInit={handleTransform}
          limitToBounds={true}
          centerOnInit={true}
          minScale={0.1} // Allow shrinking if image is huge
          maxScale={20}
          panning={{
            velocityDisabled: false,
            wheelPanning: true, // Enable panning with two-finger scroll on trackpads
          }}
          velocityAnimation={{
            sensitivity: 12000, // Balanced for fast but controlled panning
            animationTime: 400,
            animationType: "easeOut",
          }}
          pinch={{
            step: 0.05,
          }}
          wheel={{
            step: 0.01, // Fine-grained zoom
            smoothStep: 0.01,
            touchPadDisabled: false,
          }}
        >
          <TransformComponent
             wrapperStyle={{ width: '100%', height: '100%' }}
             contentStyle={{
                 // We don't force width/height here so the image defines content size.
                 // react-zoom-pan-pinch centers it based on natural dimensions.
                 display: 'block',
             }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={imageSrc}
              alt="Viewport Content"
              onLoad={handleImageLoad}
              // Remove pointer-events-none so it doesn't block dragging
              // but standard drag might interfere. react-zoom-pan-pinch handles its own drag.
              draggable={false}
              style={{ display: 'block', maxWidth: 'none', maxHeight: 'none' }}
            />
          </TransformComponent>
        </TransformWrapper>
      )}
    </div>
  );
};

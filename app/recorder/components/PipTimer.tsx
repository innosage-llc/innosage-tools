"use client";

import { useEffect, useRef, useState } from 'react';

interface PipTimerProps {
  duration: number; // in milliseconds
  isActive: boolean;
  onToggle?: (isPip: boolean) => void;
}

export function PipTimer({ duration, isActive, onToggle }: PipTimerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPip, setIsPip] = useState(false);

  // Draw timer to canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Background
    ctx.fillStyle = '#18181b'; // zinc-900
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Format time MM:SS
    const totalSeconds = Math.floor(duration / 1000);
    const m = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
    const s = (totalSeconds % 60).toString().padStart(2, '0');
    const timeString = `${m}:${s}`;

    // Draw REC dot if active
    if (isActive) {
      ctx.fillStyle = '#ef4444'; // red-500
      ctx.beginPath();
      ctx.arc(40, canvas.height / 2, 8, 0, Math.PI * 2);
      ctx.fill();
    }

    // Draw text
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 48px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(timeString, canvas.width / 2 + 10, canvas.height / 2);

  }, [duration, isActive]);

  // Setup video stream from canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;

    const stream = canvas.captureStream(30); // 30 fps
    video.srcObject = stream;
    video.play().catch(console.error);

    // Listen for PiP events
    const onEnterPip = () => {
      setIsPip(true);
      onToggle?.(true);
    };
    const onLeavePip = () => {
      setIsPip(false);
      onToggle?.(false);
    };

    video.addEventListener('enterpictureinpicture', onEnterPip);
    video.addEventListener('leavepictureinpicture', onLeavePip);

    return () => {
      video.removeEventListener('enterpictureinpicture', onEnterPip);
      video.removeEventListener('leavepictureinpicture', onLeavePip);
    };
  }, [onToggle]);

  const togglePip = async () => {
    const video = videoRef.current;
    if (!video) return;

    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else {
        await video.requestPictureInPicture();
      }
    } catch (err) {
      console.error("Failed to toggle PiP", err);
    }
  };

  return (
    <div className="flex flex-col items-center gap-2">
      {/* Visually hidden elements for PiP generation */}
      <div className="absolute opacity-0 pointer-events-none w-0 h-0 overflow-hidden">
        <canvas
          ref={canvasRef}
          width={256}
          height={144}
        />
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
        />
      </div>

      <button
        onClick={togglePip}
        className="text-sm font-medium px-4 py-2 rounded-lg bg-zinc-100 hover:bg-zinc-200 text-zinc-900 transition-colors"
      >
        {isPip ? 'Close Mini Timer' : 'Open Mini Timer (PiP)'}
      </button>
    </div>
  );
}

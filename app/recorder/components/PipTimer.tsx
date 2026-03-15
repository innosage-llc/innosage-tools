"use client";

import { useEffect, useRef } from "react";
import { Maximize2, Minimize2 } from "lucide-react";

interface PipTimerProps {
  duration: number; // in milliseconds
  isActive: boolean;
  onToggle: () => void;
}

function formatDuration(ms: number) {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

export function PipTimer({ duration, isActive, onToggle }: PipTimerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Draw routine
    const draw = () => {
      // Background
      ctx.fillStyle = "#18181b"; // zinc-900
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // REC text + circle
      if (isActive) {
        // Blink effect
        const opacity = Math.sin(Date.now() / 300) > 0 ? 1 : 0.5;
        ctx.fillStyle = `rgba(239, 68, 68, ${opacity})`; // red-500
        ctx.beginPath();
        ctx.arc(40, 40, 8, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = "#ef4444";
        ctx.font = "bold 16px Inter, sans-serif";
        ctx.fillText("REC", 56, 46);
      } else {
        ctx.fillStyle = "#71717a"; // zinc-500
        ctx.beginPath();
        ctx.arc(40, 40, 8, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = "#71717a";
        ctx.font = "bold 16px Inter, sans-serif";
        ctx.fillText("PAUSED", 56, 46);
      }

      // Timer
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 48px monospace";
      ctx.textAlign = "center";
      ctx.fillText(formatDuration(duration), canvas.width / 2, canvas.height / 2 + 24);

      // Request next frame if PiP is active or we are actively recording
      if (document.pictureInPictureElement || isActive) {
        requestAnimationFrame(draw);
      }
    };

    // Initial draw
    let animationFrameId: number;
    const loop = () => {
      draw();
      if (document.pictureInPictureElement || isActive) {
        animationFrameId = requestAnimationFrame(loop);
      }
    };
    loop();

    return () => {
        cancelAnimationFrame(animationFrameId);
    };
  }, [duration, isActive]);

  useEffect(() => {
    // Setup video stream from canvas
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;

    // Type casting for Safari compatibility where captureStream might need prefixes
    const captureStream = (canvas as HTMLCanvasElement & { captureStream?: (fps?: number) => MediaStream; mozCaptureStream?: (fps?: number) => MediaStream }).captureStream ||
                          (canvas as HTMLCanvasElement & { captureStream?: (fps?: number) => MediaStream; mozCaptureStream?: (fps?: number) => MediaStream }).mozCaptureStream;
    if (captureStream) {
       video.srcObject = captureStream.call(canvas, 30); // 30 FPS
       video.play().catch(e => console.error("Error playing PiP video stream:", e));
    }
  }, []);

  const handlePiPToggle = async () => {
    const video = videoRef.current;
    if (!video) return;

    if (document.pictureInPictureElement) {
      await document.exitPictureInPicture();
    } else {
      try {
        await video.requestPictureInPicture();
        // Force a redraw loop to start if it was stopped
        const canvas = canvasRef.current;
        if(canvas) {
             const ctx = canvas.getContext('2d');
             if(ctx) {
                 const draw = () => {
                     // Trigger update via state indirectly or just force canvas redraw logic here.
                     // The useEffect above handles the actual drawing when duration changes.
                     if (document.pictureInPictureElement) {
                         requestAnimationFrame(draw);
                     }
                 };
                 draw();
             }
        }

      } catch (error) {
        console.error("Failed to enter PiP mode", error);
      }
    }
    onToggle();
  };

  return (
    <div className="relative group rounded-xl overflow-hidden border border-zinc-200 shadow-sm bg-zinc-900 w-[256px] h-[144px] flex-shrink-0">
      {/* Hidden elements for PiP rendering */}
      <canvas ref={canvasRef} width={256} height={144} className="hidden" />
      <video ref={videoRef} autoPlay playsInline muted className="hidden" />

      {/* Visible UI representation */}
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
         <div className="flex items-center gap-2 mb-2">
            <div className={`w-3 h-3 rounded-full ${isActive ? 'bg-red-500 animate-pulse' : 'bg-zinc-500'}`} />
            <span className={`text-sm font-bold tracking-widest ${isActive ? 'text-red-500' : 'text-zinc-500'}`}>
                {isActive ? 'REC' : 'PAUSED'}
            </span>
         </div>
         <div className="text-4xl font-mono text-white font-medium">
             {formatDuration(duration)}
         </div>
      </div>

      {/* Overlay Toggle Button */}
      <button
        onClick={handlePiPToggle}
        className="absolute bottom-2 right-2 p-2 bg-black/50 hover:bg-black/70 rounded-lg text-white/80 hover:text-white transition-all opacity-0 group-hover:opacity-100 backdrop-blur-sm"
        title="Toggle Picture-in-Picture Timer"
      >
        {document.pictureInPictureElement ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
      </button>
    </div>
  );
}

"use client";

import { useEffect, useRef } from "react";
import { Mic, Speaker } from "lucide-react";

interface AudioLevelMeterProps {
  analyser: AnalyserNode | null;
  label: string;
}

export function AudioLevelMeter({ analyser, label }: AudioLevelMeterProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | null>(null);

  useEffect(() => {
    if (!analyser || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // To avoid ESLint warning about modifying prop, create a local ref/copy or just accept it.
    // However, analyser is an AudioNode, setting properties on it is the standard way.
    // We'll bypass the linter for this specific intentional DOM API mutation
    // eslint-disable-next-line react-hooks/immutability
    analyser.fftSize = 256;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const draw = () => {
      animationRef.current = requestAnimationFrame(draw);

      analyser.getByteFrequencyData(dataArray);

      // Calculate simple volume (average)
      let sum = 0;
      for (let i = 0; i < bufferLength; i++) {
        sum += dataArray[i];
      }
      const average = sum / bufferLength;

      // Normalize to 0-1
      const normalizedLevel = Math.min(1, average / 128); // 128 is half of max byte value 255

      // Clear canvas
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Draw background bar
      ctx.fillStyle = "#f4f4f5"; // zinc-100
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Draw level bar
      // Color gradient based on level (green -> yellow -> red)
      let barColor = "#22c55e"; // green-500
      if (normalizedLevel > 0.6) {
        barColor = "#eab308"; // yellow-500
      }
      if (normalizedLevel > 0.85) {
        barColor = "#ef4444"; // red-500
      }

      ctx.fillStyle = barColor;
      const barWidth = Math.max(0, canvas.width * normalizedLevel);
      ctx.fillRect(0, 0, barWidth, canvas.height);

      // Draw segments to make it look like a meter
      ctx.fillStyle = "#ffffff";
      const segmentCount = 20;
      const segmentWidth = canvas.width / segmentCount;
      for (let i = 1; i < segmentCount; i++) {
          ctx.fillRect(i * segmentWidth, 0, 1, canvas.height);
      }
    };

    draw();

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [analyser]);

  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center justify-center w-8 h-8 rounded-full bg-zinc-100 text-zinc-500">
        {label === "mic" ? <Mic size={16} /> : <Speaker size={16} />}
      </div>
      <div className="flex-1 flex flex-col gap-1">
        <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">
          {label === "mic" ? "Microphone" : "System Audio"}
        </span>
        <canvas
          ref={canvasRef}
          width={200}
          height={8}
          className="w-full h-2 rounded-full overflow-hidden"
        />
      </div>
    </div>
  );
}

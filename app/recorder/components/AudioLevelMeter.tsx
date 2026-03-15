"use client";

import { useEffect, useRef, useState } from 'react';

interface AudioLevelMeterProps {
  analyser: AnalyserNode | null;
  label: string;
}

export function AudioLevelMeter({ analyser, label }: AudioLevelMeterProps) {
  const [level, setLevel] = useState(0); // 0 to 100
  const reqRef = useRef<number>(null);

  useEffect(() => {
    if (!analyser) {
      // Avoid calling setLevel directly within the effect synchronously if not needed,
      // but it's safe inside this logic branch or we can delay it
      const timer = setTimeout(() => setLevel(0), 0);
      return () => clearTimeout(timer);
    }

    const dataArray = new Uint8Array(analyser.frequencyBinCount);

    const updateLevel = () => {
      analyser.getByteFrequencyData(dataArray);

      // Calculate average volume level
      const sum = dataArray.reduce((acc, value) => acc + value, 0);
      const avg = sum / dataArray.length;
      const pct = (avg / 255) * 100;

      setLevel(pct);

      reqRef.current = requestAnimationFrame(updateLevel);
    };

    updateLevel();

    return () => {
      if (reqRef.current) {
        cancelAnimationFrame(reqRef.current);
      }
    };
  }, [analyser]);

  // Color gradient for the meter: green -> yellow -> red
  const getColor = (lvl: number) => {
    if (lvl > 80) return 'bg-red-500';
    if (lvl > 50) return 'bg-yellow-400';
    return 'bg-green-500';
  };

  return (
    <div className="flex flex-col gap-1 w-full max-w-xs">
      <div className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
        {label} Level
      </div>
      <div className="h-4 w-full bg-zinc-200 rounded-full overflow-hidden flex">
        <div
          className={`h-full transition-all duration-75 ease-out rounded-full ${getColor(level)}`}
          style={{ width: `${Math.max(2, level)}%` }} // Minimum width to show it's active
        />
      </div>
    </div>
  );
}

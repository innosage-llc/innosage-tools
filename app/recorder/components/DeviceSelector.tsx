"use client";

import { useState, useEffect } from "react";
import { Mic } from "lucide-react";

interface DeviceSelectorProps {
  selectedDeviceId: string;
  onChange: (id: string) => void;
}

export function DeviceSelector({ selectedDeviceId, onChange }: DeviceSelectorProps) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);

  useEffect(() => {
    async function getDevices() {
      try {
        // Request initial permission to enumerate devices properly
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((track) => track.stop());
        setHasPermission(true);

        const allDevices = await navigator.mediaDevices.enumerateDevices();
        const audioInputs = allDevices.filter((device) => device.kind === "audioinput");
        setDevices(audioInputs);

        if (!selectedDeviceId && audioInputs.length > 0) {
          onChange(audioInputs[0].deviceId);
        }
      } catch (err) {
        console.error("Error fetching devices:", err);
        setHasPermission(false);
      }
    }

    getDevices();
  }, [selectedDeviceId, onChange]);

  if (hasPermission === false) {
    return (
      <div className="flex items-center space-x-2 text-red-500 text-sm">
        <Mic className="w-4 h-4" />
        <span>Microphone permission denied.</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col space-y-2">
      <label htmlFor="mic-select" className="text-sm font-medium text-zinc-700 flex items-center gap-2">
        <Mic className="w-4 h-4 text-zinc-500" />
        Microphone
      </label>
      <div className="relative">
        <select
          id="mic-select"
          value={selectedDeviceId}
          onChange={(e) => onChange(e.target.value)}
          className="w-full appearance-none rounded-lg border border-zinc-200 bg-white px-4 py-2.5 text-sm text-zinc-900 shadow-sm focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 transition-colors"
          disabled={devices.length === 0}
        >
          {devices.length === 0 ? (
            <option>Loading devices...</option>
          ) : (
            devices.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label || `Microphone ${devices.indexOf(device) + 1}`}
              </option>
            ))
          )}
        </select>
        <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-4 text-zinc-500">
          <svg className="h-4 w-4 fill-current" viewBox="0 0 20 20">
            <path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" />
          </svg>
        </div>
      </div>
    </div>
  );
}

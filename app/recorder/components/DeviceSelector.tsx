"use client";

import { useEffect, useState } from 'react';

interface DeviceSelectorProps {
  selectedDeviceId: string;
  onChange: (id: string) => void;
}

export function DeviceSelector({ selectedDeviceId, onChange }: DeviceSelectorProps) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchDevices() {
      try {
        // Request permission to ensure we get real labels
        await navigator.mediaDevices.getUserMedia({ audio: true });

        const allDevices = await navigator.mediaDevices.enumerateDevices();
        const audioDevices = allDevices.filter(d => d.kind === 'audioinput');
        setDevices(audioDevices);

        if (audioDevices.length > 0 && !selectedDeviceId) {
          onChange(audioDevices[0].deviceId);
        }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (err: any) {
        console.warn('Could not list media devices:', err);
        setError('Microphone permission required.');
      }
    }

    fetchDevices();
  }, [selectedDeviceId, onChange]);

  if (error) {
    return <p className="text-red-500 text-sm">{error}</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor="mic-select" className="text-sm font-medium text-zinc-700">
        Microphone Source
      </label>
      <select
        id="mic-select"
        value={selectedDeviceId}
        onChange={(e) => onChange(e.target.value)}
        className="block w-full rounded-lg border-zinc-200 shadow-sm focus:border-zinc-500 focus:ring-zinc-500 sm:text-sm py-2 px-3 border"
      >
        {devices.map(device => (
          <option key={device.deviceId} value={device.deviceId}>
            {device.label || `Microphone ${device.deviceId.slice(0, 5)}...`}
          </option>
        ))}
      </select>
    </div>
  );
}

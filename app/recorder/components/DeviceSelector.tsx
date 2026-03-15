"use client";

import { useEffect, useState } from 'react';

interface DeviceSelectorProps {
  mediaType: 'audio' | 'video';
  selectedDeviceId: string;
  onChange: (id: string) => void;
}

export function DeviceSelector({ mediaType, selectedDeviceId, onChange }: DeviceSelectorProps) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [error, setError] = useState<string | null>(null);

  const kind = mediaType === 'audio' ? 'audioinput' : 'videoinput';
  const label = mediaType === 'audio' ? 'Microphone' : 'Camera';

  useEffect(() => {
    async function fetchDevices() {
      try {
        // Request permission to ensure we get real labels
        await navigator.mediaDevices.getUserMedia({ [mediaType]: true });

        const allDevices = await navigator.mediaDevices.enumerateDevices();
        const filteredDevices = allDevices.filter(d => d.kind === kind);
        setDevices(filteredDevices);

        if (filteredDevices.length > 0 && !selectedDeviceId) {
          onChange(filteredDevices[0].deviceId);
        }
      } catch (err: unknown) {
        if (err instanceof Error) {
          console.warn(`Could not list ${mediaType} devices:`, err.message);
        } else {
          console.warn(`Could not list ${mediaType} devices:`, err);
        }
        setError(`${label} permission required.`);
      }
    }

    fetchDevices();
  }, [selectedDeviceId, onChange, mediaType, kind, label]);

  if (error) {
    return <p className="text-red-500 text-sm">{error}</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={`${kind}-select`} className="text-sm font-medium text-zinc-700">
        {label} Source
      </label>
      <select
        id={`${kind}-select`}
        value={selectedDeviceId}
        onChange={(e) => onChange(e.target.value)}
        className="block w-full rounded-lg border-zinc-200 shadow-sm focus:border-zinc-500 focus:ring-zinc-500 sm:text-sm py-2 px-3 border"
      >
        {devices.map(device => (
          <option key={device.deviceId} value={device.deviceId}>
            {device.label || `${label} ${device.deviceId.slice(0, 5)}...`}
          </option>
        ))}
      </select>
    </div>
  );
}

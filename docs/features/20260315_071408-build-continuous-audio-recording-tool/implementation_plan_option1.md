# Implementation Plan: Option 1 — Performance-First Recorder

## Goal

Build a browser-based audio/video recorder at `/recorder` in `products/innosage-tools` that continuously saves to disk via the File System Access API, mixes microphone + system audio, and provides a PiP status timer.

---

## Proposed Changes

### Recording Engine

---

#### [NEW] [recording-engine.ts](file:///Users/weijingliunyu/innosage-hub/products/innosage-tools/app/recorder/lib/recording-engine.ts)

Core logic module. Three classes:

##### `AudioMixer`
- Creates an `AudioContext` + `createMediaStreamDestination()`.
- `addStream(stream: MediaStream, label: string)` → creates `MediaStreamSource` → `GainNode` → connects to destination.
- `getGainNode(label: string)` → returns `GainNode` for per-source volume control.
- `getMixedStream()` → returns `destination.stream`.
- `dispose()` → disconnects all nodes, closes context.

##### `DiskWriter`
- `static async create(suggestedName: string)` → calls `showSaveFilePicker({ suggestedName, types: [{ accept: { 'video/webm': ['.webm'] } }] })` → stores `FileSystemWritableFileStream`.
- `write(chunk: Blob)` → `this.writer.write(chunk)`.
- `close()` → `this.writer.close()`.
- `isSupported()` → `'showSaveFilePicker' in window`.
- **Fallback**: If not supported, buffer chunks in `Blob[]` and offer download on stop.

##### `RecordingEngine`
- Constructor: `new RecordingEngine(config: RecordingConfig)`.
- `RecordingConfig` type:
  ```ts
  type RecordingConfig = {
    mode: 'audio' | 'video';
    micDeviceId?: string;
    audioBitrate: number; // default 128000
    videoBitrate: number; // default 2500000
    timeslice: number;    // default 1000 (ms)
  };
  ```
- `start()` flow:
  1. `getUserMedia({ audio: { deviceId } })` → mic stream.
  2. `getDisplayMedia({ video: mode === 'video', audio: { suppressLocalAudioPlayback: true } })` → system stream.
  3. If audio-only: stop video tracks from display stream immediately.
  4. Create `AudioMixer`, add both audio streams.
  5. Build final `MediaStream`:
     - Audio-only: `mixer.getMixedStream()`
     - Video: `new MediaStream([...displayStream.getVideoTracks(), ...mixer.getMixedStream().getAudioTracks()])`
  6. Create `DiskWriter`.
  7. Create `MediaRecorder(finalStream, { mimeType, audioBitsPerSecond, videoBitsPerSecond })`.
  8. `recorder.start(timeslice)`.
  9. `recorder.ondataavailable = (e) => writer.write(e.data)`.
- `stop()` flow:
  1. `recorder.stop()`.
  2. On `recorder.onstop`: apply `fix-webm-duration` to concatenated blob → write corrected header → `writer.close()`.
  3. Stop all media tracks.
  4. `mixer.dispose()`.
- `pause()` / `resume()` → delegates to `recorder.pause()` / `recorder.resume()`.
- Emits events via `EventTarget`: `'statechange'`, `'error'`, `'tick'` (every second with elapsed duration).

---

### UI Components

---

#### [NEW] [PipTimer.tsx](file:///Users/weijingliunyu/innosage-hub/products/innosage-tools/app/recorder/components/PipTimer.tsx)

Ported from `framecut-editor`, simplified:

- Hidden `<canvas>` (256×144) draws `● REC` + `MM:SS` timer.
- Hidden `<video>` element fed by `canvas.captureStream(1)`.
- `togglePiP()` → `video.requestPictureInPicture()`.
- Props: `duration: number`, `isActive: boolean`, `onToggle: () => void`.

#### [NEW] [DeviceSelector.tsx](file:///Users/weijingliunyu/innosage-hub/products/innosage-tools/app/recorder/components/DeviceSelector.tsx)

- Calls `navigator.mediaDevices.enumerateDevices()` on mount.
- Filters `audioinput` devices.
- Renders a `<select>` dropdown for microphone selection.
- Props: `selectedDeviceId: string`, `onChange: (id: string) => void`.

#### [NEW] [AudioLevelMeter.tsx](file:///Users/weijingliunyu/innosage-hub/products/innosage-tools/app/recorder/components/AudioLevelMeter.tsx)

- Uses `AnalyserNode` from `AudioContext` to read frequency data.
- Renders a simple bar-graph visualization (CSS-based, not canvas).
- Props: `analyser: AnalyserNode | null`, `label: string`.

---

### Main Page

---

#### [NEW] [page.tsx](file:///Users/weijingliunyu/innosage-hub/products/innosage-tools/app/recorder/page.tsx)

Uses `ToolsLayout` wrapper. Three states:

**1. Setup State** (before recording):
- Mode toggle: Audio Only / Video + Audio.
- Microphone selector (`DeviceSelector`).
- Bitrate selector (Low / Medium / High).
- "Start Recording" button (triggers `DiskWriter.create()` then `engine.start()`).
- Browser compatibility banner if `showSaveFilePicker` unavailable.

**2. Recording State**:
- Timer display (MM:SS:ms).
- `AudioLevelMeter` for Mic and System channels.
- Pause / Resume button.
- Stop button.
- PiP toggle button.
- File size indicator (sum of written chunk sizes).

**3. Done State**:
- Success message with file path hint.
- "Record Again" button.

#### [MODIFY] [page.tsx](file:///Users/weijingliunyu/innosage-hub/products/innosage-tools/app/page.tsx)

Add a new tool card for the recorder on the tools index page, following the existing card pattern (icon, title, description, link).

---

### Dependencies

#### [MODIFY] [package.json](file:///Users/weijingliunyu/innosage-hub/products/innosage-tools/package.json)

Add: `"fix-webm-duration": "^1.0.6"` (or `"webm-fix-duration"` for the TS fork).

---

## Verification Plan

### Automated Tests
- Unit test `AudioMixer`: verify `getMixedStream()` returns a `MediaStream` with exactly 1 audio track.
- Unit test `DiskWriter.isSupported()`: verify it returns a boolean based on API presence.

### Manual Verification
1. **Audio-only**: Select mic + share a tab playing music → record 1 min → verify `.webm` file has both sources mixed, duration is correct.
2. **Video + Audio**: Share screen + mic → record 30s → verify video and audio present.
3. **Pause/Resume**: Pause mid-recording → resume → verify no gaps or corruption.
4. **PiP Timer**: Enable floating timer → switch apps → verify timer visible.
5. **Fallback**: Test in Firefox → verify Blob download fallback works.
6. **Gate**: `npm run lint && npm run build` passes.

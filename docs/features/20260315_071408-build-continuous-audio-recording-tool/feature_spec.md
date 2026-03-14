# Feature Specification Document: Continuous Audio & Video Recorder

## 1. Executive Summary

- **Feature**: Continuous Audio & Video Recorder
- **Status**: Planned (Audit Complete)
- **Summary**: A High-performance, client-side recording tool for `innosage-tools` that streams media directly to the user's disk. Unlike standard browser recorders that store data in RAM (causing crashes on long sessions), this tool uses the File System Access API for infinite recording length. It supports combined Mic + System audio and a floating PiP timer.

## 2. Design Philosophy & Guiding Principles

**Clarity vs. Power:**
- **Our Principle**: **Power for technical creators.** While the UI is clean, we prioritize powerful features like per-channel gain control, high-bitrate selection, and event-tracking (Option 2) for integration with professional editing workflows.

**Convention vs. Novelty:**
- **Our Principle**: **Novel Storage, Conventional UI.** We use novel APIs (File System Access) to solve depth problems but keep the recording interface extremely familiar (standard REC icons, timers, and level meters).

**Guidance vs. Freedom:**
- **Our Principle**: **Forgiving Guardrails.** We guide the user to select a save location *before* recording starts to ensure zero-loss recording, providing clear feedback if the chosen browser doesn't support the required APIs.

**Aesthetic & Tone:**
- **Our Principle**: **Professional & High-Performance.** The UI follows the `innosage-tools` minimalist aesthetic—clean typography, subtle glassmorphism, and responsive micro-animations for level meters.

## 3. Problem Statement & Goals

- **Problem**: 
  1. Browser-based screen/audio recorders often crash during long sessions because they buffer large blobs in RAM.
  2. Capturing both Microphone and System audio on the web is complex and often results in missing tracks or echoes.
  3. Recorded WebM files from browsers often have "Infinity" duration, making them broken for seeking/editing.
- **Goals**:
  - Achieve sub-1% RAM usage for storage regardless of recording length.
  - Successfully mix two or more audio streams into a single clean track.
  - Produce metadata-fixed, seekable WebM files directly on the user's disk.
- **Success Metrics**:
  - 100% success rate for 1-hour+ recording sessions.
  - Sub-100ms latency in audio mixing.
  - Verified compatibility with FrameCut for event-based editing.

## 4. Scope

- **In Scope:**
  - Continuous saving via File System Access API (Chromium).
  - Audio mixing (Mic + System) with `suppressLocalAudioPlayback`.
  - Floating PiP Timer for status monitoring.
  - WebM (VP9/Opus) encoding.
  - Event Tracking (Mouse/Keyboard) sidecar JSON (Option 2).
- **Out of Scope:**
  - In-browser video editing (deferred to FrameCut).
  - Multi-track audio file export (mixed into 1 track for simplicity).
  - Cloud synchronization of recordings.

## 5. User Stories

- As a **Technical Educator**, I want to record my screen and voice for 2 hours without worrying about tab crashes so that I can focus on teaching.
- As a **Developer**, I want my mouse clicks to be recorded as metadata so that I can auto-generate spotlight effects in my video editor later.
- As a **Privacy-Conscious User**, I want to record entirely client-side without any data touching a server.

## 6. Acceptance Criteria

- **Scenario: Start Recording**
  - **Given**: A Chromium browser with File System Access enabled.
  - **When**: User clicks "Select Save File" and then "Start".
  - **Then**: The OS file picker appears, and recording begins only after a file is selected.
  
- **Scenario: Long Recording**
  - **Given**: A 30-minute recording session in progress.
  - **When**: Browser memory usage is checked.
  - **Then**: Memory usage should remain constant (not grow with time).

## 7. UI/UX Flow & Requirements

- **User Flow**:
  1. Landing: User selects "Audio Only" or "Video + Audio".
  2. Setup: Selects Mic source and output quality.
  3. Initialize: Clicks "Select Destination" (OS Picker).
  4. Active: Recording starts; MM:SS timer glows; Level meters move.
  5. Monitoring: User clicks "Pop-out Timer" to see status in PiP.
  6. Completion: User clicks "Stop"; file is finalized and seekable.

## 8. Technical Design & Implementation

- **Approach**: 
  - `MediaRecorder` generates chunks via `timeslice: 1000`.
  - `FileSystemWritableFileStream` consumes chunks immediately.
  - `AudioContext` destination used as the source for `MediaRecorder`.
- **Components**:
  - `RecordingEngine`: Orchestrator.
  - `AudioMixer`: Web Audio wrapper.
  - `DiskWriter`: File System Access wrapper.
  - `PiPTimer`: Canvas-to-Video-to-PiP component.

## 11. Runtime Compatibility

| Feature Aspect | Chromium (Chrome/Edge) | Firefox/Safari | Mobile Webview |
| :--- | :--- | :--- | :--- |
| **Streaming Save** | Full (FSA Ready) | Fallback (Blob) | Fallback (Blob) |
| **System Audio** | Full | Limited (Tab only) | None |
| **PiP Timer** | Active | Active (if supported) | Passive |

## 12. Manual Verification Script (QA)

### 12.1. Executable Validation Script

```javascript
(async () => {
  console.group('🧪 Recorder Engine Verification');
  try {
     const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
     const dest = audioCtx.createMediaStreamDestination();
     if (!dest.stream || dest.stream.getAudioTracks().length === 0) throw new Error("AudioMixer failed to create destination");
     
     console.log('✅ AudioMixer destination stream verified');
     
     if (!('showSaveFilePicker' in window)) {
       console.warn('⚠️ File System Access API not available in this environment. Falling back to Blob mode.');
     } else {
       console.log('✅ File System Access API detected');
     }
     
     console.log('✅ SUCCESS');
  } catch (e) {
     console.error('❌ FAILED', e);
  }
  console.groupEnd();
})();
```

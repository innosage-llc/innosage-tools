# Implementation Plan: Continuous Audio & Video Recorder

Build a high-performance recording tool for `innosage-tools` that supports both audio and video, continuously saves to disk, and combines multiple audio sources.

## User Review Required

> [!IMPORTANT]
> **File System Access API**: This tool will primarily use the File System Access API to stream data to disk. This requires a modern Chromium browser (Chrome, Edge) and a user interaction to select the save file *before* recording starts. 
> 
> **macOS Audio Capture**: Capturing "System Audio" on macOS via `getDisplayMedia` is limited to Tab audio (unless the entire screen is shared with "Share Audio" checked). For true system-wide audio, users will still need virtual drivers like BlackHole, which this tool will detect and support via device selection.

## Proposed Changes

### `innosage-tools`

#### [NEW] [audio-video-recorder/page.tsx](file:///Users/weijingliunyu/innosage-hub/products/innosage-tools/app/audio-video-recorder/page.tsx)
- Main entry point for the tool.
- Mode selection (Audio Only vs Video + Audio).
- Recording controls and status dashboard.

#### [NEW] [utils/recording.ts](file:///Users/weijingliunyu/innosage-hub/products/innosage-tools/utils/recording.ts)
- `AudioMixer`: Combines `MediaStream` tracks from Mic and System audio using `AudioContext`.
- `DiskWriter`: Handles the `FileSystemWritableFileStream` for continuous saving.
- `RecordingEngine`: Orchestrates the `MediaRecorder`, mixer, and writer.

#### [NEW] [components/PiPTimer.tsx](file:///Users/weijingliunyu/innosage-hub/products/innosage-tools/components/PiPTimer.tsx)
- A specialized component that uses a hidden canvas and `requestPictureInPicture` to show a floating recording timer (learned from `framecut-editor`).

---

## Verification Plan

### Automated Tests
- Since this involves hardware (Mic/Screen), automated tests are limited. We will focus on logic verification:
    - Unit test for `AudioMixer` to ensure tracks are added to the destination stream.
    - Mock test for `DiskWriter` to ensure it calls `write()` on the stream.

### Manual Verification
1. **Audio-Only Mode**:
    - Select "Audio Only".
    - Connect Microphone and System Audio (e.g., play a YouTube video in another tab).
    - Select a save `.webm` file.
    - Record for 1 minute.
    - Verify the saved file has both Mic and System audio mixed.
2. **Video + Audio Mode**:
    - Select "Video + Audio".
    - Select a Screen share.
    - Record and verify the saved file contains the screen video and mixed audio.
3. **Continuous Save Test**:
    - Record for 5 minutes.
    - Force-close the tab (or simulate a crash).
    - Verify that the partially recorded file exists on disk and is playable up to the crash point (may require a fix for WebM headers).
4. **PiP Timer**:
    - Start recording.
    - Enable "Floating Timer".
    - Switch to another application and verify the timer is visible.

# Task: Build Continuous Audio & Video Recorder

## Setup
- [x] Research and analyze `framecut-editor` recording logic ([x])
- [x] Update options analysis with video and continuous saving ([x])
- [x] Create implementation plan [Option 1](file:///Users/weijingliunyu/innosage-hub/products/innosage-tools/docs/features/20260315_071408-build-continuous-audio-recording-tool/implementation_plan_option1.md) & [Option 2](file:///Users/weijingliunyu/innosage-hub/products/innosage-tools/docs/features/20260315_071408-build-continuous-audio-recording-tool/implementation_plan_option2.md)
- [x] Hand off to execution agent (Copied to products/innosage-tools/docs/features/)

## Core Engine Development (Planned)
- [x] Implement `AudioMixer` class (merge Mic + System audio)
- [x] Implement `DiskWriter` utility (File System Access API wrapper)
- [x] Implement `RecordingEngine` (MediaRecorder + FileSystemWriter)
    - [x] Handle "Audio Only" vs "Video + Audio" modes
    - [x] Handle continuous chunk writing
    - [x] Implement pause/resume logic

## UI & UX Components (Planned)
- [x] Create `/audio-video-recorder` page in `innosage-tools`
- [x] Build recording configuration form (Bitrate, Mode, etc.)
- [x] Build recording status dashboard (Timer, Level Meters)
- [x] Port & optimize **PiP Timer** from `framecut-editor`
- [x] Implement visual feedback for audio levels (Oscilloscope or Meters)

## Polish & Refinement (Planned)
- [x] Implement "Infinity duration" fix for WebM headers
- [x] Add OPFS / Blob download fallback for non-Chromium browsers
- [x] Final UI styling (Glassmorphism, Dark Mode)

## Verification
- [ ] Test audio-only recording (Mic + System)
- [ ] Test video + audio recording
- [ ] Test long-duration recording (verify disk streaming vs RAM)
- [ ] Verify PiP timer functionality

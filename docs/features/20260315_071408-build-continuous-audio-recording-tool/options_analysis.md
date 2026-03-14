# Recording Tool — Options Analysis (V3: Audited)

## The Problem Space

Browser-based tool that **continuously records audio and/or video**, **compresses** it, and **saves to disk** — all client-side.

| Axis | Question |
|:-----|:---------|
| **Mode** | Audio-only or Video + Audio? |
| **Encoding** | How do we compress chunks? |
| **Storage** | How do we persist data to disk **continuously**? |
| **Input Capture** | How do we mix Microphone + System Audio? |

---

## 🔍 Audit Findings (New in V3)

> [!CAUTION]
> The V2 analysis had 6 gaps that could cause production issues. All are addressed below.

| # | Gap | Impact | Fix |
|:--|:----|:-------|:----|
| 1 | Missing `suppressLocalAudioPlayback` | System audio echoes back to speakers during recording | Add `{ audio: { suppressLocalAudioPlayback: true } }` to `getDisplayMedia` constraints |
| 2 | No WebM duration fix strategy | Recorded files show "Infinity" duration in players | Use `fix-webm-duration` or `webm-fix-duration` library post-recording |
| 3 | Crash recovery nuance | V2 claims "safe if tab crashes" but `FileSystemWritableFileStream` writes to a **temp file** until `.close()` is called | Must call `writer.close()` periodically (e.g., rotate files) or accept that crash = data loss |
| 4 | Audio-only mode still requests video | `getDisplayMedia` always returns a video track, wastes bandwidth | Stop video track immediately: `stream.getVideoTracks().forEach(t => t.stop())` |
| 5 | No `timeslice` recommendation | Without `timeslice`, chunk frequency is browser-dependent | Use `recorder.start(1000)` for 1-second chunks — predictable disk writes |
| 6 | No per-OS audio matrix | Users confused about what "System Audio" means per platform | See table below |

### Per-OS System Audio Behavior

| OS | `getDisplayMedia` Audio | Notes |
|:---|:---|:---|
| **Windows** | ✅ System audio when sharing entire screen | User must check "Share system audio" |
| **macOS** | ⚠️ Tab audio only (sharing a tab) | System-wide audio requires BlackHole/Loopback |
| **ChromeOS** | ✅ System audio when sharing screen | Similar to Windows |
| **Linux** | ⚠️ Varies by distro/PipeWire vs PulseAudio | Often requires PipeWire for Chrome tab audio |

---

## 🛠️ Learnings from `framecut-editor`

| Aspect | Framecut Approach | Our Improvement |
|:---|:---|:---|
| **Storage** | `Blob[]` in RAM → crashes on long recordings | File System Access API → zero RAM |
| **Audio** | Screen audio OR mic, no mixing | Web Audio API mixer → both simultaneously |
| **Duration** | Manual "Infinity" hack (seek to `1e101`) | `fix-webm-duration` library → clean fix |
| **PiP Timer** | Canvas + `requestPictureInPicture` ✅ | Port directly — good pattern |
| **Events** | Tracks mouse/keyboard during recording | Port if Option 2 selected |

---

## Technical Architecture

### Encoding
**`MediaRecorder`** with `timeslice: 1000` (1s chunks).

| Mode | mimeType | Bitrate |
|:---|:---|:---|
| Audio Only | `audio/webm;codecs=opus` | 128 kbps (configurable) |
| Video + Audio | `video/webm;codecs=vp9,opus` | 2.5 Mbps video + 128 kbps audio |

### Storage: File System Access API

```
User clicks "Start" → showSaveFilePicker() → FileSystemWritableFileStream
→ MediaRecorder.ondataavailable → writer.write(chunk) → repeat
→ On stop: fix-webm-duration(blob) → writer.close()
```

> [!WARNING]
> **Crash Recovery**: Data is written to a temp file until `close()`. If the tab crashes before `close()`, the file is lost. Mitigation: implement **file rotation** (close + open a new file every N minutes) so at most N minutes of data is lost.

**Fallback chain**: File System Access → OPFS → Blob download.

### Input Mixing (Web Audio API)

```
getUserMedia (Mic) ──→ MediaStreamSource ──→ GainNode ──┐
                                                         ├──→ Destination ──→ MediaRecorder
getDisplayMedia (Sys) ──→ MediaStreamSource ──→ GainNode ──┘
```

- Individual **GainNode** per source → user-controllable volume.
- For Video mode: combine display video track + mixed audio destination into one `MediaStream`.

---

## 2 Integrated Options

### Option 1: "Performance-First Recorder" ⭐ Recommended
> MediaRecorder + File System Access + Audio Mixer + PiP Timer

| | |
|:---|:---|
| **Modes** | Audio Only / Video + Audio toggle |
| **Storage** | Continuous disk save with file rotation |
| **Audio** | Mic + System mixed via Web Audio API with per-source gain |
| **UX** | PiP timer, `suppressLocalAudioPlayback`, device selector |
| **Post-process** | `fix-webm-duration` on stop |
| **Effort** | ~3 days |

### Option 2: "Framecut Pro"
> Option 1 + Event Markers + Metadata JSON

| | |
|:---|:---|
| **Extras** | Records mouse/keyboard events as `.json` sidecar file |
| **Use case** | Feed into FrameCut editor for auto-spotlight/editing |
| **Effort** | ~4-5 days |

---

## Decision Matrix

| Criteria | Option 1 | Option 2 |
|:---------|:--------:|:--------:|
| Memory safety | ✅ | ✅ |
| Crash resilience | ✅ File rotation | ✅ File rotation |
| Audio quality | ✅ Mixed + gain | ✅ Mixed + gain |
| Feature scope | ⚡ Balanced | ✅ Rich |
| Complexity | ⚡ Medium | 🐢 High |
| Integration with FrameCut | ❌ None | ✅ Direct |

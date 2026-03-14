# Implementation Plan: Option 2 — Framecut Pro

## Goal

Everything in [Option 1](file:///Users/weijingliunyu/.gemini/antigravity/brain/226dff56-e816-4389-b30a-9613d1f023a0/implementation_plan.md), **plus** a real-time user event tracker that records mouse/keyboard actions as a `.json` sidecar file for later use in FrameCut editor (auto-spotlight, auto-zoom).

> [!IMPORTANT]
> **Read Option 1 first.** This plan only describes the **delta** — what's added or changed on top of Option 1.

---

## Proposed Changes (Delta from Option 1)

### Event Tracking Engine

---

#### [NEW] [event-tracker.ts](file:///Users/weijingliunyu/innosage-hub/products/innosage-tools/app/recorder/lib/event-tracker.ts)

##### `EventTracker`
- Listens to global `mousemove`, `mousedown`, `keydown`, `blur`, `focus` events (same pattern as `framecut-editor/hooks/useScreenRecorder.ts` lines 174-273).
- Stores events in `RecordingEvent[]` array:
  ```ts
  type RecordingEvent = {
    type: 'move' | 'click' | 'keydown' | 'window_blur' | 'window_focus';
    time: number;      // seconds since recording start
    x?: number;        // viewport % (0-100)
    y?: number;        // viewport % (0-100)
    key?: string;      // for keydown
  };
  ```
- `mousemove` capped at 30 FPS (33ms debounce) to limit array growth.
- Coordinates normalized to viewport percentages (0-100) for screen-size independence.
- `start()` / `stop()` → attaches/detaches listeners.
- `getEvents()` → returns the array.
- `getMarkers()` → returns only `click` events (for FrameCut spotlight generation).
- `exportJSON(filename: string)` → creates a `Blob` of `JSON.stringify(events)` and downloads it.

**Improvement over Framecut**: Framecut stores events in a ref and only uses them internally. We **export as a standalone `.json` file** so it can be loaded into any editor.

---

#### [MODIFY] [recording-engine.ts](file:///Users/weijingliunyu/innosage-hub/products/innosage-tools/app/recorder/lib/recording-engine.ts)

- Add `enableEventTracking: boolean` to `RecordingConfig`.
- On `start()`: if enabled, create an `EventTracker` and call `tracker.start()`.
- On `stop()`: call `tracker.stop()`, auto-save `tracker.exportJSON()` alongside the `.webm` file.
- Emit `'marker'` event when a click is captured (for live UI counter).

---

### UI Components (Delta)

---

#### [NEW] [EventOverlay.tsx](file:///Users/weijingliunyu/innosage-hub/products/innosage-tools/app/recorder/components/EventOverlay.tsx)

Live visualization during recording:
- Shows a fading dot at each click position (CSS animation, auto-removes after 1s).
- Shows a running counter: "🖱 12 clicks · ⌨ 34 keys".
- Props: `events: RecordingEvent[]`, `isRecording: boolean`.

#### [MODIFY] [page.tsx](file:///Users/weijingliunyu/innosage-hub/products/innosage-tools/app/recorder/page.tsx)

- **Setup State**: Add a toggle: "📊 Track mouse & keyboard events" (default: off).
- **Recording State**: If enabled, show `EventOverlay` with live click/key counters and marker count.
- **Done State**: Show two files saved: `recording.webm` + `recording-events.json`. Add a note: "Load events into FrameCut for auto-spotlight editing."

---

### FrameCut Integration Format

The exported `.json` file uses the **exact same `RecordingEvent` schema** that FrameCut already uses internally (see `framecut-editor/types.ts` → `RecordingEvent`). This means:

1. User records with InnoSage Recorder (Option 2).
2. Opens FrameCut Editor → imports `.webm` + `.json`.
3. FrameCut auto-generates spotlight markers from click events.

No FrameCut code changes needed — the format is already compatible.

---

## Verification Plan

### All Option 1 tests apply, plus:

1. **Event Recording**: Record 30s with event tracking enabled → perform 5 clicks and type "hello" → stop → verify `events.json` contains exactly 5 `click` events and 5 `keydown` events with correct timestamps.
2. **Coordinate Accuracy**: Click top-left corner → verify event has `x ≈ 0, y ≈ 0`. Click center → verify `x ≈ 50, y ≈ 50`.
3. **FrameCut Import**: Load the exported `.json` into FrameCut → verify spotlight markers appear at correct timestamps.
4. **Performance**: Record for 5 min with event tracking → verify minimal memory growth (events array stays under 50k items at 30 FPS mousemove cap).
5. **Toggle Off**: Record with event tracking disabled → verify no `.json` file is saved.
6. **Gate**: `npm run lint && npm run build` passes.

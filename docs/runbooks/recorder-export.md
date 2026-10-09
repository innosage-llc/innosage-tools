# Recorder export contract and checks

Audio export selects one encoder contract shared by recorder, picker, filename
and Blob metadata. Prefer explicitly supported `audio/mp4;codecs=mp4a.40.2`
(AAC in MP4, `.m4a`); otherwise use `audio/webm;codecs=opus` (`.webm`). Generic
`audio/mp4` support alone is not evidence of AAC. Unsupported codecs produce a
visible error, never a relabeled WebM file. Audio Only includes no video track.
Video retains the existing native WebM encoder and bitrate policy.

Stop waits for the final data event, serialized writes and successful file close.
Capture tracks stop immediately, independently of slow disk finalization. Save
errors are visible and never produce a success state. Cancel in the save picker
does not start recording. Pause time is excluded from the active timer.
Permission-probe streams are stopped after device enumeration.

## Memory and duration

AAC uses native browser finalization. WebM reserves a Float64 Duration in the
first Info element and patches eight bytes at Stop. Header reads are bounded to
64 KiB; the Segment remains unknown-size and media bytes are not rewritten.
Unexpected/truncated/indexed headers fail visibly instead of silently pretending
to finalize. No recording-length remux/transcode or server upload is introduced.

Direct disk does not retain completed chunks. Additional pending writes are
bounded to 16 MiB; one oversized browser delivery can pass without copying when
the queue is empty. Browser capture and native file-writing buffers are outside
this application bound. Disk backpressure stops with an error rather than hiding
lost chunks. This does not promise unlimited browser/OS memory or recording time.
The download fallback retains a single set of chunks with a 256 MiB ceiling;
long recordings should use native direct disk saving. A download request cannot
prove that the user kept/completed the browser download.

Known-duration synthetic acceptance tolerance: absolute duration error <=1 second
for a 60-second recording; paused intervals must not enter playback duration.
Reopen saved bytes, seek middle → beginning → near end, and verify playback, not
just changes to a time widget. Test browser and at least one desktop player.

## Repeatable verification

```sh
npm run test:recorder
bash scripts/gatekeeper.sh
node scripts/verify-recorder-browser.mjs <STAGING_RECORDER_URL> aac 60
node scripts/verify-recorder-browser.mjs <STAGING_RECORDER_URL> webm 60
```

The optional browser harness requires `agent-browser`, `ffprobe` and `ffmpeg`.
It generates a WebAudio tone locally, exercises the actual recorder UI, verifies
container/codec/audio-only/duration independently, fully decodes, then reopens
saved files and plays after forward/backward seeks. It covers a 60-second disk
case and a paused download case. It saves synthetic files only in a fresh OS
temporary directory, never Git. It forces WebM only to test unsupported-AAC
fallback. Its injected picker uses a real OPFS writable stream; **this is not
native OS save-dialog acceptance**. Separately test the native picker in a headed
isolated browser and open both output formats in VLC or another compatible player.

Unit tests cover encoder selection, bounded header reads, ordered asynchronous
writes, empty output, picker cancellation, write/close errors, delayed failures,
immediate Stop, pause/resume, repeated engines, backpressure and buffer limits.
Do not claim multi-hour/browser-background resilience from a one-minute test:
additional bounded synthetic soak evidence and manual browser coverage should be
identified separately. Never test with private recordings or upload recordings.

Release uses [Tools deployment](tools-deployment.md): exact merged staging
candidate, Founder verification, then separately authorized production promotion.

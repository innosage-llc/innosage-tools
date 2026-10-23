# Visual Remix local motion export

The editor lazily loads the existing FFmpeg-WASM runtime only after Export MP4.
It uses the exact applied PNG Blob from the Scene controller, with no second Scene
renderer. The encoded video is 1080×1440, 24 fps and five seconds: a 0.5-second fade
from the applied background followed by a stable hold. H.264/libx264 ultrafast,
CRF18, yuv420p and faststart reuse the installed codec. MP4 is lossy, so decoded
pixels are not byte-identical to PNG. There is no audio or timeline editor.

## Lifecycle and limits

A separate motion lifecycle binds results to project ID, authority generation and
applied revision. Apply, Undo, project replacement and revoke invalidate old video
and cancel active work; draft-only changes do not. One encoder can run at a time.
Cancel terminates the worker. Loader abort checks cover asynchronous module loading
and decompression before worker startup. Worker and WASM Blob URLs are released
in finally; preview/download URL ownership follows the editor's existing cleanup.
Encoding failure leaves the applied PNG and any same-revision good video intact.

The shared `local-ffmpeg-browser.ts` helper is extracted from Video Scissors,
which retains its renderer commands. It loads same-origin assets from the existing
`/tools/video-scissors/ffmpeg/` distribution. No remote upload or new codec package.
The binary is 32,129,114 bytes; gzip transfer is 10,228,358 bytes. These are file
sizes, not measured peak runtime memory. Peak WASM allocation was not measured.

Input PNG is capped at 10 MiB; output is capped at 32 MiB. Encoding has a 120-second
FFmpeg timeout and output metadata verification has a 15-second timeout. Network
load time is additional and cancellable. Output must be nonempty and browser-
verified as 1080×1440 / approximately five seconds before it becomes downloadable.
Unsupported decompression or H.264 playback produces a desktop-browser fallback
message while PNG remains usable. Transparent backgrounds are explicitly rejected
for MP4 with advice to apply an opaque background or retain PNG; #RRGGBBFF is
normalized to its opaque RGB value. No implicit black matte is introduced.

## Actual browser proof

`npm run test:visual-remix-motion-browser` executes actual WASM on the exported
route, saves an MP4, plays/seeks it and reads decoded frames through Canvas.
Chromium 151.0.7922.34 encoded the control Scene in 2,835 ms (including local runtime
startup and verification, following a canceled load), producing 217,181 bytes.
This is one warm local control measurement, not a mobile SLA or actual reference
reconstruction timing. Duration was 5 seconds at 1080×1440. First frame is the
intended pale background; midpoint/final text is legible with no unintended black
frame. Final RGB mean absolute error against PNG was 2.36185/255; mid/final hold
error was 0.000173/255. Actual first/final pixels were inspected.

The same test proves no runtime request before explicit video action, cancel of a
real runtime load with unchanged PNG, stale video removal on revoke and unsupported
processor fallback with unchanged PNG. Requests were same-origin GET/HEAD, with zero
external requests. Offline lifecycle tests cover overlap prevention, cancellation,
late completion, failure preservation and transparent-background messages; these
run in the native gate. Existing editor route and Video Scissors unit tests remain
passing (native-FFmpeg optional test skipped because native binary is unavailable).

Evidence and exact hashes live in ignored `.deploy/visual-remix-motion/`. This
control Scene is not agent vision reconstruction. Original-image journey, timed
reuse, final staging and live MCP remain separate acceptance work.

## Runtime attribution

Public `third-party-notices/ffmpeg-runtime.txt` distinguishes the MIT wrapper from
the GPL-enabled @ffmpeg/core 0.12.6 binary. It includes installed package integrity,
npm-reported source/build recipe and dependency source pointers; full GPLv2 and
upstream MIT notices accompany it and the editor links there. The upstream wrapper
LICENSE blob identity is recorded because the npm package omits the file. The core
recipe provenance discrepancy (package source says 0.12.5) is disclosed; no
byte-reproducible-build or broad legal-compliance claim is made. Existing Konva
notice remains intact. No new binary or license selection is introduced.

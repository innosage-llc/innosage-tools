# Video Scissors local processing

Video Scissors inspects and processes a user-selected MP4 entirely in the
browser. The source is never modified. Clip intervals remain relative to the
original source and are concatenated in the listed order. Every output is
re-encoded as H.264/AAC; it is not lossless. The page does not send media to an
API, account, storage service, analytics endpoint, or third-party CDN. The only
runtime fetches are same-origin requests for the local FFmpeg JavaScript and
compressed WebAssembly assets.

## Experimental #346 control boundary (local candidate only)

The separate Worker candidate can serve this same export and capability-enable
Gemini-authored connection/consent UI. Ordinary Pages has no such capability and
keeps local Cut/Undo usable. Only this opt-in candidate sends bounded same-origin
control/auth metadata; never filenames, media, blob URLs or output bytes. This is
not a zero-HTTP-body or zero-platform-telemetry claim. See
[the Worker contract](../../workers/video-scissors-mcp/README.md) for exact scopes,
30-minute project/token lifetimes, one-use proof, D1/KV revocation distinctions,
non-replay and known-result ACK recovery, background delivery and offline teardown.
Default config remains disabled. Local fixture PASS is not real ChatGPT, cloud
CPU/capacity qualification, production permission or Founder B acceptance.

## Limits and validation

The source must be at most 100,000,000 bytes, no longer than 300 seconds, and
contain H.264 video and AAC audio. Video must have at most 1,920 × 1,080 pixels
and 30 frames per second. Each plan contains 1–20 ordered clips, every range is
finite, positive, and within the original duration, and the combined output is
at most 300 seconds. Metadata is read from FFmpeg's input log; the file suffix
and browser MIME type are not treated as proof of its container or codecs.

Explicit `(attached pic)` input stream entries are cover art and are excluded
from video codec/size/fps validation. Every remaining real video stream must
still be H.264 and every audio stream AAC; unsupported primary or secondary real
codecs are rejected. Metadata uses the first real video and first audio. Both
inspection and rendering select those streams explicitly with `0:V:0` and
`0:a:0`; [FFmpeg's uppercase V selector](https://ffmpeg.org/ffmpeg.html#Stream-specifiers-1)
excludes attached pictures, thumbnails and cover art. A supported secondary
stream or picture cannot rescue an unsupported real primary.

The page retains the selected source and at most the current and immediately
previous generated outputs in memory. Undo has exactly one level: it applies
only to the latest completed cut and restores its previous plan and preview.
The first cut can be undone to the original; after two cuts, Undo restores the
first output and cannot step back again. Each completion replaces the Undo
snapshot and releases older output references. Accepted operation IDs remain
string-only tombstones for the controller's lifetime, even after cached results
expire, so an old ID cannot execute a second cut or Undo with a fresh version.
Cancellation terminates the FFmpeg worker, and canceled or failed work does not
replace the previous preview or plan. Temporary virtual files exist only in
the current worker's in-memory filesystem. Closing or reloading the tab loses
the editing session; downloads are explicit and are not removed by Undo.

Audio is normalized with `aresample=async=1:first_pts=0` before slicing, so a
stream that starts at 1.978 seconds retains that leading silence. `apad` before
`atrim=start=…:end=…` fills trailing gaps through each requested interval, then
the clipped audio timestamps reset to zero. Video trims on the same original
input timeline and subtracts the requested start from PTS rather than moving
its first retained frame to zero. FFmpeg's common input timestamp adjustment
is shared by both streams; their start offsets are not reset independently.
The focused native FFmpeg regression checks delayed onset, content position,
and exact padded audio duration for cuts starting at zero and one second.
The host browser/WASM delayed-audio fixture is still required before acceptance.

## Runtime assets

Run `npm run prepare:video-scissors` after dependency installation to copy the
locked `@ffmpeg/ffmpeg` ESM JavaScript files and `@ffmpeg/core` loader into the
ignored `public/video-scissors/ffmpeg/` directory. The script gzip-compresses
the core WASM to keep the deployed asset below the Cloudflare Pages per-file
limit. `npm run build` runs this preparation through `prebuild`. Local development
can run the prepare command once before starting Next.js.

The WASM is decompressed in the browser and passed to the FFmpeg worker through
a Blob URL. The worker and core loader are served from the same origin; no
external runtime URL is configured. This relies on the host serving `.wasm.gz`
as a static asset (the browser code decompresses it explicitly, so no special
Content-Encoding behavior is required).

## Checks

The milestone A reference fixture is a 60-second 640×360, 24 fps H.264/AAC
synthetic MP4. Cutting 10–25 then 40–50 seconds must yield a 25-second file,
with clip timing and audio/video duration differences within 0.15 seconds.
The reference desktop budget is 30 seconds for that cut after source inspection;
local Chrome 155 measured 3.642 seconds. This is a reference measurement, not a
latency guarantee for every machine or the maximum 100 MB / five-minute input.
Maximum size/duration rejection uses deterministic boundary tests; a full
maximum-size performance qualification is not part of this milestone.

The browser fixture also checks reversed clip order, delayed audio onset, Undo,
cancel then explicit retry, processor-load failure then reselection, source hash
preservation and same-origin requests without media uploads or application sockets.
It generates a paired MP4 with synthetic blue MJPEG attached cover art and
verifies that a two-second browser/WASM cut contains the primary red video and
440 Hz audio, then verifies Undo. Parser regressions cover picture-before-main
ordering and retain unsupported primary/secondary codec and missing-audio guards.
Run it against an already running dev/static server or the exact staging origin:

```sh
# Use an existing Playwright install; set these paths for your environment.
VIDEO_SCISSORS_PLAYWRIGHT_MODULE=<installed-playwright-module> \
VIDEO_SCISSORS_CHROME=<desktop-chrome-executable> \
node scripts/video-scissors.e2e.mjs https://<preview-origin>
```

For staging, set `VIDEO_SCISSORS_EXPECTED_REVISION` to the merged commit. The
fixture verifies `/tools/release.json`, records source/browser identity, and
keeps synthetic downloads and screenshots under ignored `.deploy/`. For local
development first run `npm run prepare:video-scissors`, then start Next.js using
an unoccupied loopback port. The local test default is port 3450.

Run the deterministic controller tests with `npm run test:video-scissors` and
the product TypeScript check with `npx tsc --noEmit`. Before release, the host
must also run the generated WASM against the supplied synthetic fixture in a
real browser, confirm clip content/order/duration/audio sync, validate the
same-origin runtime asset URLs and privacy boundary, and inspect a production
build. Node tests do not establish actual browser/WASM media correctness.

The production synthetic input can be generated with
`node scripts/video-scissors-fixture.mjs`. It uses local FFmpeg filters and
contains no recordings or external downloads.

## Third-party source and license references

- [ffmpeg.wasm source](https://github.com/ffmpegwasm/ffmpeg.wasm) and its
  [MIT license](https://github.com/ffmpegwasm/ffmpeg.wasm/blob/main/LICENSE).
- The installed `@ffmpeg/ffmpeg` wrapper and `@ffmpeg/core` package metadata
  identify those packages as MIT licensed. The core contains the FFmpeg
  WebAssembly build; consult the [FFmpeg license and legal guidance](https://ffmpeg.org/legal.html)
  for FFmpeg and codec build licensing. Do not infer that every codec or linked
  component is covered by the wrapper package's MIT license.
- Installed dependency versions are locked in `package-lock.json` and
  `pnpm-lock.yaml`; the asset preparation script copies the installed locked
  files and does not fetch code at build or runtime.

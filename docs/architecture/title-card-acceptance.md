# #79 local acceptance record

This is a local implementation candidate, not a delivered Master or real-host PASS.
Product base: `350c7ea81c2a8e58d3c186b018002b9b2ad73703`.
Topic: `codex/master-79-title-card`. Parent Hub worktree/base and the separate
compatibility commit remain recorded in the Hub session directory.

Checked: repository `scripts/gatekeeper.sh` PASS (including Worker38/38), root
TypeScript, lint (warnings, no errors), production export, SEO and ASSETS. The first
separate Worker run failed D cleanup with a response-body-read error; the same
test then passed alone, the complete D suite passed17/17, and full Gatekeeper
passed without a D code change. Preserve that initial failure in the private log.
Controller tests16 passed/1 optional native FFmpeg skipped; remote tests13/13.
Actual browser/WASM six-preset check and offline iframe gallery check both PASS.
UI generation/repair receipt: `title-card-ui-receipt.json`.

| Acceptance | Local evidence / remaining gate |
| --- | --- |
| AC01 host reality | Inline resource and offline iframe contract; actual ChatGPT Web is unrun. Computer Use blocked the authorized conversation URL; no browser/session workaround. |
| AC02 scoped explicit choice | Canonical six-ID schema; read/edit OAuth scopes unchanged; existing mailbox ownership/version/revoke/expiry fences; adapter dedup and command privacy tests. |
| AC03 actual media | `node scripts/video-scissors-covers.e2e.mjs`: all six actual shipped WASM renders passed, 5.5-second H.264/AAC outputs from 4 seconds of clips + 1.5-second silent card. |
| AC04 palette/Unicode | Shared palette; local Canvas with CJK system fonts. Encoded synthetic Chinese/English title frames inspected in `.deploy/video-scissors-covers/encoded-cards.png`. |
| AC05 replacement/Undo | Controller tests and actual WASM sequence render all six from the same original/plan; Undo restores Lavender bytes/preset after Sunrise. |
| AC06 races | Existing cancellation/stale/replay tests; cover cancellation cannot commit late output; gallery uncertain dispatch remains pending until read-only status reconciliation. |
| AC07 privacy | Strict remote-command allowlist rejects title/path/media fields. Actual WASM fixture permits only same-origin GETs; no external requests or media uploads. |
| AC08 constraints | Existing limits unchanged; intro + clips must be ≤300 seconds; over-limit renders rejected visibly. Existing cut/Undo/OAuth regression gates apply. |
| AC09 local download | Controller returns actual encoded MP4 Blob through existing download path; gallery points to local editor. Browser download journey still needs staged host acceptance. |
| AC10 exact main/staging | Unrun. No PR, merge, Pages or experimental Worker deploy. Required existing CLI authentication is invalid; no identity switch attempted. |
| AC11 Founder packet | Three staged journeys below; stop for acceptance once exact candidate is available. |
| AC12 production/closure | Unrun; distinct release gate. Master remains open. |

Reproduce local media checks after `npm ci`, worker dependencies and
`npm run prepare:video-scissors`. Use `VIDEO_SCISSORS_CHROME` only to select an
already-installed Chrome executable. The test uses a fresh isolated browser,
the public synthetic fixture and a temporary localhost server. No native FFmpeg
installation is needed. The original optional native-FFmpeg test is skipped on
this Mac because the binary is absent; that skip is not a pass.
Run the gallery contract with `node scripts/video-scissors-gallery.e2e.mjs`.

Artifacts are ignored local files: six `.mp4` outputs, `evidence.json` containing
codec/duration/frame/audio measurements and the complete synthetic request list,
and an encoded-frame screenshot. They contain no real recording or real filename.
Local tests do not authorize or demonstrate cloud release or actual host behavior.

## Three staged Founder journeys (pending)

1. Load the synthetic MP4 in Video Scissors, connect the exact candidate A Worker,
   show gallery in ChatGPT Web, choose Sage, Apply, wait for completed, and download
   the actual MP4 in the editor. Check card, silent intro, footage and audio.
2. Select Ocean without Apply: no edit. Apply it: duration stays unchanged (one
   card). Undo in the editor restores Sage and the exact prior output.
3. During an Apply, cancel or disconnect; recover by status, preserving last good
   output without a second mutation. Revoke/expire and verify further edits fail.

Before a live MCP run, record exact candidate SHAs/artifact hashes, synthetic
fixture identity, bounded call count/time/cost, cleanup and available usage snapshot
(UNKNOWN when unavailable), then obtain the required per-run approval. Founder
staging acceptance and production promotion remain separate from this run approval.

Draft Meeting Recipe needs no implementation here: reuse the same canonical preset
identity → illustrative preview → explicit scoped Apply → terminal completion
contract, keeping its existing document permissions and data plane separate.

# Video Scissors MCP staging check

This is a manual check for the existing synthetic single-cut → Undo-to-original
flow. It tests one staging arm per run and is not wired into default CI.

Install project dependencies without downloading a browser with
`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci`. The runner uses the installed
Google Chrome application on macOS; set `VIDEO_SCISSORS_CHROME` only when Chrome
is elsewhere. It uses `ffprobe` from PATH or `VIDEO_SCISSORS_FFPROBE`.

Run only the already authorized staging target, selecting its fixed arm:

`npm run test:video-scissors-mcp-e2e -- --arm d1`

Use `do` instead of `d1` for the other existing staging arm. The runner rejects
production, arbitrary origins, missing arms, and extra arguments. Help and no
arguments only print usage. Each live invocation creates one synthetic OAuth
client and project, intercepts the mock client's PKCE callback locally, waits
120 seconds with the app tab hidden, performs one 2-second cut, downloads and
checks the H.264/AAC output with ffprobe, then Undoes to the original preview and
explicitly disconnects. It uses a fresh headed Chrome profile over CDP and
removes that profile during cleanup.
An unconfirmed browser-stop or profile-removal result fails the run.

The ignored `.deploy/video-scissors-mcp-e2e-<arm>-<UTC>.json` report contains
UTC phase windows and monotonic elapsed time. Request starts are assigned to the
phase where the client starts them; responses are assigned separately to the
phase where the client receives them. Cross-phase completions are counted
separately, and these client counts are not server or billing totals.

The report labels local runner Git revision and script hash separately from
deployment identity. Target deployment version and source revision remain
`UNKNOWN` unless an existing operator readback is available; this runner does
not query a new endpoint. It records the fixture hash and correctness/status
only. OAuth values, IDs, proof, callback contents, media, private paths,
screenshots, traces and HAR files are not retained. Browser requests are
restricted to the selected origin and the locally intercepted callback;
request bodies are inspected in memory for media or local-path leakage.

The original preview assertion requires the exact “Original video preview”
label, a 60-second `blob:` source and `readyState >= 1`. Browser-local `blob:`,
`data:` and `about:` URLs are excluded from the network-request audit; HTTP(S)
requests remain subject to the body and URL checks. In the DO arm, close 1000
`disconnected` and 1008 `project-revoked` are accepted only when clean and
observed after explicit revoke during disconnect cleanup. Every WebSocket
error and every other close remains a failure.

One bounded DO smoke was attempted on 2026-10-17. It reported `FAIL` with
`PRIVACY_AUDIT_FOUND_MEDIA_OR_LOCAL_PATH`; cut, download/ffprobe, Undo-to-original,
explicit revoke and temporary-profile cleanup completed. The first audit counted
local `blob:` preview URLs as network markers; that classification is corrected
above, but the smoke was not repeated. Its redacted report is
`.deploy/video-scissors-mcp-e2e-do-20261017T014534137Z.json` (63 request starts,
59 completed responses). Existing operator readback identified the target as DO
staging B version `fce5281b-e45e-498d-ac4e-3ccde3816f43`; the runner revision
`502e4066b78454b7c6f0cdc7a0f2ac46f5d44a9c` and source hash
`ba22cc9de573c651ade88af7df3c21d63cde557b0f1a406f80b4157ecf49d995` identify
the local runner only, not the deployed Worker.

The offline regression is `npm run test:video-scissors-mcp-e2e:offline`; it is
included in Gatekeeper. It exercises argument rejection, preview readiness,
report redaction, local-scheme exclusion, close classification and request
start/response accounting without loading Playwright or making network requests.

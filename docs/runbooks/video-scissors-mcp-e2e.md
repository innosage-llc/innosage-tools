# Video Scissors MCP matched staging check

This is a manual, one-arm-per-run check for the locked first matched round
across A/B/D. It is not part of default CI. No run is authorized by this
runbook alone; follow the separate disabled-provision and enabled-test approvals
in `workers/video-scissors-mcp/docs/stateless-do-candidate.md` before any live
request.

Install project dependencies without downloading a browser with
`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci`. The runner uses the installed
Google Chrome application on macOS; set `VIDEO_SCISSORS_CHROME` only when Chrome
is elsewhere. It uses `ffprobe` from PATH or `VIDEO_SCISSORS_FFPROBE`.

After the exact approval for the selected arm, run only its fixed target:

```sh
npm run test:video-scissors-mcp-e2e -- --arm d1
npm run test:video-scissors-mcp-e2e -- --arm do
npm run test:video-scissors-mcp-e2e -- --arm d
```

Run the three arms sequentially in the approved same-day comparison window,
with a five-minute quiet baseline before each. Each additional live round needs
explicit approval and must fit the existing request/project limits. There is no
one-journey-per-UTC-day procedure gate or mandatory wait for UTC rollover. Never
reset counters or silently raise limits to fit a retry.

The runner allowlists only these three origins; arbitrary targets, production,
missing arms, and extra arguments fail closed. D uses the isolated
`https://video-scissors-mcp-d-staging.innosage-draft.workers.dev` origin and
the same existing “Connect experimental ChatGPT control” button as A/B. A run
uses one synthetic OAuth project and the scripted PKCE/JSON-RPC MCP client;
the OAuth callback is intercepted locally. Real ChatGPT Web and Gemini Web are
not exercised.

## Locked first matched round

All three arms use the same 60-second synthetic H.264/AAC source and this exact
sequence:

1. Hide the Video Scissors tab for 120 seconds before any cuts.
2. Cut1 keeps source seconds 2–4 (2 seconds); verify the clip plan and output.
3. Cut2 keeps source seconds 6–10 (4 seconds); verify the clip plan and output.
4. Undo2 targets Cut2; verify the restored clip plan and MP4 bytes match Cut1.
5. Disconnect/revoke, verify clean wake-socket closure where used, and require
   the old OAuth token's project read to return `PROJECT_EXPIRED_OR_REVOKED`.

There are exactly three mutating MCP commands: `cut`, `cut`, `undo`. There is
no final Undo-to-original, reconnect, or second project in this matched round.
The 120-second hidden-idle window remains before the cuts for every arm and is
recorded in the report; Cut1 completion is also required while the app tab is
still hidden. Per-operation elapsed time is measured from the
scripted mutation request through browser-reported completion and completed
MCP status. Delivery time and local browser compute time are not separated and
remain unknown. The report also preserves individual MCP-call and phase
timestamps. Each operation registers an ID-matched completed browser-report
wait before enqueue (90 seconds), then verifies server status; it does not
assume video processing completes within a short polling interval.

The ignored `.deploy/video-scissors-mcp-e2e-<arm>-<UTC>.json` report uses schema
version 2 for this scenario. It distinctly labels headed-browser execution,
the scripted OAuth/MCP client, and real ChatGPT/Gemini Web (`NOT_RUN`). It
records cut output duration/codec/size/hash, Cut1 and Undo2 plans, plan/hash
equality, the D-only revoke HTTP status/`ok`/`closedSockets` result, hidden-idle
duration, operation timings, and request-phase accounting. It does not record
operation IDs, OAuth values, proof, callback contents, raw revoke bodies, or
media bytes.

The report labels local runner Git revision and script hash separately from
deployment identity. Target deployment version and source revision remain
`UNKNOWN` unless an existing operator readback is supplied; the runner does
not query a new endpoint. Browser requests are restricted to the selected
origin and the locally intercepted callback. Same-origin and blocked request
bodies are inspected in memory for media/local-path markers, media content
types, and oversized control bodies; content and headers are not retained.
Browser-local `blob:`, `data:`, and `about:` URLs are excluded from the
network-request audit. No screenshots, traces, or HAR files are saved.

In DO arms, close 1000 `disconnected` or the arm-specific 1008 reason (B:
`project-revoked`; D: `project-ended`) is accepted only when clean and observed
after explicit revoke during disconnect cleanup. Cross-arm or unknown reasons
remain failures. D's expected reason comes from `ProjectStateDO.closeSockets`;
offline tests reject the wrong arm, early closure and unclean closure.
Every WebSocket error and every other close remains a failure. D additionally
requires HTTP 200 with `{ ok: true, closedSockets: N }` where `N` is a
non-negative integer; only those bounded fields are retained.

Keep the origin/media privacy audit and browser traffic bounded. The existing D
application limits are at most 200 admitted D Worker HTTP requests and 2
project-creation attempts per UTC day. The 200-request limit is an application
admission limit, not a Cloudflare
spend cap or account-quota measurement. Daily Durable Objects headroom remains
UNKNOWN under the [accepted #358 waiver](https://github.com/innosage-llc/innosage-hub/issues/358#issuecomment-6233242829)
and is not a blocker for this named bounded experiment. Do not perform further
generic quota probing. Stop on a
budget/quota error, counter failure, privacy failure, or request outside the
reviewed origin.

The offline regression is `npm run test:video-scissors-mcp-e2e:offline`; it
tests fixed-arm allowlisting, preview readiness, D revoke-response shape,
report redaction, local-scheme exclusion, socket-close classification, and
request start/response accounting without loading Playwright or making network
requests. The known unrelated A/B `integration.test.ts` visibility failure is
unchanged and is not presented as D evidence.

Historical reports remain historical. Existing schema-v1 reports, including
older one-cut/Undo-to-original or four-command journeys, retain their original
meaning and must not be relabeled or compared as this matched scenario. The
2026-10-17 DO smoke remains a historical `FAIL` on the then-overbroad local
`blob:` privacy classification; the classification was corrected afterward,
but that smoke was not repeated. Its redacted report remains
`.deploy/video-scissors-mcp-e2e-do-20261017T014534137Z.json` (63 request
starts, 59 completed responses). The captured B version and runner/script
identity in that report identify only that historical observation, not the
current deployment or this runner.

The first matched live D round on 2026-10-18 completed both cuts, byte/plan
restoration, revoke and old-token denial but retained overall `FAIL` at socket
close auditing. The old audit accepted only B's reason and redacted D's reason
to `other`. This arm-specific correction is for future runs; that original
live report is not relabeled PASS, and no second live journey is authorized by
this fix. Exact raw reason attribution for that old report is unavailable.
A local peer-close observation attempt timed out; it is not runtime proof.

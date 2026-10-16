# Video scissors MCP — LOCAL candidate, deployment disabled

Hub #346 / parent #344. No application Durable Object. Exact source references:
Cloudflare Agents example `f56cd20dd58dc88f4b76a601bcd94b9eabcd6661`;
OAuth provider 1.2.3 `602610ce1c11fdb412388713f66a4ca2a45c110d`.
Pinned Agents 0.28.1 / MCP server 2.3.1 / provider 1.2.3 in the nested lockfile.
Provider upgrade is intentional: use official consent helpers instead of the
example's static demo-user / form-carried base64 OAuth state. No such demo copied.

## Increment 1 boundaries

- `src/mailbox.ts` is internal behind official OAuth/browser credential routes. Primary
  D1 session, atomic admission/claim predicates include project/epoch/expiry/
  revocation; partial UNIQUE index permits one queued/claimed operation. Claims
  are an irreversible dispatch boundary, never timeout-released/replayed.
- Five-minute hashed possession proof is consumed by one atomic update plus
  UNIQUE consent-handle tombstone trigger. Tombstones remain for the cumulative
  experiment, including beyond project revocation; never reuse a consent handle.
  Route derives project from hashed proof/server state, not a form field.
- A queued command expires in at most 60 seconds. Claimed uncertain work stays
  active until owner-authenticated terminal acknowledgement. Cancel intent does
  not deny an already-known completion; actual cancelled/stale terminal state
  cannot revive. Revocation cannot reverse local work already dispatched.
- Browser adapter validates a whole cut before changing the controller plan,
  checks expected source generation/version then set/cut without async gap,
  inspects actual controller status, tracks UI/remote Cut/Undo in one history.
  Cancellation polling is a separate API from awaited rendering. Uncertain report
  retry must not execute again. New source clears latest target; controller/media
  lifetime and refresh-loss semantics remain unchanged.
- Strict metadata projection: duration, generation, version, hasOutput, canUndo,
  latestOperationId and error codes only. No filenames, blob URLs, paths/media.
- Queued retirement uses authoritative project metadata, never a delayed caller
  snapshot. Claim requires both snapshots to match. Controller changes publish
  monotonic metadata during outstanding polls; completed Cut/Undo publishes its
  updated latest target. A stale poll returns refresh without retiring fresh work.
- Main entry serves existing static ASSETS. MCP/OAuth/registration/project/
  discovery endpoints fail closed unless EXPERIMENT_ENABLED is explicitly true.
  Config defaults false and has placeholder local resource
  IDs, workers.dev disabled and no routes. DO NOT DEPLOY this foundation config.
  `test/fixture-worker.ts` is local-only, never imported by production entry.

## Budget and missing live integration

D1 cumulative counters permit at most 2,000 controlled HTTP requests, 20 OAuth
flows, 20 projects; initialization is INSERT OR IGNORE, not reset on redeploy.
Project lifetime is 30 minutes, not deployment lifetime. This does NOT guarantee
account-wide quota against arbitrary internet traffic. No public/load launch.
Official OAuthProvider and stateless MCP use a server factory per request, with
bounded authenticated browser transport and immediate long-poll renewal. Delivery
continues in an open hidden/background tab while the user
is in ChatGPT. Use bounded server HTTP long-poll, not hidden-page pause or reliance
on client interval timing; cancellation has its own bounded request while render
is pending. Background latency/finite-session expiry must be actually qualified.
The local mailbox implements at most 8 primary checks spaced 3 seconds apart,
up to 25 seconds: 24 mailbox SQL calls plus 2 fixture initialization/budget calls.
Each adapter claim/cancellation request has a 25-second abort signal. Successful
polls renew immediately, including hidden tabs; no hidden pause.
Credential stays in controller-lifetime MEMORY only, no persisted
profile/token URL. Reload/duplicate tabs create fresh projects. Best-effort unload
revoke never replaces server expiry. Shared free quota must be rechecked live.

The two UI artifacts are actual Gemini HIGH output; see Hub ui-receipt-01.json.
App wiring capability-gates the panel; ordinary Pages has no remote capability
endpoint. Official consent helpers own cookies/headers; the renderer escapes
client metadata and displays redirect host/scopes. DCR attempts are capped at20.
No McpAgent, demo state/user or homemade OAuth crypto; no Luna UI fallback.

Prototype control is binary: discovery/every tool advertises BOTH video:read +
video:edit, and consent must explicitly include both. No implicit scope addition,
read-only product mode or one-use-proof step-up. Per-action guards remain.
Access/refresh TTLs are1800s; DCR retains official default registration lifetime.
Client identity conveys no project authority; every token exchange/refresh checks
the current D1 project/epoch fence. Provider1.2.3 ctx.auth is mapped through the
documented Agents authInfo API (this pair lacks the newer automatic marker).
SDK2.3.1 registers only _meta schemes; a bounded, finite owned tools/list response
projection also exposes top-level securitySchemes for modern/2025 JSON/SSE clients.
Official issuer/iss/resource, PKCE S256 and registered redirect checks are tested;
no hardcoded historical ChatGPT callback allowlist.

Explicit UI Disconnect confirms the immediate D1 epoch fence. Native OAuth revoke
uses KV semantics, NOT a D1 fence or connector-removal notification; no promise
of global KV immediacy. Known terminal results keep at most one memory-only ACK
and retry the identical result before claiming again; duplicate ACK does not
reopen state/regress metadata. Uncertain compute never replays. Local Cut/Undo
retain controller history after disconnect. Component teardown unconditionally
aborts local polls/backoff/subscriptions even offline; unload revoke is best
effort only, not server-fence evidence. Lease expiry remains authoritative.

## Local evidence / stop

`npm test`: real local workerd/D1 independent HTTP request races, not JS SQL mocks.
Also official-provider/MCP negative flows and actual-adapter/D1 lost ACK before/
after commit. `npm run test:integration` is fresh Chrome + Gemini UI + synthetic
MCP caller + real WASM cut/download/Undo/revoke/privacy, NOT real ChatGPT evidence.
`npm run test:assets`: actual Wrangler local ASSETS with existing Tools export;
run AFTER root build in a fresh checkout. The root native gate installs this
isolated lockfile, checks types/tests, then builds and checks ASSETS. Compatibility
date 2026-10-13 is the latest supported by pinned local workerd (today's date was
rejected); do not claim a newer runtime was exercised.

`npm run test:background` uses fresh headed Chrome and the documented Playwright
CDP `noDefaults` option, avoiding focus emulation. It verifies actual visible →
hidden command delivery → visible, using synthetic controller rendering and real
local Workers/D1 HTTP, NOT a WASM/media or OAuth end-to-end claim. No personal
profile or persisted browser credential. Provide VIDEO_SCISSORS_PLAYWRIGHT_MODULE
and VIDEO_SCISSORS_CHROME if not installed on normal resolution paths.
Database duration and wall time are not Worker CPU. Free 10ms CPU qualification
is NOT RUN; a local query-cap pass is not approval for live deployment.

Local routing/consistency supports a provisional no-DO foundation result only,
not whole #346 PASS. Failure of the bounded no-DO attempt returns to lead for a
necessary-DO decision, never automatic fallback or a second parallel architecture.
No live resources/deploy, #347, production B, archive/reset in this increment.

## Staging operator stop / safe rollback

Provision/deploy only after lead engineering/operator approval; this is not a
new Founder approval gate. Keep the default config disabled. Later, derive an
ignored `.deploy` effective config from this reviewed template, changing only
the isolated staging name/workers.dev flag, approved EXPERIMENT_ENABLED value and
actual dedicated D1/KV IDs. Preserve main/schema/ASSETS/compatibility settings;
resolve relative paths against the source config directory. Bind its full hash,
source/bundle/export hashes and non-secret resource IDs in the task receipt. IDs
alone need no implementation PR; no new release framework or production route.

Before first enablement, record the exact disabled safe Worker version ID and
deployment ID. Stop the experiment by setting EXPERIMENT_ENABLED=false in that
same effective config and deploying the same reviewed artifact/bindings through
pinned Wrangler. Alternatively restore ONLY that recorded disabled safe version
using `wrangler rollback <SAFE_VERSION_ID> --config <EFFECTIVE_CONFIG>`; never
assume a previous enabled version is safe. Record actual restored version and
deployment identity. Existing Pages/proxy/production remain untouched.

Never delete/recreate/clear D1 or KV, rerun destructive schema initialization, or
reset experiment counters on stop/rollback/redeploy. Read back the same binding
IDs and preserved D1 budget rows; claims stay non-replayable. Negative readback:
fresh `/remote/projects`, browser poll and old-token `/mcp` requests must return
503/NOT_ENABLED while `/tools/video-scissors` and its static assets still serve.
Record those exact responses and identity, not merely deploy exit0. Disabling
server routes cannot reverse a browser operation already claimed; stop the owned
test connection locally too, with no claim of guaranteed reversal.

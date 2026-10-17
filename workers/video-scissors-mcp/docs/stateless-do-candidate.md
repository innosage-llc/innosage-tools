# Stateless MCP + per-project DO candidate (D)

D is an isolated, local-only candidate for the VideoCut MCP experiment. It does
not change the existing A/B entrypoint, routes, config, tests, or behavior. The
candidate config is disabled by default and describes workers.dev only.

## Authority and routing

- Browser project creation mints a private 256-bit credential. The stable
  project/SQLite Durable Object name is `SHA-256(credential)`, derived by the
  server. Browser control routes ignore the caller's project field for routing;
  they derive the DO name from the credential, then the DO verifies the exact
  stored project, epoch, owner hash, consent, and expiry.
- Short-lived HMAC tickets bind a purpose, project, epoch, and expiry. The
  signed project selects the DO only; the ticket is not authorization. The DO
  consumes a registered one-time consent/wakeup proof before acting. MCP
  requests use project/epoch props supplied by the official OAuth Provider
  after signature validation and are routed to that same per-project DO.
- The one-minute wakeup proof limits only the time to establish a socket. The
  serialized socket attachment carries the project lease expiry, so an
  established wakeup connection remains usable through that lease.
- OAuth Provider KV is only for provider-managed OAuth state. The per-project
  SQLite DO is the sole application authority for project metadata, consent,
  command/idempotency/uncertain-write state, leases, and Undo state. There is
  no application D1 binding or ledger.
- Admission and claim re-check live project, exact epoch, consent, expiry,
  revocation and source generation/version within the same SQLite transaction
  that inserts or claims. Undo is claimable only while its target remains the
  latest undoable operation. This is the linearization fence against a revoke
  or superseding operation that wins before the transaction.
- A committed command receipt remains authoritative if a best-effort WebSocket
  wakeup fails; status/reconnect recovers it and claim remains one-shot. Explicit
  revoke retains only a hashed owner receipt and original epoch in the bounded
  tombstone so the same owner can confirm a lost ACK; it restores no authority.
- Revoke/lease expiry clears credentials, tickets, consent handles, command
  payloads and metadata immediately, closes sockets, and leaves only a minimal
  tombstone. The alarm purges that tombstone after 31 minutes (30-minute
  OAuth lifetime plus one-minute grace); it never silently reuses a prior
  project. A new project gets a new random credential and DO name.

## Data boundary

Only allowlisted project metadata and bounded operation fields (operation ID,
generation/version, clip ranges, Undo target, cancellation/status) enter the
MCP/DO control plane. Media bytes, filenames, local paths, command output/logs,
and unrelated Draft data stay in the local browser and are not relayed or
persisted by D. The browser owns media processing and reports bounded results.

## Local D browser fixture evidence (2026-10-17)

The local-only browser fixture passed Cut 1 → Cut 2 → Undo 2 → disconnect →
fresh consent/reconnect → revoke. While authorization was pending, selecting the
local fixture caused a successful metadata sync with `consented: false`; the
page stayed in Awaiting Authorization with its one-time proof visible. After
OAuth approval, a consented sync completed and the UI connected. Undo restored
Cut 1's MP4 byte-for-byte and clip plan; reconnect created a new project, and
both revoked OAuth tokens and browser credentials were denied. It observed 69
browser-origin Worker HTTP requests plus 30 fixture-harness Worker HTTP requests
(99 total),
two local WebSocket wakeups, two project creations, and three commands. No media
bytes or local paths appeared in request bodies; the browser made no external
requests. This is a local request-count baseline, **not Cloudflare usage** and
not a measurement of ChatGPT's polling pattern or account quota consumption.
To replay locally, build the Tools assets first, then run
`npm run test:d:browser` from this package with
`VIDEO_SCISSORS_PLAYWRIGHT_MODULE` pointing to an installed Playwright module
and `VIDEO_SCISSORS_CHROME` pointing to a local Chrome executable. `ffprobe` is
also required. No Cloudflare account or deployment is used.

## Local verification limits

Actual Durable Object hibernation, WebSocket socket-attachment restoration,
and cold-instance recovery have **NOT** been verified in this local candidate.
The attempted Miniflare eviction test was unstable and is not evidence that
these behaviors pass.

## Future staging approval boundary

No Cloudflare resources, secrets, deployments, DNS, or production configuration
were created or changed for this local implementation. A separate staging
approval would need to authorize exactly:

1. One dedicated workers.dev Worker, `video-scissors-mcp-d-staging`, built from
   this candidate and kept disabled until explicitly enabled.
2. One dedicated OAuth-provider KV namespace (`OAUTH_KV`) for provider state.
3. One SQLite-backed `ProjectStateDO` namespace/class binding plus its D
   migration. D does not need or bind D1.
4. One D-only Worker secret, `D_ROUTING_HMAC_KEY`, containing a random 32-byte
   key (64 hex characters). It signs short-lived routing tickets and grants no
   access by itself.

No D1, custom domain, DNS, production Worker, shared A/B binding, or other
Cloudflare resource is part of that proposed minimal set. The existing A/B
staging Workers are not the D candidate: the read-only account settings check
on 2026-10-17 found `video-scissors-mcp-do-staging` still bound to D1, KV and
`VIDEO_BRIDGE`, and `video-scissors-mcp-staging` bound to D1 and KV. A separate
`video-scissors-mcp-d-staging` Worker was not present.

### Proposed staging guardrails (implemented locally; not approved or deployed)

- Keep the D Worker disabled until the exact deployment is approved. The source
  now enforces the candidate hard caps for one controlled test day: at most
  **200 D Worker HTTP requests** and **2 project-creation attempts per UTC day**.
  The local fixture's 99-request run is below this cap, but does not prove that
  real ChatGPT polling will fit. The Worker request counter is global across D
  projects and counts every HTTP request entering the D Worker while enabled,
  including static assets and a WebSocket upgrade once; later WebSocket frames
  are not HTTP requests. While D is disabled, static assets remain available
  without consuming the experiment budget. The request counter runs before
  OAuth KV, static asset, or project-state work; both counters fail closed with
  bounded `503` responses if unavailable and return bounded `429` responses at
  their caps. Project-creation attempts reserve their slot before generating a
  credential or creating per-project state; a downstream failure still consumes
  that slot, conservatively preventing retries from exceeding the cap. Deploys
  never reset the counters. Treat these as reviewable staging ceilings, not a
  measured forecast or approved production allowance.
- Both counters use one fixed-name SQLite object in the existing
  `ProjectStateDO` class/namespace. A single bounded singleton row stores the
  UTC day and counters; `transactionSync()` serializes daily rollover and the
  limit check/increment. This adds no D1 or second DO class binding. The shared
  object intentionally serializes only the low-volume experiment admission
  path.
- Cloudflare's current published Free ceilings are 100,000 Worker requests/day;
  100,000 KV reads and 1,000 writes/day; and SQLite DO 5 million rows read,
  100,000 written/day, with 5 GB total storage. See [Workers limits](https://developers.cloudflare.com/workers/platform/limits/),
  [KV limits](https://developers.cloudflare.com/kv/platform/limits/), and
  [SQLite DO pricing and limits](https://developers.cloudflare.com/durable-objects/platform/pricing/#sqlite-storage-backend).
  Limits are account-shared and daily reset at 00:00 UTC. These are ceilings,
  not remaining headroom. Read-only Workers and KV usage surfaces were
  inspected and showed headroom at capture; account-specific usage figures are
  deliberately omitted from this repository. The Durable Objects UI exposed
  billing-period aggregates rather than a current-day SQL-row-read series, so
  current daily SQL-row-read headroom cannot be certified from that view.
  Workers Observability event counts are not substituted for actual usage.
  Refresh all three usage surfaces immediately before any staging approval and
  record daily headroom for every limit that the workload can consume. Require
  remaining headroom to exceed the measured one-run budget plus a documented
  reserve. If the daily DO SQL-row-read headroom or Free plan cannot be
  confirmed, do not enable D and do not upgrade.
- `wrangler.d-staging.template.jsonc` is the exact isolated staging config
  proposal: dedicated workers.dev name, dedicated OAuth KV binding, existing
  SQLite `ProjectStateDO` class/migration, D disabled by default, and no D1 or
  custom domain. Its all-zero KV namespace ID is an explicit placeholder; the
  config is not deployable until the separate approval and namespace creation.
  `D_ROUTING_HMAC_KEY` is supplied only as a Worker Secret after approval and
  its value is never written to the template.
- Capture the exact disabled D version/deployment before enabling. Stop by
  setting only D's `EXPERIMENT_ENABLED=false` or restoring that captured
  disabled version; verify `/remote/projects` and `/mcp` fail closed while
  `/tools/video-scissors` remains available. Do not reset budget counters,
  delete resources, or touch A/B/production. Stop immediately on an unexpected
  budget/quota error, counter read/write failure, privacy assertion failure,
  or any request that leaves the reviewed D Worker origin.

This is a proposal for CTO/Founder review only. No Cloudflare resources, secrets,
deployments, DNS, or production configuration have been changed.

# Stateless MCP + per-project DO candidate (D)

D is an isolated, local-only candidate for the VideoCut MCP experiment. It does
not change the existing A/B runtime, entrypoint, configuration, or worker
integration tests. The shared staging E2E harness is matched across A/B/D. The
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

## Current inventory and approval boundaries

This is source preparation only. No Cloudflare resources, secrets, deployments,
DNS, or production configuration were created or changed here. The read-only
inventory reported that D is absent. A and B remain enabled and unchanged since
2026-10-16 at versions `6def66e9-a61f-4275-8c0f-959c9017190e` and
`fce5281b-e45e-498d-ac4e-3ccde3816f43`, respectively; their names/configs are
not in this candidate's write scope.

Inventory also surfaced a pre-existing KV namespace title ending in
`video-scissors-mcp-d-staging-oauth-kv`; its ownership/provenance is unverified.
Do not bind it, read its keys, change it, or infer task ownership. If the first
approval proceeds, create the exact dedicated namespace
`video-scissors-mcp-d-staging-oauth` and use only the ID returned for that new
namespace. Keep the ID parameterized until then; the existing `-oauth-kv`
namespace remains untouched.

Two approvals remain distinct:

1. The first exact approval covers only creating the D Worker disabled, creating
   the exact OAuth KV namespace, applying the D SQLite `ProjectStateDO` class
   migration, privately entering the already-authorized `D_ROUTING_HMAC_KEY`,
   and verifying the disabled deployment. It does not approve enabling D.
2. After disabled readback, a separate exact approval is required for one
   bounded enabled test window and its rollback. Current authorization does not
   include a live synthetic request, enablement, quota probe, or production
   action.

No D1, custom domain, DNS, production Worker, shared A/B binding, or other
Cloudflare resource belongs to this candidate. The local template's `$schema`
resolves to `../../node_modules/wrangler/config-schema.json`; the repository
pins Wrangler `4.149.0`. Its all-zero KV ID and `EXPERIMENT_ENABLED=false` must
remain unchanged until approval. The unknown `-oauth-kv` ID is intentionally
not recorded here.

### Accepted bounded-experiment risk and limits

- The latest #358 lock's [accepted headroom waiver](https://github.com/innosage-llc/innosage-hub/issues/358#issuecomment-6233242829)
  accepts daily Durable Objects headroom as **UNKNOWN** and non-blocking for
  this named bounded experiment. Do not repeat generic usage,
  quota, or billing probes. A billing-subscription read returned `auth10000`
  and was not retried. This accepted unknown is not evidence of available
  account headroom, and does not authorize a plan upgrade.
- D enforces at most **200 admitted D Worker HTTP requests** and **2 project
  creation attempts per UTC day**. Each additional live matched round requires
  explicit approval and must fit those existing counters. There is no separate
  one-journey-per-day gate or mandatory UTC-rollover wait. A/B each run once in
  the approved matched window. The 200 limit is an application admission bound, not a
  Cloudflare spend cap: the request still invokes the Worker and budget DO
  before it can be rejected at the application limit. The local fixture's
  99-request count is a local harness count, not Cloudflare usage or a forecast
  of real ChatGPT polling. Deploys do not reset the D counters.
- The counters share one fixed-name SQLite object in the existing
  `ProjectStateDO` class/namespace. A bounded singleton row stores the UTC day
  and counters; `transactionSync()` serializes rollover and limit checks. There
  is no D1 or second DO class binding. Project-creation attempts reserve a slot
  before credential generation or per-project state creation; downstream
  failure still consumes the slot.
- `wrangler.d-staging.template.jsonc` is the isolated workers.dev proposal:
  D-specific entrypoint, disabled by default, OAuth KV binding, existing SQLite
  `ProjectStateDO` class/migration, no D1, and no custom domain. The approved
  namespace ID belongs only in a temporary, uncommitted sibling copy of the
  template after creation. Do not edit the template during this prep.
- The secret is never generated, printed, or stored by this task. After the
  first exact approval, the authorized operator privately enters the approved
  32-byte/64-hex `D_ROUTING_HMAC_KEY` at Wrangler's interactive prompt; never
  pass it as a command argument or put it in a file. Treat `wrangler secret put`
  as a deployment/version side effect (the [Wrangler command documentation](https://developers.cloudflare.com/workers/wrangler/commands/#secret)
  says it creates and deploys a new Worker version) and repeat disabled-state
  readback after it.
- Capture the final disabled version ID after secret provisioning and before
  any enablement. Do not reset counters, delete resources, or touch A/B or
  production. Stop on a budget/counter error, privacy assertion, or request
  outside the reviewed D origin.

### Approval-gated disabled provisioning packet

These are the exact local CLI forms for use only after the first approval; no
command below has been run against Cloudflare in this source-preparation task.
Run from `workers/video-scissors-mcp`. Keep the template unchanged and create a
sibling working copy; replace only its all-zero KV ID with the ID returned by
the approved namespace creation. Confirm the copied config still has
`EXPERIMENT_ENABLED=false`, the exact D name, no D1/domain/route, and the pinned
schema path before using it.

```sh
WRANGLER=../../node_modules/.bin/wrangler
APPROVED_CONFIG=.env.d-staging.approved.jsonc

"$WRANGLER" kv namespace create video-scissors-mcp-d-staging-oauth
printf 'Paste the new namespace ID returned above: '
IFS= read -r OAUTH_KV_ID
[[ "$OAUTH_KV_ID" =~ ^[a-f0-9]{32}$ ]] || exit 1
cp wrangler.d-staging.template.jsonc "$APPROVED_CONFIG"
sed -i '' "s/00000000000000000000000000000000/$OAUTH_KV_ID/" "$APPROVED_CONFIG"
"$WRANGLER" deploy --config "$APPROVED_CONFIG" --dry-run
"$WRANGLER" deploy --config "$APPROVED_CONFIG"
"$WRANGLER" secret put D_ROUTING_HMAC_KEY --config "$APPROVED_CONFIG"

"$WRANGLER" deployments status --name video-scissors-mcp-d-staging --json
"$WRANGLER" versions list --name video-scissors-mcp-d-staging --json
curl -sS -o /dev/null -w '/remote/projects %{http_code}\n' --max-time 10 \
  -X POST https://video-scissors-mcp-d-staging.innosage-draft.workers.dev/remote/projects \
  -H 'content-type: application/json' --data '{}'
curl -sS -o /dev/null -w '/mcp %{http_code}\n' --max-time 10 \
  -X POST https://video-scissors-mcp-d-staging.innosage-draft.workers.dev/mcp \
  -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
curl -sS -o /dev/null -w '/tools/video-scissors %{http_code}\n' --max-time 10 \
  https://video-scissors-mcp-d-staging.innosage-draft.workers.dev/tools/video-scissors

# After the separately approved test window, restore the exact captured disabled version.
DISABLED_VERSION_ID='<captured-disabled-version-id>'
"$WRANGLER" rollback "$DISABLED_VERSION_ID" --name video-scissors-mcp-d-staging
```

Expected disabled HTTP readback is 503 for `/remote/projects` and `/mcp`, and
200 for `/tools/video-scissors`; record only status, deployment/version IDs,
and bounded readback outcomes. The rollback command is parameterized by the
captured disabled version and is not run without approval. Do not include the
secret, OAuth values, KV key contents, unknown namespace ID, or media in logs
or evidence.

### Local verification limits and unrelated history

Actual Durable Object hibernation, WebSocket socket-attachment restoration,
and cold-instance recovery have **NOT** been verified in this local candidate.
The attempted Miniflare eviction test was unstable and is not evidence that
these behaviors pass. The existing A/B `integration.test.ts` visibility
failure remains documented and unchanged; it is outside this bounded D source
preparation.

The local D browser fixture above is historical local-only evidence. Its second
project/reconnect sequence and 99 local harness requests are not the locked
first matched round and are not Cloudflare usage. Historical staging reports
and four-command journeys retain their original meaning; do not relabel them as
the current Cut1/Cut2/Undo2 scenario.

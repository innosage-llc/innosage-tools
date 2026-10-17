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
3. One `ProjectStateDO` SQLite class binding plus its D migration.
4. One D-only Worker secret, `D_ROUTING_HMAC_KEY`, containing a random 32-byte
   key (64 hex characters). It signs short-lived routing tickets and grants no
   access by itself.

No D1, custom domain, DNS, production Worker, shared A/B binding, or other
Cloudflare resource is part of that proposed minimal set.

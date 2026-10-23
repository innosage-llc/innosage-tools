# Inactive Scene MCP candidate

Status: local preparation only. The active Worker entrypoint, video OAuth/scopes,
normal migration directory and deployment configuration are unchanged. Founder
approved preparation and independent security review; activation, persistent
access expansion and every live MCP run remain separate action-time gates.

## Store and data boundary

`lib/visual-remix-remote.ts` reuses the validated Scene/Proposal schema. Only text,
layout/style, captions, provenance, limitations and used raster descriptors may be
shared after complete field consent. No source pixels, asset/export bytes, paths,
object URLs or credentials are in the snapshot. User-typed content is explicitly
shared content, not a secret-detector guarantee. Proposed assets must already
belong to the shared Scene; the agent cannot acquire unused local assets.

A fresh share fixes project, generation and epoch for at most fifteen minutes.
Browser owner credentials and one-use consent proofs are distinct random values;
only hashes persist. Proof expiry is five minutes. Scene proof/handle tombstones,
shares and requests use separate tables. Video tables/counters are untouched.

`candidate-migrations/scene.sql` is deliberately outside `migrations/`. Nothing
applies this SQL automatically. Admission and claim have SQL authorization fences;
only one queued/rendering/preview request can be active. Identical retries consume
one request slot and return actual status; conflicting payloads fail. Claim is not
replayed after uncertain delivery. Preview is nonterminal and not applied. Applied
reports require the owner, baseRevision+1 and the exact proposed Scene snapshot.
Cancel cannot undo applied work. Imports/generation changes need fresh sharing.

Get requires a browser-acknowledged snapshot no older than ten seconds. A suspended
browser yields unavailable, never fabricated current state. Snapshot revisions
cannot move backwards or change content at the same revision. Network transport,
OAuth verification and browser-controller integration are separate next slices.

## Limits and retention requiring activation review

Inner metadata/proposals are at most12KiB UTF-8. Complete browser commands and
escaped JSON-RPC tool-result envelopes must fit16KiB; reject larger valid local
Scenes instead of raising limits. Existing local PNG/MP4 export is unaffected.

Separate cumulative candidate ceilings are20shares,16distinct requests/share and
2000HTTP requests; no counter reset/recreation is provided. At most340snapshot/
proposal payload slots of12KiB are retained (4,177,920payload bytes, plus bounded
row/hash/identifier overhead). These are implementation ceilings, not a grant to
consume a live budget. An approved live run must set a smaller exact call budget.

Explicit owner revocation immediately removes current snapshot/proposal content
and disables pending work, retaining bounded replay tombstones/hashes/counters.
Every future candidate request will run lazy expired-share cleanup. Access expiry
is not physical TTL deletion: if no cleanup request arrives, expired content can
remain stored. No cron/DO/new service is introduced. Any activation packet must
explicitly approve this retention/cleanup policy or require a reviewed stronger
policy first; Cloudflare backup retention is not claimed controlled here.

## Evidence and next gates

Five tests pass (four actual local Miniflare/D1 cases and one pure schema/envelope
case): concurrent proof consumption/tombstone
rollback, idempotent admission/claim, preview versus applied acknowledgement,
owner/generation/freshness and cancel/revoke/expiry fences, finite budgets and
UTF-8/escaped-wire bounds. Outbound egress is denied/count-checked. Worker/root
TypeScript and scoped lint pass (one existing-style default-export warning in the
fixture). These tests do not prove remote auth, a real browser or ChatGPT host.

Next: purpose-isolated authorization composition and consent, bounded MCP/browser
transport, exact security review and offline integrated proof. Current existing
video grants do not authorize Scene. Do not deploy the checked-in local-only
Worker template or apply candidate SQL. No live target/usage readback has occurred.

## Inactive shared-issuer composition

`src/scene/oauth-candidate.ts` is not imported by any deployed entrypoint. Its
factory defaults disabled and delegates non-Scene traffic to the unchanged active
entrypoint. An offline fixture explicitly enables the factory. No Wrangler/main,
binding, migration or live access setting is changed.

The enabled candidate uses one official OAuthAuthorizationServer and two
OAuthResourceServer wrappers. Video stays the default and migration audience at
`/mcp`; Scene uses exactly `/scene/mcp` and both `scene:read scene:propose` scopes.
The same issuer/KV/D1 are proposed; a second server, domain or credential is not
introduced. Video options are extracted without changing providerFor behavior,
including existing consent/proof, remote routes, bridge wakeups and token callback.
The existing experiment gate and cumulative HTTP/DCR/OAuth budgets still apply,
and are never reset; Scene traffic also spends the separate Scene HTTP ceiling.

Consent recovers the canonical resource from official stored helpers, verifies
cookie/CSRF and consumes a purpose-specific D1 proof and handle tombstone. Forms
cannot select project/purpose/audience. Scene token props are exact and rechecked
with a live lease on every authorized request; token exchange TTL cannot exceed
remaining lease and rejects less than KV minimum sixty seconds. No Scene refresh
or token exchange grant is issued. Video grants and unbound legacy records stay
video-only.

Four actual SDK tools read/propose/status/cancel only. No Apply/export RPC exists.
Scene POST bodies and complete finite JSON/SSE-fallback responses are bounded;
ids are checked before admission. The resource challenge is available to an
unauthorized host; authenticated GET is 405, not an indefinite event stream.
Browser endpoints require same-origin JSON, exact fields and owner credentials.
Only an explicitly confirmed creation uploads descriptor data. The browser adapter
and connected product UI are a later increment and are not claimed ready here.

The exact canonical Antigravity HIGH consent output is integrated with only its
contract import path changed. Prior controlled UI browser evidence and independent
review remain applicable to that renderer. Local actual-provider tests cover
PKCE/cookie/proof, cross-purpose/mixed scope rejects, expiry and no-refresh, actual
SDK queue/claim/preview/cancel/revoke, wire-id bounds, prior bound and simulated
pre-resource video grants/refresh, and same-client/same-user grant coexistence.
These are disconnected tests, not live host acceptance. The first fixture run
exposed missing await inside a catch boundary and an empty-401 test-parser bug;
both were repaired before the passing run. No failed run is relabeled.

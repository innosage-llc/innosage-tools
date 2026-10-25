# Explicit until-revoked Scene sharing

Decision for #132 / Master #85, after one read-only Astra HIGH consultation of
source0e8545e0. Current base7cebd35 adds only unrelated BYOS changes. Preparation
is authorized; this document grants no runtime activation or live MCP traffic.

## Four independent lifetimes

New, explicitly consented sharing may have no product deadline. Add an immutable
`expiry_policy` (`fixed` by default, or `until_revoked`) and consent version.
Existing15/30-minute rows retain their original deadlines and remain fixed.
For new until-revoked rows only, `expires=0` is an unused storage sentinel; wire
expiry is null with an explicit lifetime discriminator. Never use Infinity or a
far-future date, upgrade old rows, or renew a deadline through heartbeat.

Pairing remains five-minute and single-use; abandoned new unpaired grants are
cleaned up when proof expires. OAuth remains authorization-code-only with the
existing finite1800-second cap and refreshTTL0. Fixed grants use the lesser of
that cap and their remaining original duration. Same-grant OAuth renewal is not
implemented; platform authorization may still require manual reconnection. No
new OAuth scopes, credential types or indefinite host-connectivity promise.

Ten-second browser freshness remains independent. Closed/suspended editors are
not remote-ready. For new until-revoked grants, snapshots, request payloads and
reference pixels form a30-minute inactivity cache, not an authorization lease.
An explicitly configured15-minute cleanup on the existing staging Worker purges
inactive cached content without revoking the grant or changing authority epoch.
Only authenticated browser sync keeps this cache active. Host reads do not.
Provider failures can delay cleanup; backups and delivered host content remain
outside immediate erasure. No guaranteed deletion time is claimed on failure.

## Retention, recovery and races

Persist only the existing owner capability and minimal binding metadata in this
origin's IndexedDB, only after fresh explicit until-revoked/control-retention
consent. It is a full browser-owner capability, not a revoke-only secret. Never
persist OAuth tokens, pairing proof, original pixels or Scene content in this
record. Existing timed grants remain memory-only. Store ownership before showing
proof; storage failure must revoke the unpaired grant or report uncertainty.
After reload, expose explicit revocation recovery, not automatic reconnect,
resharing or rebinding to a new project/generation. Clear the record only after
acknowledged revoke. Clearing browser storage loses that recovery handle;
bounded inactive-cache cleanup prevents an orphaned perpetual image store.

Keep snapshot hashes across cache purge so same-revision restoration requires
identical content. Preserve bounded request hashes/IDs, terminalize old pending
work and use a separate cache generation to reject late uploads and stale browser
previews. Authority epoch changes only on revoke. Rehydration may reuse only the
same explicitly consented reference, not another image/project. No reanalysis is
required for cached Scene reuse in the existing editor.

Use one common grant SQL fence for mailbox and image operations, including exact
project/generation/epoch/revocation. Recheck in each write/read authorization
point, not only outer OAuth validation. Revoke atomically increments epoch and
purges current snapshot/request/image content through existing triggers. Content
already delivered cannot be recalled. Local work and manual remote Apply stay.
Existing storage/request/abuse limits remain separate from grant TTL; no counters
are reset and unlimited service availability is not promised.

## Inactive rollout and verification

Prepare additive candidate SQL, code, both consent views and compiled browser
guards. New until-revoked creation is separately disabled by default. Before any
activation, bind the exact reviewed source/migration hashes, existing staging
D1/Worker, browser-control persistence,15-minute cleanup schedule, retained data
and fixed scopes to applicable per-action approval. Do not create a live grant
or use live MCP during local qualification. No new resource or production action.

Local actual-provider/D1 tests cover old-row migration, fixed expiry, new grants
past former deadlines, finite OAuth, proof expiry/replay, cross-project isolation,
revoke races, cache purge/restore/replay, late upload, and bounded cleanup. Browser
tests cover explicit fresh consent, ownership persistence/recovery failures,
local-work survival, unavailable-browser copy, pairing/reference sharing and HTML
export in the same compiled artifact. Independent security review and native CI
precede staging readback and Founder verification.

Rollback first disables new until-revoked creation while retaining revoke/cleanup
and consented existing grants. Reverting to the old binary interprets sentinel0
as expired and terminates those new grants; disclose and reconcile them before
such a rollback. Old fixed rows are not extended or rewritten. Main integration
is not activation, Founder acceptance, production permission or Master closure.

## Client increment and operational limits

The client stores exactly version, until-revoked discriminator, createdAt and the
existing purpose/project/generation/epoch-bound owner capability in one origin
IndexedDB record. Atomic compare-and-set prevents another tab overwriting a
revocation handle. Record failure blocks proof display and revokes the unpaired
attempt, or retains an explicit uncertain-revoke state. Reload reads control only
and offers Disconnect; it never syncs a new Scene, reconnects or uploads images.
Only acknowledged service revoke followed by matching record deletion clears the
recovery handle. Local teardown of an established until-revoked connection stops
local work delivery without silently revoking it. Existing timed teardown is
unchanged. The record contains no Scene, pixels, proof or OAuth token.

Cache generation accompanies sync/poll/upload. Until-revoked poll claims require
the matching generation, so stale polling cannot consume fresh commands. Cache
reset cancels old local previews/preparation before re-uploading only the same
already-consented reference. Manual Apply and local Undo/Redo/export stay intact.
Cleanup checks for an existing reference table independently of its access flag;
turning image access off must not retain old images. Each scheduled invocation
uses at most21 D1 statements, including expiry and six oldest cache batches.

The existing product-issued OAuth access token still lasts at most1800 seconds
and has no refresh credential. A token issued four minutes after share creation
is tested reading at31 minutes of share age, then rejected at35 minutes of share
age; this proves independent grant/token lifetimes, not continuous host access.
After token expiry the host can require a fresh manual connection, even though
the sharing grant itself has no deadline. The current single-use pairing design
cannot reauthorize that same grant. This limitation must be explicit in staging
handoff; no perpetual-connection claim, new refresh grant or credential is added.

Runtime creation remains gated by SCENE_UNTIL_REVOKED_ENABLED, and browser UI by
NEXT_PUBLIC_SCENE_UNTIL_REVOKED. Never force either true in ordinary source.
Stopping new creation does not revoke established grants. During rollback keep
owner-control recovery and cleanup available, reconcile outstanding unpaired
proofs before selecting a timed-only consent view, and disclose that an old
binary treats sentinel0 as expired. Do not silently clear stored control records.
Actual stage migration, flags, schedule and new persistent grants remain NOT_RUN
until the exact reviewed candidate/action is admitted. No live MCP run is part of
these local guards.

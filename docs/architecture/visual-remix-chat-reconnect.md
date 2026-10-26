# Scene share profiles and chat reconnect

Founder reported two same-name Editable Screen account rows and the host error
`link_id must identify an eligible linked account`, with no Scene candidate.
That screenshot does not show whether Scene received the request. Revision0 is
valid initial state. Draft PR4071 is a source reference, not a proven host cause;
its staging recovery was reported working, with full automatic resume unverified.

The small compatibility repair adds a designated authenticated `get_profile`,
using the existing opaque stored `shareId`. This is a **share-capability profile**,
not a person or owner account. Different shares remain separate even when they
share a project; consent and revocation may differ. Existing OAuth `userId` and
all resource/client/purpose/project/generation/epoch fences remain unchanged.
Repeated reads of the same share return its same identity. Display labels are
separate. No invented owner/email or identity selected by caller arguments.

The profile requires current authority, never cached Scene/image data or browser
freshness. A stale browser produces a data-read availability error while its
otherwise valid profile remains readable. Revoked/expired authority returns the
existing OAuth challenge, including the SDK post-validation race. Exceptional
handler-context failures now also carry origin-bound Scene discovery, scope,
error and description. Existing resource-server validation is preserved.

The profile has strict empty input, supported output fields, matching text and
structured output, read-only annotations and `openai/profile: true` metadata.
[Official OpenAI authentication contract](https://developers.openai.com/plugins/build/auth#support-multiple-accounts)
requires stable identity for the same independently connectable profile and
explains that the metadata marker does not grant host eligibility. The service
must not call replacement shares a reconnect of the original profile.

## Explicit same-share reauthorization

The original five-minute proof and its initial consent-handle tombstone remain
single-use. Reconnect never removes `consent_hash IS NULL` or replaces that
binding. Behind default-off `SCENE_REAUTH_ENABLED` and
`NEXT_PUBLIC_SCENE_REAUTH`, each fresh Scene OAuth consent page can create a
separate short request, bound to the actual provider consent handle, registered
client, exact resource and unchanged Scene scopes. Opening the page grants no
access. Its nonce-bound script announces only a random request ID over a
same-origin BroadcastChannel.

Only an already active, connected editor may inspect that request using its
existing exact share/project/generation/epoch owner credential. A fresh unchecked
confirmation in that editor authorizes preparing one proof. Atomic issuance
requires the current live grant, its original consent binding, current snapshot,
recent browser presence and correct owner credential. The random proof goes only
to the matching same-origin OAuth page; neither owner credentials nor Scene/image
bytes cross this channel. The user still clicks normal OAuth Approve. There is no
automatic submission, proposal execution, account deletion or share creation.

Atomic consumption checks the request ID, hashed proof and original handle,
registered client, origin-bound resource, fixed deadline, current share epoch and
revocation. The existing share ID becomes the OAuth user/profile again. Its
original image consent, authority deadline, project and original consent binding
remain unchanged. OAuth stays at most 1800 seconds with no refresh credential;
this is explicit authentication maintenance, not additional persistent access.
Revoked/expired authority cannot be recovered. A lost issuance response is an
uncertain outcome and is never automatically retried.

The additive `candidate-migrations/scene-reauthorization.sql` stores only short
transaction metadata and proof hashes, at most 20 rows with five-minute
authorization deadlines. Physical cleanup is lazy; expired rows are deleted before new admission and by the existing scheduled
maintenance invocation. This does not change the 20 retained-share bound,
activity counters, active-grant cleanup policy or existing cron frequency. Late
callbacks cannot recreate collected IDs; terminal requests cannot be reopened,
and request/client/resource/deadline and issued share bindings are immutable.
The runtime flag must remain off until the exact migration/package is reviewed
and activated on existing staging. This migration is not a new credential store.

Saved browser-control recovery remains recovery-only: reload does not reconnect,
sync or upload. No inactive/suspended/closed browser availability is promised.
The editor must still be active for data reads, and a different share remains a
different independently revocable profile. Already-open older editor code does
not gain this feature in place. Save the portable project before an upgrade or
reload. The existing recovery-only boundary still applies after reload; an
explicit replacement share used for upgrade is a new profile, never evidence of
same-profile reconnect. Qualify reconnect on a share first paired with this exact
candidate, then keep that editor open for the expired-token test. Legacy timed grants keep their fixed
deadline. New consent is required for any different sharing boundary.

Local tests cover the actual provider/D1 path after token expiry, stable profile,
unchanged timed/until-revoked grant, strict arguments, stale browser, revocation,
wrong client/resource/handle/share, concurrent proof issuance, single use,
collected-request replay and bounded storage. Browser/transport tests separately
cover explicit confirmation, same-origin handoff, manual final Approve, recovery
silence, uncertain response, disconnect and local edit/export preservation. A
harness explicitly issuing the original read again is not proof of ChatGPT host
continuation. No proposal is replayed.

## Founder acceptance

On the exact staged candidate, use the existing Editable Screen connection in
chat, request a read, use the chat's Reconnect once, complete required explicit
authorization and observe whether that original read resumes without Settings
or typing Retry. Record whether the same share/profile was retained or a new
share was explicitly created. A connected row alone is not success. On failure,
record safe tool/status/correlationID/revision and whether a request reached
Scene; never collect tokens, proofs, private account logs or raw image data.
The lead does not run live MCP without its separate per-run Founder gate.
Production, account deletion, cross-share merging and Master closure remain out
of scope. Rollback disables only the new reauthorization runtime/build flags and restores
the previously verified package, preserving authority rows, original consent
bindings, owner control and existing flags/cron. Short requests may age out;
never roll back by reviving a revoked grant or changing profile identity.

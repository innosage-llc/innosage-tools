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

## Limit of this repair

There is no same-share reauthorization path today: its original five-minute
proof and initial consent binding are single-use. A fresh Connect creates a new
share/profile. This patch changes neither rule. No refresh credential, lifetime
extension, silent replay or saved-control auto-reconnect is added. An active-tab,
explicit same-share authorization would require a separately designed atomic
proof/client/handle binding, bounded replay storage and review; simply removing
`consent_hash IS NULL` bypasses existing consent-handle tombstones.

Native local provider/D1 tests cover profile discovery/stability, independent
same-project shares, callback/token readiness, strict arguments, stale browser,
revocation, wrong resource and origin-bound HTTP/tool challenges. A harness
explicitly re-executing a read is not proof that ChatGPT resumed its original
execution. No proposal is replayed. Existing until-revoked consent, fixed legacy
deadlines, image authorization, finite1800-second OAuth/no refresh and manual
remote Apply remain intact. No migration or runtime setting is required.

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
of scope. Rollback reverts compatibility code without changing identities,
authority rows, owner control, existing flags/cron or consent history.

# Real Drive qualification boundary

Status: pending authority/context, NOT_RUN. No actual Google request in #142.
The user-authorized read of the historical immutable BYOS demo succeeded; it
showed the old app, not this candidate, and no active authorization or visible
client/editor/merge values. No navigation, storage/token read, edits or provider
action followed. The prior tab-read denial is resolved for that read only.

Minimum safe continuation:

1. Identify the original approved disposable account/workspace/folder and both
   ordinary Chrome profiles. Confirm exact original binding through scoped
   non-secret metadata inspection; do not export tokens, copy profile data, or
   guess/replace bindings. Preserve existing tabs and IndexedDB.
2. Obtain scope for original-session renewal if needed; #142 explicitly requires
   stopping for renewal. Current inspection-only grant does not authorize it.
   No new account, client, OAuth scope, folder or ongoing access.
3. Serve the reviewed exact candidate in an explicitly authorized origin. The
   historical immutable origin cannot be updated. Existing stable staging is
   documented but current OAuth registration/binding is unconfirmed. Under Hub
   policy staging requires a main-integrated candidate and explicit staging
   authority; the current draft-only boundary grants neither merge nor deploy.
   Do not substitute intercepted assets into the user's old tab.
4. Before live execution, freeze the original-context grant, exact candidate,
   twelve synthetic 4KiB pages, request/time ceiling and stop conditions. Use the
   existing transport budget; no automatic retry, destructive cleanup or scope
   expansion. Confirm A→Drive→B and B→Drive→A exact complete records/tree and
   retain allowlisted counts/bytes/timings only. Separate unexercised negatives.

Offline evidence cannot resolve these authorization prerequisites. Once they
are supplied, revalidate changed candidate evidence and execute the bounded
provider plan; then submit up to three Founder journeys with #142 open. No
production, cleanup, closure or Draft adoption follows automatically.

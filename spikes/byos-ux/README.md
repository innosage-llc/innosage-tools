# BYOS UX spike #136 — simulation only

Run `npm run spike:byos-ux`, then open http://127.0.0.1:4136 . No deployment,
provider, credentials, account data or background service is involved.
`?size=10000&workspace=your-fixture` chooses the large catalog and a separate
browser-local fixture identity. Default is 12 pages / demo. Never reuse live demo
storage. Each size has a separate database; switching sizes preserves each fixture.

The UI exposes one editor, page navigation (20 metadata rows at a time), distinct
pending-page count, local commit and separate simulated cloud status, confirmed
second-device content, explicit handoff and failure controls. Local writes use
IndexedDB strict readwrite transaction completion before ACK. Browser storage is
subject to normal browser/profile eviction; this prototype does not promise
backup. A Web Lock prevents concurrent tabs writing the same fixture.

The audited source is `../byos-sync/native-overlay/page-store.mjs`: journal-first
save (lines 124 onward), matching `{id,body,editId}` confirmation and guarded
conflict resolution. Direct reuse would load real Google replication and its
workspace scans. This small simulator mirrors only those protected-intent
semantics; it is no replacement synchronization engine or production candidate.
No existing product source, provider or live demo route is changed.

FIFO is over distinct pending pages. Repeated edits coalesce to latest durable
intent. One operation sends one immutable generation. Newer intent goes to the
tail on completion; another eligible page cannot be starved by continuous typing.
Non-durable or conflicting pages are ineligible. Offline/auth modes pause delivery;
retry explicitly clears fault state. Never-completing work becomes visibly stalled
at 60 seconds, with immediate Cancel/recover available throughout. Cancellation
logically releases this simulator's slot; no claim is made about physical remote
cancellation. Deliver cancelled old completion exercises the stale-token fence.
Changing latency applies to the next operation, not the operation already in flight.
No operation runs after the page closes; reopen recovers pending work as uncertain
and waits for explicit retry. Both conflict originals are archived after explicit
Use cloud / Keep local / Merge manually; editing never silently adopts remote text.

Catalog construction creates 12 or 10,000 metadata entries once on selection.
Body reads occur only for edited rows at startup; untouched bodies are generated
on demand for the active page. Typing/save touches one map/journal row and pending
set; queue choice scans pending pages only. Explicit handoff scans visited/edited
rows, not the full catalog. Render currently builds complete JSON for the active
page's archived conflict history; a long history is a remaining design risk.

Verification:

- `npm run test:byos-ux`: deterministic fake-clock checks (not wall-clock timings).
- `npm run test:byos-ux:browser`: installed Chrome, actual IndexedDB, process close /
  reopen, real 10s/45s timers, bounded typing observations, screenshots; no external
  requests allowed. Requires root `npm ci` and local browser execution permission.
- `npm run test:byos-ux:focused`: delayed overlapping catalog initialization, single-writer refusal, all three browser conflict choices and archive visibility.
- `bash scripts/gatekeeper.sh`: native owning repository checks; never runs live Drive.

See `evidence/` and `ACCEPTANCE.md` for exact outcomes, limitations and revision.
Human usability **NOT_RUN**; satisfaction **UNKNOWN**. Prior real observations are
Hub PR428's 9.57–45.67 seconds end-to-end application orchestration, not pure Google
latency. Synthetic results establish neither Drive performance nor comprehension.

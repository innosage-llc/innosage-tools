# BYOS remediation: immutable revisions and conditional snapshots

**Offline prototype with full synthetic safety and diagnostic evidence.** This is a custom protocol on
native RxDB 17.6.0 / Dexie local persistence. It does not repair or masquerade as
RxDB's Google Drive replication, selfstore, or either native cloud adapter.
The historical [study](../byos-sync/SUMMARY.md) and
[scorecard](../byos-sync/SCORECARD.md) remain unchanged at baseline
`496e9a8a1b605c81e71026d0ab217e6ccb9f41a4`.

## Contract

- A local save acknowledges only after inserting the complete immutable revision
  into RxDB/Dexie. Its queue never awaits network operations. Each revision has a
  unique ID, page and incarnation, causal parents, full body and metadata, optional
  parent-page/incarnation, explicit supersession, and canonical SHA-256 payload
  hash. Identical duplicates are idempotent; ID/content collisions fail closed.
- Projection retains every revision and exposes concurrent heads with full bodies.
  Manual resolution is another revision referencing the conflicting heads. No
  physical deletes, history compaction, automatic text merge, or GC is implemented.
  Tombstone/recreation/parent visibility and explicit resolution are tested. Hidden
  full heads are exposed as `recovery-needed`, never silently discarded.
- The remote object is precreated, known, and isolated under the versioned
  `byos-remediation-v1` snapshot namespace. Each sync GETs the full body and strong
  ETag together, validates it, durably imports its revisions, unions local history,
  and conditionally writes with **that exact GET ETag**. A 412 reloads and unions.
  It never borrows a fresh HEAD validator for a stale body. Unknown schemas,
  hash/ID mismatches, missing causal parents, missing/weak validators or absent
  known objects block; there is no unconditional fallback or object discovery.
- A second content GET must cover the attempted exact revision set before an
  immutable local verification receipt is committed. The receipt identifies the
  target, exact revision IDs/hashes, observed ETag, and time. Its wording means
  **these revisions were present in that GET**, not global completeness, current
  presence forever, or that every device has settled. New local revisions remain
  pending until a persisted receipt covers them. Restart after an interrupted
  sync conservatively exposes `verification-unknown`; persisted receipts remain
  historical evidence. No state says generic `Synced`.
- Local states are `local-saved`, `local-error`, `recovery-needed`, `conflict`, or `incomplete`;
  remote states include `pending`, current-worker `syncing`, `blocked`,
  `blocked-reauth`, `verification-unknown`, and `verified-revision-set`.
  These are two axes: a remotely verified set can still contain manual conflicts.
- Recovery is bounded by four attempts / 4 seconds, with 500 ms per request and
  20/40/80 ms transient-error backoff by default. Tests tighten selected limits.
  401 requires reauthentication; explicit 403 rate-limit reasons retry; unknown
  or permanent 403 fails closed as blocked. 429/5xx and unknown-success writes
  retry only within the bound. Permanent denial retains durable intent.

## Assumptions and limits

A viable production transport must provide atomic **complete GET bodies**, a
coherent strong ETag for those bytes, and atomic If-Match enforcement. The mock
proves our algorithm under that contract; real Google Drive/WebDAV support,
permissions, browser CORS, OAuth, discovery and provider quota weights are
**NOT RUN / UNKNOWN**, not established by these tests. Only literal HTTP
127.0.0.1 origins are accepted, including when passing a custom remote object;
redirects are rejected. No cloud request or private content is used.

A fresh client cannot detect a valid-looking snapshot that a faulty server has
silently omitted unknown revisions from. Existing clients preserve every revision
they have loaded. The full-history snapshot requires growing storage and transfers;
it is a bounded adoption prototype, not a large-workspace production architecture.
There is one owner per local database (`multiInstance: false`); cross-tab writers,
local-device power-loss/fsync guarantees, hostile-server availability, migration
from legacy writers and concurrent third-party writers in this namespace are
unsupported. Renderer-crash durability is separately measured in real Chromium IndexedDB;
fake-indexeddb close/reopen is not that evidence.

The fixed-object algorithm has **no listing/timestamp checkpoint**. Thirty
same-timestamp edits and a deliberately hidden listing object therefore restore
by the known object ID. This replaces the failing algorithm; it does not repair
native RxDB pagination or claim Google really exhibits adversarial listing lag.

## Run and replay

From the product root:

```sh
npm --prefix spikes/byos-remediation ci --ignore-scripts --no-audit --no-fund
npm --prefix spikes/byos-remediation test
npm --prefix spikes/byos-remediation run focused -- A1
npm --prefix spikes/byos-remediation run focused -- A2
npm --prefix spikes/byos-remediation run focused -- A3
npm --prefix spikes/byos-remediation run report
```

The HTTP witnesses need permission to bind loopback. Dependencies are isolated,
pinned development dependencies; no production runtime dependency was added.
This development run bootstrapped its lock from the unchanged baseline lock,
pruned unused packages offline, and copied matching installed packages locally.
An offline cache miss and sandbox-denied public registry bootstrap were tooling
failures, not distinct unblock hypotheses. The native delivery gate must use the
new self-contained `npm ci` lock before merge.

Each explicit focused run stores source/lock hashes, installed versions, raw
observations, actual HTTP/fault receipts and result. The checked-in
[attempt ledger](../../docs/sessions/20261023-byos-remediation/attempts.jsonl)
retains historical results. Hash-named `evidence/sources/` directories are archive
snapshots, not in-place runnable packages: their relative baseline-mock import
assumes the original layout. To replay, restore the snapshot's files into
`spikes/byos-remediation` in a temporary checkout of the recorded baseline, restore
its manifest-pinned `spikes/byos-sync/src/mock.mjs`, run its lockfile install, then
run the recorded command. The A1/A2 initial snapshots predate the evidence runner
and use their explicit `node --input-type=module` commands. Do not edit or format
historical snapshot source to match newer code. See [source digest verification](SOURCE_PROVENANCE.md)
for the exact legacy Python and current JavaScript serialization recipes.

The report takes the **last ledger entry for each of A1, A2 and A3**, including
failures, and verifies each latest raw artifact hash. Missing, invalid or non-PASS
latest evidence blocks foundation PASS; it cannot fall back to historical success.
Superseded recorded PASS entries are labeled separately. Report regressions use
in-memory fixtures and do not append fabricated attempts to the real ledger.

## Current replay and evidence

Historical A3 `reordered-get` means a sequential delayed GET. Separate A5
receipts prove actual captured-response application delivery inversion, including
coherent full bytes/ETag and the resulting stale conditional-write412. Historical
bytes and original engine/provider comparison tables remain unchanged.

After installing the pinned dependencies, run the complete continuation offline:

```sh
node spikes/byos-remediation/src/run-stage.mjs A4
node spikes/byos-remediation/src/run-stage.mjs A5
node spikes/byos-remediation/src/run-stage.mjs A6
node spikes/byos-remediation/src/run-stage.mjs A7
npm --prefix spikes/byos-remediation run report
```

A5 uses100 distinct global seeds,25 per provider/scale; seeded page choices and
recovery order affect execution. It includes full10/1000-page hierarchical data,
same/different-page edits, clock skew, deletion/recreation, stale descendants,
concurrent resolutions, actual fault receipts and reopened/cold replicas. The
historical100-combination/25-seed run is partial evidence. A6 uses installed
Playwright Chromium and12 actual renderer crashes across2providers×6 proven
boundaries: after durable local ACK; before remote mutation; after mutation before
response; after write response; before persisted receipt; after persisted receipt.
It checks native IndexedDB identity, full bodies, pending/conflict state and cold
restore. Browser/OS/power loss remains unsupported. Browser install, if absent,
is a separate environment prerequisite; no real provider credentials are needed.

A7 refuses measurements unless latest A5/A6 hashes, safety outcomes and current
core runtime match. It runs30 paired normal trials per provider/scale (120rows),
with local initialization, cold publish/hydration, single-page edit, offline
concurrent edit/reconnect, inspection, reopen and cold restore. Mock8msRTT/2ms
jitter is not Google/WebDAV performance. CPU includes Node harness/oracle work;
heap is an observation, not peak or isolated storage. Full source dependencies,
raw rows, actual request/fault receipts and hashes accompany each run.

`npm run report` selects latest A4–A7, checks raw/envelope/manifest hashes and
executed runtime dependencies, and regenerates SUMMARY.md, SCORECARD.md and
`evidence/decision-summary.json`. Missing/failed/stale evidence fails closed;
percentiles require safety and30 unique paired PASS rows per cell. The separate
foundation-summary preserves A1–A3 lineage. Report-only edits do not masquerade
as executed runtime versions. Unit/report/recovery regressions run in native CI;
the full100-seed/120-trial evidence is explicit, not repeated in every gate.

## Decision and delivery boundary

The candidate preserves complete conflict versions rather than automatically
merging text. Every normal concurrent same-page trial retains2manual conflict
heads plus its applied predecessor. Whole-history snapshot cost grows with data
and edit history; the numeric scorecard discloses transfer amplification. This
is a bounded viable offline path for later real-provider validation, not a claim
that native RxDB/selfstore blockers were repaired or that product adoption is safe.

Canonical Hub V1 requests Sol HIGH lead/reviewer; the lead implements/operates/tests,
with separate read-only independent review. Historical custom assignments remain
historical. Exact reviewed/merged revisions, native gates, Hub pin and the short
Founder offline journey live in the delivery packet. Master remains OPEN for
Founder acceptance. No real provider/OAuth, staging, production or deployment.

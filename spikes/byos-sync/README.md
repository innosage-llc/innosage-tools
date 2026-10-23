# Offline BYOS sync spike

This isolated test package exercises **published upstream engines**, not a copied sync algorithm. RxDB 17.6.0 (`9d60a86373730211c291f8c25668fca7aa531887`) uses its native Google Drive replication and Dexie IndexedDB storage; selfstore 1.8.29 (`d5900893187e8832dc5cba510a928819b2042236`) uses its native Drive/WebDAV targets, sync engine and IndexedDB cache. The lock pins every dependency and registry integrity. Exact published pins can differ from repository HEAD.

## Run and replay

From this directory, bootstrap once with `npm ci --ignore-scripts` (public dependency download; **not offline**). With dependencies and browser already installed, the experiments are entirely loopback:

```sh
npm test                         # focused mock/oracle/native integration tests
npm run run                      # fixed scenarios + 100 seeded trials per combination
npm run report                   # regenerate scorecard from evidence/results.json
node src/browser-smoke.mjs        # real Chromium renderer-crash + CORS smoke
node src/extra.mjs                # supplemental fixed reliability probes
node src/run.mjs --engine=rxdb --provider=drive --scenario=same-page --scale=10 --seed=84 --network=fast --policy=default --output=evidence/replay.json
node src/run.mjs --engine=rxdb --scenario=same-time-boundary --scale=30 --seed=84 --output=evidence/replay-boundary.json
```

Use `--trace=true` to retain complete HTTP body-byte traces for a single replay. All source bodies are synthetic. Fetch rejects every origin except the bound `127.0.0.1` server; selfstore's hardcoded Google origin is rewritten only at fetch transport. No real OAuth/token/account calls occur. The browser route guard blocks every nonloopback origin. Dependencies remain test-only, outside the public Next runtime. Node processes time out after 30 seconds (40 seconds for native request-timeout trials; 180 seconds for the 1,000-page diagnostic), then are killed before another trial begins. Partial timeout receipts preserve available counters and mark missing measurements UNKNOWN.

RxDB is loaded through its published CommonJS entry because the published ESM signaling module contains an extensionless import that Node ESM cannot resolve. No upstream source is changed. selfstore's native Drive target adopts a synthetic precreated file, so its discovery/create/OAuth costs are **NOT_RUN**, unlike RxDB's required internal directory/transaction/WAL initialization. This explicit bootstrap difference must be considered when interpreting cold cost. Native full-state transfer vs per-document transfer remains intact.

## Meaning of results

The primary gate checks unique **unsuperseded concurrent intentions** using both body markers and edit IDs. Equality alone cannot pass. A lost edit is absent from every reopened durable replica body and every full persisted conflict version. A version still local but unpropagated is reported separately, never mislabeled silently lost. `intent_preservation_rate=(applied on both replicas + recoverable full conflict versions)/acknowledged edits`; durable pending copies do not inflate completed preservation. A redacted journal ID is not a conflict copy. Reopened fake IndexedDB preserves backing databases inside one worker process; this is a client-object restart, **not OS process crash persistence**.

Local mutations use native put/upsert then explicit flush where applicable. selfstore `put()` itself only schedules saving; its promise alone is not a durability acknowledgement. The harness acknowledges after flush; offline failures can leave the remote unavailable while local IndexedDB is retained. Online post-ACK settle timing therefore excludes selfstore's work inside flush; the receipt separately records edit+flush latency and includes its requests in incremental resource counts. Detection is manual/foreground with three settling rounds; background live signaling is disabled. RxDB upstream Synced UI status is unavailable, so `false_synced_count=null` means UNKNOWN, not zero. selfstore `saved` after settled silent loss is recorded as a false-saved observation under this user-intent oracle, not a claim about an upstream promise to text-merge.

Conflict policy remains default unless `policy=manual`. Timing is configured for bounded experiments: RxDB transaction timeout 50ms/retry 20ms; selfstore debounce disabled effectively with 2147483647ms and explicit flush. These are **not upstream default timing**. Synthetic presets are fast 0±0ms, normal 8±2ms, degraded 35±10ms request delay. They are inputs, never measured provider latency. Application clocks and random crypto UUIDs are not seeded; operation selection/order and transport jitter are seeded. No cross-run exact ciphertext/byte equality is promised.

## Mock compatibility and limits

Contract `byos-loopback-v2` supports the exercised Drive v3 `files.list`, metadata/media GET, metadata creation and multipart upload; v2 metadata/media GET, conditional media PUT and DELETE; WebDAV GET/HEAD/PUT/OPTIONS. It applies name/parent/mime/modifiedTime filters, ordered listing, requested field projection, numeric page tokens, ETag/If-Match and Date headers. Unknown routes return 501 and invalidate a run. Conditional behavior is an HTTP/upstream assumption; real Drive v2/v3 interoperability is **REAL-PROVIDER-NOT-RUN**. Sources and provider quota rules: [provider-contracts](../../docs/byos-sync/provider-contracts.md).

The quota profile is configurable in `quota-profile.json`. Known method weights produce a **known subtotal**, with UNKNOWN-weight request counts alongside it. v2 and media GET weights are UNKNOWN, not zero. WebDAV has no Google quota score. Body bytes exclude HTTP headers/TLS. Storage footprint includes mock remote object bodies. Monetary cost is UNKNOWN.

The main suite covers initial/incremental sync; offline same/different pages; local client reopen with pending edits; concurrent delete/recreate; one-shot401/403/429/500; dropped-before-response and unknown-success writes; persistent401; and equal-modifiedTime boundary. `fault-timeout` withholds the HTTP response indefinitely; native deadlines may recover, otherwise the 40-second worker deadline censors the trial. `fault-delayed-response` delivers after 250ms. These are different faults.

The supplemental suite adds explicitly deleted parent+child tombstones versus a stale client with an unrelated edit, ±5-minute wall-clock skew during serial offline writes, concurrent reconnect, repeated-sync idempotence, replay of one cached GET response, a delayed GET during concurrent requests (observed completion reordering), one older changed RxDB file hidden from listing and then revealed, and WebDAV ETag omission with Last-Modified fallback. Replayed-response counts and completion-order inversions prove injection was exercised. The corrected visibility probe uses fresh unique intents after full settlement, records actual older/newer remote timestamps, and proves B received the newer edit and advanced its checkpoint before revealing the older object. Final outcome: FAIL to converge, one of two intents propagated, one still durably local, zero silently lost. The listing anomaly is an **adversarial hypothesis**, not a claim about Google behavior. Explicit deletion of two pages does not test automatic subtree cascading or orphan repair; those remain application semantics. Visibility stress applies to RxDB listing, not selfstore's adopted single-file GET path.

Browser evidence includes local durability crashes in two isolated contexts and **six remote-ACK crash cases**: native RxDB Drive and native selfstore WebDAV, each before the page/backup mutation, after mutation before its HTTP response, and after native completion following the response. A cold payload object is identified by ID/name; barriers record the exact object, method, version change and whether response delivery occurred. Offline body+ID edits are locally acknowledged in real IndexedDB; CDP crashes the renderer, the same browser context reopens, and bounded native resync plus an independent recipient checks preservation/propagation. RxDB uses two native foreground cycles per trigger (its first cycle can leave content in the native WAL). RxDB native Synced status remains UNKNOWN; selfstore native statuses are recorded. The browser bundle uses pinned events3.3.0 and a globalThis alias for upstream dependencies, with no upstream algorithm change. A native cross-origin selfstore WebDAV connection with omitted CORS fails visibly before any write. Browser/OS process kill, crash before local acknowledgement and selfstore Drive browser replication remain **NOT_RUN**. Node fake IndexedDB restart tests are client-object reopening in one process.

Remaining **NOT_RUN**: sustained transient backoff distributions; provider quota saturation; real-provider/OAuth/CORS/If-Match conformance; gateway/rclone deployment. Duplicate-response replay does not reproduce every network transport failure. The native adapters do not send conditional write headers in selfstore's tested paths; the mock supports them and the focused test verifies stale If-Match rejection. Missing WebDAV ETag fallback is not a conditional-write guarantee.

Unknown endpoint calls fail loudly but the mock is not a complete query parser or Google conformance suite. Browser policies, OAuth scopes, conditional headers and quota behavior require later real-provider validation.

The safety failures stop the 30-trial costly performance ranking. Normal 10/1,000-page single-edit cases are n=1 **diagnostics**, with no P50/P95 claim. The seeded suite varies page selection/reconnect order (fast has zero jitter), and checks safety/convergence separately; it is not exhaustive property testing. All failed/timed-out attempts remain in raw evidence. Historical development attempts are summarized in the session receipt and are not silently combined into final pinned-harness statistics.

## Smallest future real-provider smoke (not authorized or executed)

After fixing durable conflict recovery, use one explicitly approved disposable test account and isolated folder, least scopes, bounded request/egress budget, quota logging and cleanup plan. Test two-device initial/offline sync, one concurrent same-page conflict with reload recovery, one revoked-token and one uncertain-write recovery; verify actual v2/v3 ETag, checkpoint and CORS contracts before product adoption. No gateway/rclone deployment is needed for native WebDAV. No cloud setup or live calls occur in this spike.

Evaluation commands may exit zero while recording candidate `FAIL`, `BLOCKED`, `TIMEOUT` and `NO SAFE WINNER`; successful harness execution is not an engine safety PASS. Focused tests explicitly assert that known safety failures are detected. Full source/lock hashes are recorded before each measured run; final provenance distinguishes report-only changes without rewriting historical hashes.

The compact one-page decision is generated as [SUMMARY.md](SUMMARY.md); the expanded definitions and numeric rows are in [SCORECARD.md](SCORECARD.md). One-command focused verification, including full expected fixture content and retained siblings at both scales, is:

```sh
npm test && node src/fixture-check.mjs
```

Main trial equality/count observations alone do not prove baseline content. The independent fixture check compares both native replicas against every expected UUID, parentId, Markdown body and edit marker before and after the single-page edit and reopen, at10 and1,000 pages; it records canonical snapshot SHA256 digests. The negative fixture test rejects two equal replicas that lost the same page. Seeded tests remain bounded fixture/order variation, not exhaustive generated histories.

Final audit: `node src/receipt.mjs` verifies measured source hashes against final source, allowing explicitly identified report/receipt changes and changes to the independent supplemental entrypoint only for artifacts that never execute it; extra.json must match its own executed extra.mjs exactly. It preserves each run's original source manifest. `evidence/development-summary.json` records superseded developmental attempts and corrected harness defects.


Repair-round payload faults are armed after cold setup against actual `.json` page IDs, with unique edit content required in the request; the separate `fault-wal-unknown-success` case targets `rxdb-wal.json`. Lease writes cannot consume these faults. Recovery credit requires the target to have matched, and unknown-success requires a committed mutation with no response. Mock tests reject unrelated objects/content and distinguish a pre-mutation barrier. Historical round0 lease-fault results are superseded, not page-write evidence.

State agreement and intent-safe settlement are separate report predicates: `equal=true` compares canonical reopened replicas; `status=PASS` additionally requires no lost unsuperseded acknowledged intent, initial agreement, exercised fault boundary when requested, and no unsupported API. Equality denominators include only attempts with observed booleans; intent-safe denominators include all named attempts (unknown/timeout cannot pass). Use `--suite=seeded` when replaying seeded operation ordering.

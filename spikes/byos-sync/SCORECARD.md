# Offline BYOS decision scorecard

**NO SAFE WINNER.** Both default conflict policies lose one acknowledged concurrent same-page edit after native replica reopen. No candidate is ranked for adoption. All measurements below are **MOCK-TESTED**, synthetic loopback, **LOW_CONFIDENCE n=1** diagnostics after the correctness gate; no observed Google latency, provider validation or pricing is implied.

## Engine comparison — equivalent mock Google Drive

| Metric / units | RxDB → Drive | selfstore → Drive |
| --- | --- | --- |
| Default same-page safety (n=1) | FAIL; 1/2 applied; 0 durable conflict; 1 lost | FAIL; 1/2 applied; 0 durable conflict; 1 lost |
| Native false-Synced observations, same-page | UNKNOWN | 2 |
| Replica equality true / observed (fixed + seeded; unknown excluded) | 116/117 | 117/118 |
| Intent-safe settlement PASS / attempts (fixed; blocked auth excluded) | 14 / 18 | 14 / 17 |
| Faults injected / recovered / BLOCKED / unrecovered | 10 / 8 / 1 / 1 | 9 / 8 / 1 / 0 |
| Pending edit survives client reopen (n=1) | true | true |
| Offline different-page recovery ms (fast / degraded; n=1 each) | 513.01 / 9,676.56 | 45.87 / 739.35 |
| Default conflict policy / manual durable archives | master wins / NOT_RUN | LWW / 0 of 2 edits archived in manual probe |
| Retry count / backoff / detection lag | UNKNOWN / native policy, not measured / manual trigger | UNKNOWN / native policy, not measured / manual trigger |
| 10 pages: cold cycle HTTP requests / bytes ↑↓ | 143 / 10846 / 33637 | 12 / 971 / 2062 |
| 10 pages: B hydration ms / cold cycle ms (n=1) | 373.48 / 1,220.06 | 56.88 / 153.07 |
| 10 pages: single-edit requests / bytes ↑↓ | 169 / 2516 / 32785 | 20 / 987 / 6132 |
| 10 pages: known quota units + UNKNOWN-weight requests (edit) | 6,800 + 101 UNKNOWN | 115 + 6 UNKNOWN |
| 10 pages: post-ACK settle ms / transfer amplification × | 1,661.04 / 126.08 | 187.54 / 25.43 |
| 1000 pages: cold cycle HTTP requests / bytes ↑↓ | 5707 / 1093399 / 3068805 | 12 / 27790 / 55700 |
| 1000 pages: B hydration ms / cold cycle ms (n=1) | 8,817.43 / 25,452.81 | 81.68 / 216.31 |
| 1000 pages: single-edit requests / bytes ↑↓ | 167 / 2476 / 33244 | 20 / 27810 / 167070 |
| 1000 pages: known quota units + UNKNOWN-weight requests (edit) | 6,800 + 99 UNKNOWN | 115 + 6 UNKNOWN |
| 1000 pages: post-ACK settle ms / transfer amplification × | 1,672.46 / 127.57 | 295.32 / 696 |
| Seeded trials: PASS / FAIL / ERROR / TIMEOUT (n) | 50 / 50 / 0 / 0 (100) | 50 / 50 / 0 / 0 (100) |
| Fixed completed / failed / timed-out attempts | 18 / 3 / 1 | 18 / 3 / 0 |
| 30 normal timed-trial distributions / ranking | NOT_RUN — hard safety failure; P50/P95 not estimated | NOT_RUN — hard safety failure; P50/P95 not estimated |

## Provider comparison — same selfstore engine

| Metric / units | selfstore → Drive | selfstore → WebDAV |
| --- | --- | --- |
| Default same-page safety (n=1) | FAIL; 1/2 applied; 0 durable conflict; 1 lost | FAIL; 1/2 applied; 0 durable conflict; 1 lost |
| Native false-Synced observations, same-page | 2 | 2 |
| Replica equality true / observed (fixed + seeded; unknown excluded) | 117/118 | 117/118 |
| Intent-safe settlement PASS / attempts (fixed; blocked auth excluded) | 14 / 17 | 14 / 17 |
| Faults injected / recovered / BLOCKED / unrecovered | 9 / 8 / 1 / 0 | 9 / 8 / 1 / 0 |
| Pending edit survives client reopen (n=1) | true | true |
| Offline different-page recovery ms (fast / degraded; n=1 each) | 45.87 / 739.35 | 60.36 / 983.59 |
| Default conflict policy / manual durable archives | LWW / 0 of 2 edits archived in manual probe | LWW / 0 of 2 edits archived in manual probe |
| Retry count / backoff / detection lag | UNKNOWN / native policy, not measured / manual trigger | UNKNOWN / native policy, not measured / manual trigger |
| 10 pages: cold cycle HTTP requests / bytes ↑↓ | 12 / 971 / 2062 | 15 / 966 / 1932 |
| 10 pages: B hydration ms / cold cycle ms (n=1) | 56.88 / 153.07 | 70.35 / 177.23 |
| 10 pages: single-edit requests / bytes ↑↓ | 20 / 987 / 6132 | 27 / 982 / 5892 |
| 10 pages: known quota units + UNKNOWN-weight requests (edit) | 115 + 6 UNKNOWN | N/A |
| 10 pages: post-ACK settle ms / transfer amplification × | 187.54 / 25.43 | 250.53 / 24.55 |
| 1000 pages: cold cycle HTTP requests / bytes ↑↓ | 12 / 27790 / 55700 | 15 / 27792 / 55584 |
| 1000 pages: B hydration ms / cold cycle ms (n=1) | 81.68 / 216.31 | 90.93 / 237.74 |
| 1000 pages: single-edit requests / bytes ↑↓ | 20 / 27810 / 167070 | 27 / 27813 / 166878 |
| 1000 pages: known quota units + UNKNOWN-weight requests (edit) | 115 + 6 UNKNOWN | N/A |
| 1000 pages: post-ACK settle ms / transfer amplification × | 295.32 / 696 | 355.35 / 695.33 |
| Seeded trials: PASS / FAIL / ERROR / TIMEOUT (n) | 50 / 50 / 0 / 0 (100) | 50 / 50 / 0 / 0 (100) |
| Fixed completed / failed / timed-out attempts | 18 / 3 / 0 | 18 / 3 / 0 |
| 30 normal timed-trial distributions / ranking | NOT_RUN — hard safety failure; P50/P95 not estimated | NOT_RUN — hard safety failure; P50/P95 not estimated |

Equality counts canonical reopened-state agreement only; intent-safe settlement PASS also requires no lost unsuperseded acknowledged intentions, initial agreement, exercised requested fault targets and no unsupported API. Equality denominators omit unavailable booleans; PASS denominators retain all named attempts.

Input: [results.json](evidence/results.json); regenerate with `npm run report`. Each raw attempt records source pins, scenario, scale, seed, synthetic transport, replay, status, measured request mix, units and denominators. Per-method unknown weights are never zero. Counts include native retry attempts; a request is not automatically classified as a retry merely because method/path repeats.

Online duration starts after explicit local flush acknowledges durability; selfstore may already upload during that flush, so its local-edit-plus-flush time is separately recorded. Cold cycle starts after replica/target construction and includes A upload + B hydration + A sync; it excludes target bootstrap, while total-trial request counters retain bootstrap. RxDB non-live replication reinitializes on each foreground cycle; these diagnostics cannot rank persistent background polling cost; B hydration is separately timed. Offline duration starts after restoring connectivity. All runs use foreground sync triggers and three settling rounds, not production background detection. Transfer amplification denominator = UTF-8 serialized changed record(s); bytes are HTTP entity bodies, excluding headers/TLS.

The 100 seeded trials per combination vary edited document and reconnect order (fast has zero jitter). They are a bounded operation-schedule property suite, not arbitrary distributed histories or clock-skew fuzzing. Same-time checkpoint failure can leave edits durable on A but unpropagated to B; this is a convergence failure, not silent loss. Browser evidence proves native selfstore IndexedDB and RxDB Dexie across abrupt renderer crash/reopen in two isolated Chromium contexts; selfstore also retains an offline pending WebDAV edit. Supplemental remote-ACK browser cases separately record payload mutation/response barriers and native recovery; no OS/browser process crash claim.

Corrected supplemental visibility probe: RxDB FAIL under the adversarial listing hypothesis; fresh older intent remains locally durable after B observes newer intent and advances checkpoint. Applied1/2, durable-unpropagated1, silently lost0. Actual timestamps and before/after states are recorded in extra.json.

Recommendation: **HOLD / NO SAFE WINNER**. Retain Google Drive as preferred eventual provider and WebDAV as a secondary option, but first require durable conflict-version preservation and retest. selfstore manual policy is separately tested and must not be mistaken for a durable archive. RxDB needs a checkpoint/pagination repair upstream. The optional rclone bridge is architecture-only and adds an operated/authenticated gateway.

See [README](README.md) for fidelity, omitted scenarios, source-level boundaries and replay. Real-provider validation is **REAL-PROVIDER-NOT-RUN**.

Supplemental native edge suite: 19/20 PASS (parent/child deletion and stale replay, ±5min wall clocks, concurrent reconnect, repeated sync, cached duplicate/reordered response, visibility hypothesis, missing WebDAV ETag). Browser tests: selfstore/native WebDAV pending-offline persistence two isolated Chromium IndexedDB contexts; abrupt renderer crash after local durability ACK: PASS; rxdb/NOT_RUN: local Dexie persistence only two isolated Chromium IndexedDB contexts; abrupt renderer crash after local durability ACK: PASS; rxdb/drive before-mutation: PASS; rxdb/drive after-mutation-before-response: PASS; rxdb/drive after-ack: PASS; selfstore/webdav before-mutation: PASS; selfstore/webdav after-mutation-before-response: PASS; selfstore/webdav after-ack: PASS; selfstore/webdav native cross-origin target connection when server omits CORS: PASS. See [extra.json](evidence/extra.json) and [browser-smoke.json](evidence/browser-smoke.json).

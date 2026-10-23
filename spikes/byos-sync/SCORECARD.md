# Offline BYOS decision scorecard

**NO SAFE WINNER.** Both default conflict policies lose one acknowledged concurrent same-page edit after native replica reopen. No candidate is ranked for adoption. All measurements below are **MOCK-TESTED**, synthetic loopback, **LOW_CONFIDENCE n=1** diagnostics after the correctness gate; no observed Google latency, provider validation or pricing is implied.

## Engine comparison — equivalent mock Google Drive

| Metric / units | RxDB → Drive | selfstore → Drive |
| --- | --- | --- |
| Default same-page safety (n=1) | FAIL; 1/2 applied; 0 durable conflict; 1 lost | FAIL; 1/2 applied; 0 durable conflict; 1 lost |
| Native false-Synced observations, same-page | UNKNOWN | 2 |
| Eligible converged / attempts (fixed; blocked auth excluded) | 13 / 17 | 14 / 17 |
| Faults injected / recovered / BLOCKED / unrecovered | 9 / 7 / 1 / 1 | 9 / 8 / 1 / 0 |
| Pending edit survives client reopen (n=1) | true | true |
| Offline different-page recovery ms (fast / degraded; n=1 each) | 501.83 / 8,238.7 | 45.24 / 733.72 |
| Default conflict policy / manual durable archives | master wins / NOT_RUN | LWW / 0 of 2 edits archived in manual probe |
| Retry count / backoff / detection lag | UNKNOWN / native policy, not measured / manual trigger | UNKNOWN / native policy, not measured / manual trigger |
| 10 pages: cold cycle HTTP requests / bytes ↑↓ | 141 / 10849 / 33285 | 12 / 969 / 2058 |
| 10 pages: B hydration ms / cold cycle ms (n=1) | 382.88 / 1,202.55 | 57.14 / 153.83 |
| 10 pages: single-edit requests / bytes ↑↓ | 169 / 2516 / 32785 | 20 / 985 / 6120 |
| 10 pages: known quota units + UNKNOWN-weight requests (edit) | 6,800 + 101 UNKNOWN | 115 + 6 UNKNOWN |
| 10 pages: post-ACK settle ms / transfer amplification × | 1,670.24 / 126.08 | 185.92 / 25.38 |
| 1000 pages: cold cycle HTTP requests / bytes ↑↓ | 5599 / 1093352 / 3018789 | 12 / 27792 / 55704 |
| 1000 pages: B hydration ms / cold cycle ms (n=1) | 8,754.03 / 25,347.33 | 81.72 / 218.73 |
| 1000 pages: single-edit requests / bytes ↑↓ | 167 / 2476 / 33244 | 20 / 27813 / 167088 |
| 1000 pages: known quota units + UNKNOWN-weight requests (edit) | 6,800 + 99 UNKNOWN | 115 + 6 UNKNOWN |
| 1000 pages: post-ACK settle ms / transfer amplification × | 1,683.05 / 127.57 | 305.59 / 696.08 |
| Seeded trials: PASS / FAIL / ERROR / TIMEOUT (n) | 50 / 50 / 0 / 0 (100) | 50 / 50 / 0 / 0 (100) |
| Fixed completed / failed / timed-out attempts | 17 / 3 / 1 | 18 / 3 / 0 |
| 30 normal timed-trial distributions / ranking | NOT_RUN — hard safety failure; P50/P95 not estimated | NOT_RUN — hard safety failure; P50/P95 not estimated |

## Provider comparison — same selfstore engine

| Metric / units | selfstore → Drive | selfstore → WebDAV |
| --- | --- | --- |
| Default same-page safety (n=1) | FAIL; 1/2 applied; 0 durable conflict; 1 lost | FAIL; 1/2 applied; 0 durable conflict; 1 lost |
| Native false-Synced observations, same-page | 2 | 2 |
| Eligible converged / attempts (fixed; blocked auth excluded) | 14 / 17 | 14 / 17 |
| Faults injected / recovered / BLOCKED / unrecovered | 9 / 8 / 1 / 0 | 9 / 8 / 1 / 0 |
| Pending edit survives client reopen (n=1) | true | true |
| Offline different-page recovery ms (fast / degraded; n=1 each) | 45.24 / 733.72 | 57.34 / 985.72 |
| Default conflict policy / manual durable archives | LWW / 0 of 2 edits archived in manual probe | LWW / 0 of 2 edits archived in manual probe |
| Retry count / backoff / detection lag | UNKNOWN / native policy, not measured / manual trigger | UNKNOWN / native policy, not measured / manual trigger |
| 10 pages: cold cycle HTTP requests / bytes ↑↓ | 12 / 969 / 2058 | 15 / 970 / 1940 |
| 10 pages: B hydration ms / cold cycle ms (n=1) | 57.14 / 153.83 | 68.87 / 174.83 |
| 10 pages: single-edit requests / bytes ↑↓ | 20 / 985 / 6120 | 27 / 985 / 5910 |
| 10 pages: known quota units + UNKNOWN-weight requests (edit) | 115 + 6 UNKNOWN | N/A |
| 10 pages: post-ACK settle ms / transfer amplification × | 185.92 / 25.38 | 253.23 / 24.63 |
| 1000 pages: cold cycle HTTP requests / bytes ↑↓ | 12 / 27792 / 55704 | 15 / 27799 / 55598 |
| 1000 pages: B hydration ms / cold cycle ms (n=1) | 81.72 / 218.73 | 95.83 / 240.01 |
| 1000 pages: single-edit requests / bytes ↑↓ | 20 / 27813 / 167088 | 27 / 27818 / 166908 |
| 1000 pages: known quota units + UNKNOWN-weight requests (edit) | 115 + 6 UNKNOWN | N/A |
| 1000 pages: post-ACK settle ms / transfer amplification × | 305.59 / 696.08 | 371.56 / 695.45 |
| Seeded trials: PASS / FAIL / ERROR / TIMEOUT (n) | 50 / 50 / 0 / 0 (100) | 50 / 50 / 0 / 0 (100) |
| Fixed completed / failed / timed-out attempts | 18 / 3 / 0 | 18 / 3 / 0 |
| 30 normal timed-trial distributions / ranking | NOT_RUN — hard safety failure; P50/P95 not estimated | NOT_RUN — hard safety failure; P50/P95 not estimated |

Input: [results.json](evidence/results.json); regenerate with `npm run report`. Each raw attempt records source pins, scenario, scale, seed, synthetic transport, replay, status, measured request mix, units and denominators. Per-method unknown weights are never zero. Counts include native retry attempts; a request is not automatically classified as a retry merely because method/path repeats.

Online duration starts after explicit local flush acknowledges durability; selfstore may already upload during that flush, so its local-edit-plus-flush time is separately recorded. Cold cycle starts after replica/target construction and includes A upload + B hydration + A sync; it excludes target bootstrap, while total-trial request counters retain bootstrap. RxDB non-live replication reinitializes on each foreground cycle; these diagnostics cannot rank persistent background polling cost; B hydration is separately timed. Offline duration starts after restoring connectivity. All runs use foreground sync triggers and three settling rounds, not production background detection. Transfer amplification denominator = UTF-8 serialized changed record(s); bytes are HTTP entity bodies, excluding headers/TLS.

The 100 seeded trials per combination vary edited document, reconnect order and deterministic jitter. They are a bounded operation-schedule property suite, not arbitrary distributed histories or clock-skew fuzzing. Same-time checkpoint failure can leave edits durable on A but unpropagated to B; this is a convergence failure, not silent loss. Browser evidence proves native selfstore IndexedDB and RxDB Dexie across abrupt renderer crash/reopen in two isolated Chromium contexts; selfstore also retains an offline pending WebDAV edit. It does not prove OS/browser process crash recovery.

Recommendation: **HOLD / NO SAFE WINNER**. Retain Google Drive as preferred eventual provider and WebDAV as a secondary option, but first require durable conflict-version preservation and retest. selfstore manual policy is separately tested and must not be mistaken for a durable archive. RxDB needs a checkpoint/pagination repair upstream. The optional rclone bridge is architecture-only and adds an operated/authenticated gateway.

See [README](README.md) for fidelity, omitted scenarios, source-level boundaries and replay. Real-provider validation is **REAL-PROVIDER-NOT-RUN**.

Supplemental native edge suite: 20/20 PASS (parent/child deletion and stale replay, ±5min wall clocks, concurrent reconnect, repeated sync, cached duplicate/reordered response, visibility hypothesis, missing WebDAV ETag). Browser tests: selfstore: PASS, rxdb: PASS, selfstore: PASS. See [extra.json](evidence/extra.json) and [browser-smoke.json](evidence/browser-smoke.json).

# Implementation evidence — offline BYOS spike

Executor scope: `spikes/byos-sync/**` plus this session. No commits, pushes, PRs, deployments, external provider setup or real provider calls performed by executor. Parent owns native root gates and independent review.

Published packages: RxDB17.6.0 / gitHead9d60a86373730211c291f8c25668fca7aa531887; selfstore1.8.29 / gitHeadd5900893187e8832dc5cba510a928819b2042236. Registry integrities and transitive versions are pinned in the isolated lock. Native CJS RxDB replication+Dexie and native selfstore targets+IndexedDB are exercised; no sync algorithm is copied/reimplemented.

Initial development found harness defects, corrected before final freeze: quoted multipart boundary parsing; IPC result flushing; equal-time durable-unpropagated versus silent-loss accounting; inconsistent fixed mock metadata dates; offline WebDAV target recreation; expected CORS-error assertion. Developmental unknown-success timeout from inconsistent mock dates is **invalid as engine failure evidence**. Development attempts are summarized in `spikes/byos-sync/evidence/development-summary.json`; ignored raw development logs remain local.

The final main suite, supplemental suite and browser smoke capture SHA256 source/lock manifests before execution. `src/receipt.mjs` compares these historical manifests with final sources and allows only report/receipt source drift. Historical hashes are never rewritten. Exact integrated Git/PR head remains parent-owned.

Focused tests assert mock contracts, quota UNKNOWN accounting, unique-intent oracle regressions, three native happy paths, native same-page losses and equal-time checkpoint stall. Expected candidate FAILs are successful *detection tests*, not product safety PASSs.

Main observations before review: both default engines drop one of two acknowledged same-page edits after native reopen; selfstore manual policy still lacks recoverable full conflict bodies. RxDB equal-time fixture propagates16/30, with14 still durably local, not silently lost. Safety-gated 30-trial ranking is NOT_RUN; n1 normal10/1000 diagnostics remain LOW_CONFIDENCE. Supplementary fixtures and real browser renderer-crash evidence bound additional behavior, not live-provider correctness.

Read `spikes/byos-sync/README.md`, generated `SCORECARD.md`, raw evidence and `provenance.json` for replay and limits. Parent source/license/provider audit lives in `docs/byos-sync/`.


Repair round1 addresses the independent review's payload-target, remote-ACK renderer crash and convergence-label findings. Faults match cold payload IDs/names and unique request bodies; unknown-success records committed payload mutation with no response, separately for page and WAL. Browser evidence now covers before mutation, after mutation before response, and after native completion for RxDB Drive/selfstore WebDAV, all with body+ID recovery in a separate recipient. It remains renderer-only, not OS/process crash proof. The native browser bundle requires pinned events3.3.0 and a globalThis compatibility alias.

The lead additionally identified a visibility-probe false-positive risk. Corrected standalone extra.mjs fully settles before two fresh unique edits, orders actual remote timestamps, hides the older object, proves B received newer state and advanced its list checkpoint, then reveals. Result: convergence FAIL, applied1/2, durable-unpropagated1, silently lost0. Old20PASS supplemental receipt is explicitly superseded in development-summary. This independent-entrypoint repair does not change the imported runtime of main/browser/fixture evidence; provenance identifies its nonexecuted drift separately from report-only drift and requires exact extra.mjs for extra.json itself.

Final repair evidence: main355 (192 PASS,159 FAIL,3 BLOCKED,1 TIMEOUT); extra20 (19 PASS,1 FAIL); browser9 PASS (3 earlier narrow assertions +6 remote-boundary assertions); fixture6 PASS; focused tests21 PASS. Seeded equality100/100 and intent-safe PASS50/100 per combination are reported separately. Normal timed diagnostics completed before supplementary runs; overlapping fast seeded safety trials are not performance-ranked. Historical source hashes remain intact. Generated console files have trailing whitespace normalized.

# Current remediation state

FOUNDATION_READY_FOR_INDEPENDENT_REVIEW, not full acceptance. Astra HIGH executor completed three distinct meaningful A1–A3 hypotheses in the new isolated `spikes/byos-remediation` package. The route uses native RxDB/Dexie immutable local revisions plus a small custom conditional fixed-snapshot protocol; it does not alter baseline/native replication behavior.

- A1: both complete concurrent bodies survive two local reopenings as recoverable heads; ID-content integrity, idempotence and explicit resolution retain full history.
- A2: both custom Drive-shaped PATCH and WebDAV PUT paths exercise same-ETag racing reads, a real 412/reload, two reopenings and fresh third restore. A new local edit ACKs while the remote write is held and remains pending until verified.
- A3: 38 cases, 152 sampled states, zero observed false local/remote/pending states. Unknown-success/interrupted receipt/stale readback/auth/transient/malformed/validator faults preserve full bodies; 30 equal-time edits and hidden-listing/reveal recover via algorithm replacement.
- Final formatted foundation regression suite: 4 passed, 0 failed, 0 skipped. Historical source/raw evidence retained; machine and human attempt ledgers updated.

Next lead-owned work: exact-head separate Astra HIGH independent review, self-contained locked dependency install, native gates and first reviewed incremental PR/integration. Executor is paused at the requested engineering handoff and can resume the same authorized task afterward.

Still NOT RUN / incomplete: full R5 safety and real browser crash matrix, normal-network quantitative R6 comparison, R7 reviewed integration and final AC/R evidence map. Specifically test suppressed descendant edits as visible recovery-needed/deletion-conflict, concurrent recreates/resolutions, stale clients and clock skew. All history remains uncollected; growing snapshot cost is an explicit prototype limitation. No production adoption claim, real-provider setup, deployment, or Master closure.

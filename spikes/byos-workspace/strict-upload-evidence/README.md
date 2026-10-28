# Strict per-page upload onset: architectural blocker

**BLOCKED on a protocol decision; no new staging candidate is ready.** The latest Founder authorization on [#142](https://github.com/innosage-llc/innosage-tools/issues/142) requires each page's current version to begin an actual content upload about five seconds after its own last input, without waiting for unrelated pages or a workspace sync. It simultaneously preserves the existing native transaction/CAS/WAL protocol. Source inspection, a bounded local counterexample and independent principal advice identify a conflict between those constraints. An independent timer or more eager scheduler alone cannot satisfy this requirement.

No runtime implementation, deployment, Chrome action, real Drive request, recovery or retry was performed for this audit. Existing runtime remains `cbfb1054319a19bb2bd1003ebbc307bee902f372` / v0.1.7. [PR146's failed real sample](../IDLE-LIVE-REPORT.md), its raw artifacts, original twelve pages, and A's twenty-six pending intents are preserved. This local test does not diagnose the root cause of that earlier180s timeout.

## Mechanism, not just a slow timer

The pinned dependency is RxDB17.6.0 from `spikes/byos-sync/package-lock.json`. Its installed ESM source hashes are recorded in [counterexample.json](counterexample.json).

| Source / entry point | Relevant behavior |
| --- | --- |
| [Changes adapter](../../byos-sync/changes-feasibility/adapter.mjs), `pullHandler` and push handler | Both use the same workspace `driveStructure` and `runInTransaction`. |
| Native `replication-google-drive/transaction.js`, `runInTransaction` | Acquire shared lease → drain previous WAL → run callback → release lease. Another transaction can occupy the lease across a page's deadline. |
| Native `replication-google-drive/upstream.js`, `handleUpstreamBatch` | Read remote conflicts, then write current documents into the shared WAL. Returning does not mean page files were uploaded. |
| Same source, `processWalFile` | Read WAL, locate document files and fetch existing-file ETags before writing page content. These are real variable-latency dependencies. |
| Native `replication-google-drive/document-handling.js`, `updateDocumentFiles` | Conditional page-content PUTs use five workers. A later document may wait for an earlier response even within one batch. |
| Native `replication-protocol/upstream.js`, `processTasks` / persistence | Persistence cycles queue/coalesce; split batches can run concurrently but still contend for the shared Drive lease. |
| [PageStore](../../byos-sync/native-overlay/page-store.mjs), `save` / `_sync` | Save journals and updates the replicated collection. Sync starts and settles at collection scope, rather than dispatching a selected page/version at a deadline. |

`batchSize:1` does not remove the shared lease. `start`, `pause`, `reSync` and `sent$` do not expose a generation-aware boundary immediately before the page-content request. A push modifier can delay a batch, but is awaited with other modifiers before dispatch; returning null records replication metadata rather than serving as a safe temporary retry queue. Pre-acquiring a lease before idle eligibility does not remove cross-page contention or guarantee that remote conflict/ETag state remains valid at dispatch. Shortening the transaction timeout to5s would not cancel a previous owner's in-flight requests and is not an acceptable workaround.

Timer jitter and network latency are separate from this structural dependency. This report does not claim any architecture can guarantee an exact wall-clock instant in every browser/network condition. It demonstrates that the present path explicitly waits on unrelated shared work, contrary to the requested independent onset. A lucky fast-network sample would not remove that dependency.

## Reproducible local evidence

Replay from Tools root after the existing pinned dependencies are installed:

```sh
node spikes/byos-workspace/strict-upload-evidence/counterexample.mjs
```

[The probe](counterexample.mjs) imports the installed native helper implementations unchanged and uses the existing task-owned loopback mock. A fetch guard rejects every non-loopback origin. No browser or real provider is accessed. It records actual page-file PUT bodies by page ID, editId and full document hash; transaction CAS, WAL and GET requests are separately excluded from content-upload onset.

Two assertions passed:

1. Native `runInTransaction(handleUpstreamBatch)` returned with the new A generation in WAL while A's page file still contained its old complete record. A subsequent native transaction materialized the new page. This directly prevents counting push/WAL success as a page-file upload.
2. A legal shared transaction was held for about7s, well within its existing60s lease limit. Synthetic A and B input markers were1s apart. Each corresponding native push call was invoked after its own independent5s deadline. At6.5s neither page-content nor WAL upload had started. Releasing the transaction allowed both writes to proceed, with exact final document/hash matching afterward.

All table values are monotonic milliseconds from the probe origin:

| Page | Synthetic input | Own5s deadline | Native handler invoked | Actual matching page PUT | PUT lateness beyond deadline |
| --- | ---: | ---: | ---: | ---: | ---: |
| A | 0.037 | 5000.037 | 5001.447 | 7373.066 | 2373.029 |
| B | 1001.855 | 6001.855 | 6003.529 | 7402.947 | 1401.092 |

The recorded probe made64 measured loopback requests and0 real provider calls. Both final synthetic documents match their exact editId/body oracle. This is a controlled native-helper counterexample, **not** a26-page application test, local durable-ACK benchmark, real Drive latency, or failure of an actual customer network. Its synthetic input markers are not editor input events. The deliberate holder is a legal shared-lock state, not evidence that the earlier live run had that exact state. The original provider timeout sample remains separate and unchanged.

## Minimum decision before implementation can continue

The requested product behavior remains the target. The smallest additional authority needed is a **bounded Tools-only protocol/dispatch design and validation spike** that may change the shared transaction/WAL composition or synchronization boundary to remove unrelated-page blocking, while preserving one accountable owner, local protected intent, CAS/conflict protection, complete-record verification, the existing account/folder/scope and all prior data. This authorizes investigation, not a presumption that a particular new design is safe or meets5s. A proposed design must make its dispatch-generation check, crash recovery, concurrent-client behavior, retry/unknown-write handling and timing assumptions reviewable before deployment or live use.

No native fork, new engine, competing per-page owner, direct page write bypass, new folder/scope, or lease weakening has been implemented. Such a change is outside the current explicit no-protocol-redesign boundary and cannot be self-approved as a routine timer repair. The alternative would be an explicit product decision accepting shared-transaction queue/network delay; that would weaken the stated requirement and has not been adopted.

Useful optimizations under review, such as independent journal-to-replication promotion or materializing WAL inside the same transaction after native push, may reduce latency but retain the cross-page dependency. They are not submitted as a satisfying implementation. `runAfter` materialization would execute outside the lease and is unsuitable.

**Blocked action:** implement and validate independent page-content upload onset with a changed protocol/dispatch boundary. **Target:** isolated Tools prototype only. **Reason:** current shared transaction/WAL path cannot provide the required independent onset. **Status:** additional architectural authority pending; no platform denial and no uncertain live action. Completed: latest-issue reconciliation, source audit, read-only principal advice, executable local counterexample, preserved historical evidence. Chrome was not acquired; real A–Z/B/close-reopen validation and a new staging release are NOT_RUN. Founder final acceptance remains pending and #142 stays open.

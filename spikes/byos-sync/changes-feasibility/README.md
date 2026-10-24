# Tools109: changed Changes adapter, bounded mock evidence

This is an explicitly changed Drive discovery adapter composed from public pinned RxDB17.6 primitives. It is **not** a stock Drive-plugin configuration fix. Stock107 C3 failures and C2 uncertainty remain unchanged. The packet supports lead convergence and independent review; no real Google, unattended, product or deployment qualification follows.

From `spikes/byos-sync` in the owning Hub workspace:

```sh
node --check changes-feasibility/run.mjs
node --check changes-feasibility/adapter.mjs
node --check changes-feasibility/provider.mjs
node --check changes-feasibility/cases.mjs
node changes-feasibility/run.mjs --self-check
node changes-feasibility/check.mjs
```

The offline checker does not contact any server or rerun research. For separately authorized replay in an isolated copy, `node changes-feasibility/run.mjs --freeze` rebuilds the source-identical PageStore with the recorded import binding, expands the fixture and archives sources before execution. Then invoke `node changes-feasibility/run.mjs <case-id> <new-attempt-label>`. Existing directories reject overwrite. Case IDs and exact executed commands are in `criterion-map.json` and individual receipts. Preserve all earlier attempts; do not turn this into a broad campaign.

A replay can also use a fresh attempt label in this exact workspace without copying, resetting or deleting anything. From `spikes/byos-sync`, rebuild with `node changes-feasibility/run.mjs --freeze` if generated bindings are absent, then run one approved case such as `node changes-feasibility/run.mjs S1_PAGE_TRAVERSAL replay-20261024-01`. The parent creates a new sibling evidence directory `evidence/S1_PAGE_TRAVERSAL-replay-20261024-01`; each child creates fresh synthetic database names and its own loopback server. Original evidence remains intact, and an existing attempt label fails before execution. Reuse that one label only if its directory does not yet exist; select a new label for another authorized attempt.

| Decisive invocation | Actual outcome | Admitted HTTP requests | Milliseconds |
| --- | --- | ---: | ---: |
| S0_TRANSITION a2 | Bounded PASS | 832 | 2695.006 |
| S1_PAGE_TRAVERSAL a1 | Bounded PASS | 358 | 1219.561 |
| S2_BOOTSTRAP_PERSIST_BARRIER a1 | Bounded PASS | 242 | 997.935 |
| S3_READ_FAILURE_REPLAY a1 | Bounded PASS | 235 | 1244.644 |
| S4_RETAINED_EVENT a1 | Bounded PASS under retained-event assumption | 330 | 1409.049 |
| S4_NO_EVENT a1 | Recovery FAIL / NOT_PROVEN boundary | 240 | 1006.451 |
| S5_LOST_RESPONSE_INTENT a3 | Bounded PASS with full barrier captures | 880 | 4224.244 |

Exit0 means an experiment completed, including the deliberately negative S4_NO_EVENT; it does not convert that negative to recovery PASS. Source/capture/setup/cap failure returns INCONCLUSIVE/exit2. S0a1 is preserved INCONCLUSIVE at1000 requests: request1001 was rejected before dispatch, after979 setup requests and21 adapter-init requests, with no pull return. Lead-approved setup reductions removed redundant normal sync work without weakening assertions; S0a2 then completed within the same budget.

S5a1 is preserved INCONCLUSIVE because the E-race writer still assumed old C and lost its proposed E under default Master Wins. Its successful-WAL/lost-response interval and newer-generation journal are partial observations, not aggregate PASS. S5a2 refreshed that writer and verified actual remote E; runtime assertions passed, but the post-E-race M+B/C journal lacked its own raw snapshot. Capture-only S5a3 adds that exact snapshot without changing the schedule, oracle or limits. All attempts and their source freezes remain immutable. `ledger.json` records causes and narrow reruns.

The parent owns one task child and kills only that child at179500ms, reserving margin within180s for archival. A synchronous exact-origin guard admits at most1000 loopback fetches and blocks request1001 before dispatch; every native call goes to the one shared mock server. No timeout occurred, and no actual timeout-fault claim is made. The admission self-check and actual S0a1 cap demonstrate the request boundary. In S5, one admitted/dispatched request intentionally has no response; its fetch error and mutation receipt complete the accounting.

Every attempt has complete event/request/response bodies, direct independent mock inventory/full raw bodies, provider token/event state, native physical pages, assumed-master metadata, actual persisted checkpoints, journals/views and native faults at decisive phases. `sources-{pre,post}.json.gz` carry46 source bodies/paths/hashes, including pinned CJS and TS primitives/Drive/WAL/CAS/checkpoint/conflict sources, lockfile, unchanged mock and unchanged PageStore. Console bytes including native SDK trailing spaces are preserved in `console.txt.gz` with original-byte SHA in the receipt. No original fixture text or synthetic config is removed. Paths in durable metadata use repository-relative forms.

The esbuild import binding is explicit in `binding.json`: the original PageStore entry text remains byte-identical (`5b906e26c2cc979b494ef9a19d346bd5daefd13cc426f7e6d21ad089acb68490`). Journal/save/resolve/verify logic is unchanged. Only its Drive factory import selects stock or Changes composition for the fixture. Adapter push is unchanged public `runInTransaction` plus `handleUpstreamBatch`; pull uses the native transaction/WAL drain and complete content helper before native admission. No metadata writes/reset/removal, identifier rotation, custom conflict handler, native fork or receiver upsert fallback occurs. Read-only metadata storage instances and the S2 temporary real storage-write barrier are fixture instrumentation.

Source versions differ only where documented. S0a2 used freeze002; S1–S4 used003; S5a3 used005. `audit-report.json` verifies each complete source archive against its actual freeze, and accepted case branches/shared helpers remain byte-identical in current `cases.mjs`. Native/runtime harness/adapter/provider/build bytes are unchanged across those accepted cases. No claim that historical execution used the later whole-file hash is made.

Limits and boundaries matter. Positive bootstrap assumes a finite quiescent paginated inventory except the recorded race, followed by retained relevant Changes and readable full current bodies. The fixture supplies opaque tokens and honors requested page maxima. It is test data, not evidence of actual provider retention or an immutable historical body log. No-event S4 retains stale A while source C is visible and does not rescan/backfill or fabricate a restoration event. Terminal zero-relevant batches cannot persist checkpoint-only progress through these native APIs: S1 retains its old durable token and safely replays, then discovers a later real change. No synthetic anchor or extra durable queue was introduced.

S2's pre-write durable down checkpoint is actually null, as archived; the physical target and assumed-master are absent at the paused write while the handler cursor covers its event. After release they persist before eligible progress. This proves that bounded storage window, not a process crash; fake-indexeddb is process-local. S0 independently proves the legacy-checkpoint migration inequality. S3 injected503 is retried inside the unchanged content helper; no callback-throw/transaction-timeout claim is made for S3 despite generic limitation text in its immutable raw result. S5 exercises a native callback failure/lost response and unchanged WAL/timeout/CAS recovery.

`criterion-map.json`, `audit-report.json` and `artifact-manifest.json` are the compact handoff. Requested worker is Sol HIGH; host-routed/provider-observed identities/efforts and usage/cost remain UNKNOWN. Lead final convergence, distinct independent review, owning full gates and initially draft PR are pending. No commit/push/PR/merge or repository gate was run by this worker.

Packaging-only path normalization replaces the absolute local prefix with `<byos>` inside three native error stack rows. `packaging-provenance.json` and receipts preserve original/packaged hashes and prove every non-error event line byte-identical; original files remain ignored in `.generated`. No executed source or case outcome changed.

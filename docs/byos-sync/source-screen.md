# Source screen: BYOS sync engines

Audit date: 2026-10-23. Source observations are not runtime results. Installed candidates are RxDB 17.6.0 (`9d60a86373730211c291f8c25668fca7aa531887`) and selfstore 1.8.29 (`d5900893187e8832dc5cba510a928819b2042236`). Exact package integrity and experiment configuration belong to the harness manifest.

| Approach | Source-grounded capability | Adoption/integration concern | Execution lane |
| --- | --- | --- | --- |
| RxDB Drive replication | Native Drive v2/v3; document-to-file mapping, modifiedTime checkpoint, transaction file; configurable API endpoint | Drive plugin remains beta; schema/storage/conflict handling and retry semantics require verification | Candidate 1 |
| selfstore | IndexedDB working copy; native Drive/WebDAV targets; HLC-based full-state merge; configurable record/field/manual strategies | Full-state transfer amplification; conflict callback is not proof of durable conflict recovery; small upstream ecosystem | Candidate 2 |
| Yjs | Shared CRDT types, binary updates and network-independent merge | Needs an actual durable transport/provider design, page/tree/deletion semantics and compaction decisions; cannot simply substitute whole Markdown strings and claim text preservation | Source reference only |
| Automerge | Local CRDT documents, change history, offline updates and separate storage/network integrations | Additional storage/sync integration and browser/WASM lifecycle; application identity/tree/deletion behavior remains an application responsibility | Source reference only |

Sources: [RxDB Drive documentation](https://rxdb.info/replication-google-drive.html), [selfstore sync design](https://github.com/selfstoredev/selfstore/blob/main/src/sync/README.md), [Yjs](https://docs.yjs.dev/), [Automerge](https://automerge.org/docs/hello/). No third engine is executed.

## License/distribution screen

Public source license evidence: [RxDB Apache-2.0](https://github.com/pubkey/rxdb/blob/master/LICENSE.txt), [selfstore MIT package declaration](https://github.com/selfstoredev/selfstore/blob/main/package.json), [Yjs MIT](https://github.com/yjs/yjs/blob/main/LICENSE), [Automerge MIT](https://github.com/automerge/automerge/blob/main/LICENSE). The spike must check the exact installed artifacts and any storage plugin separately. Do not assume RxDB premium modules are covered by the public core license. No premium purchase or service is authorized. Preserve upstream notices if redistributing source; ordinary locked package dependencies remain external dependencies. This is an engineering screen, not a blanket license certification.

## Decision rubric

1. Gate on acknowledged intent preservation and truthful settled/blocked state, including reload. Convergence alone is insufficient; no performance ranking can offset silent loss.
2. Separate unmodified/default upstream behavior from named, bounded configuration or persistence mitigation. Do not repair upstream algorithms and relabel them defaults.
3. Only safety-passing configurations qualify for performance ranking. Retain all failures, censoring and unexecuted scenarios. Compare engines on the same Drive workload, then providers with the same selfstore workload.
4. Google Drive remains preferred eventual storage and WebDAV secondary. A result can be HOLD or NO SAFE WINNER; mock success cannot authorize adoption or live deployment.

## Pinned source findings to verify at runtime

- RxDB [downstream.ts](https://github.com/pubkey/rxdb/blob/9d60a86373730211c291f8c25668fca7aa531887/src/plugins/replication-google-drive/downstream.ts) requests `batchSize + 6` files ordered by modifiedTime/name, filters already-seen same-time names and slices to the batch size. It neither requests nor advances a page token here. A tie group exceeding this fixed window can strand unseen records; the harness must demonstrate the actual checkpoint sequence before calling it a runtime failure.
- RxDB's [default conflict handler](https://github.com/pubkey/rxdb/blob/9d60a86373730211c291f8c25668fca7aa531887/src/replication-protocol/default-conflict-handler.ts) resolves to `realMasterState`, dropping the fork state. Default convergence therefore cannot by itself satisfy the acknowledged-edit preservation gate. A custom handler would be a separately named mitigation, not the default candidate.
- selfstore [sync source](https://github.com/selfstoredev/selfstore/tree/d5900893187e8832dc5cba510a928819b2042236/src/sync) exposes manual conflicts with local/remote values. Installed `dist/sync.d.ts` explicitly documents redaction of those values in persisted journals and absence after reload. A callback containing both versions is therefore insufficient evidence for AC4. Inspect durable state after restart, separately for defaults and manual policy.
- RxDB's installed package declares Apache-2.0 and contains the Dexie storage plugin; selfstore's installed package declares MIT. No premium module is selected. The harness uses their actual storage/replication APIs, with endpoint redirection only where required; this does not validate real OAuth or browser CORS automatically.

## Maintenance and security assessment

Current repository activity was source-verified on 2026-10-23: RxDB commit [924ba206](https://github.com/pubkey/rxdb/commit/924ba206ec9655de0ff564cd5a5406990990729f) (Oct 23), selfstore [594f97b2](https://github.com/selfstoredev/selfstore/commit/594f97b2484d86e94ca164723f8c995bd8abab16) (Oct 22), Yjs [47a49409](https://github.com/yjs/yjs/commit/47a49409e480752068c1aeb91f6fc1a6ea071a95) (Oct 18), and Automerge [0ee5e2c5](https://github.com/automerge/automerge/commit/0ee5e2c5395adfe29ed62d5d73496410183f2a85) (Oct 20). These activity snapshots are not the executed package pins and do not prove support longevity or production maturity. RxDB explicitly labels Drive replication beta. selfstore offers fewer layers but full snapshots, credentials and conflict lifecycle still require app ownership. CRDT references solve a merge/data-model problem, not Drive/WebDAV transport, authorization, backup retention or deletion policy by themselves.

Security scope: synthetic identifiers and dummy tokens only; no credential read or cloud provider request. Local IndexedDB is not a guarantee against device eviction or malicious same-origin scripts. Real deployment would require a separate review of token storage, scope selection, CORS, dependency advisories, recovery UX, encrypted conflict retention and untrusted Markdown rendering. None is certified by this offline spike.

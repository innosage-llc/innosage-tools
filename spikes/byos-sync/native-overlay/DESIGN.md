# Native Master-Wins overlay — S0

Refs https://github.com/innosage-llc/innosage-tools/issues/102

Scope: offline loopback-only spike. RxDB 17.6.0 / Dexie storage from the existing
locked byos-sync package. No changes to baseline candidates, results, transport,
conflict handler, downstream, WAL or transaction algorithms. PageStore is a
facade over two RxDB collections in the same browser database: replicated pages
and unreplicated localDrafts. There is no third durable read model.

## Safety contract

A draft key identifies workspace + page + independent edit session. Latest full
body, local sequence/version, base and captured local/cloud conflict bodies are
bounded per session/page; journal commit precedes pages write and Saved locally.
Observable callbacks cannot supply durability: RxDB emits resolvedConflicts
before the fork write and does not await application subscriptions. Capture local
intent at save time, never for the first time in conflict$. Treat all replication
signals as invalidations. Preserve complete current draft through replay/errors.

Clean tabs project reactive pages. Dirty/acknowledged unresolved sessions project
their own draft. Once divergent, edits remain journal-only until explicit user
resolution; other pages and remote receive continue. Never derive ancestry from
wall clocks, FIFO or received-event order. Match complete content + unique edit
identity; never label local IndexedDB, WAL, sent$ or awaitDocumentPushed alone as
remote-verified. The published awaitDocumentPushed contract permits a later local
state to satisfy an earlier wait, so equality must be independently checked.

Resolution reads the latest confirmed Master, lets native pull establish its
assumed state, and makes a normal pages write. A concurrent native Master win
retains the local resolution draft. A mock-only verifier must inspect actual
Drive document contents after WAL completion, including unique edit identity;
verification evidence is a point-in-time synthetic receipt, not provider proof.
No journal cleanup may race a newer local sequence. Use cloud explicitly discards
only the selected session; other tab drafts remain protected.

## Tab behavior studied

Draft Hub-pinned source 7ff80252bfa6f9ef4aaf485f365147abf6731359:
ADR-021 and PM-01: same-runtime clean refresh; dirty text stays intact with warning;
workspace/backing-store isolation; source-tab transport is not durability ACK;
no source echo or duplicate projection. These are behavioral references only.
Stock RxDB multiInstance=true, reactive collection reads and leader election are
the first implementation choice. Do not copy Draft's BroadcastChannel framework.
Test actual browser tabs and no-BroadcastChannel behavior before adding any app
coordination. If native ownership cannot be proven, visibly disable unsafe sync
rather than starting a second native owner.

## Evidence gates

fixtures.mjs defines F01–F17 before implementation. Runner must produce explicit
PASS/FAIL/BLOCKED/NOT_RUN, full text snapshots, seed, commands, source hashes and
request/fault ledger. Synthetic timing must report actual n and distributions.
F01–F15 plus real browser/crash coverage gate UX PASS. F16 checkpoint failure
forces HOLD FOR CHECKPOINT; do not patch native downstream here. 100 seeds target.
All provider evidence is MOCK-TESTED; REAL-PROVIDER-NOT-RUN.

Implementation comparison (same pinned Draft SHA): `LocalMutationChannel` and
`TabSyncRuntime` validate runtime scopes, suppress source-tab/self event IDs and
seen duplicate IDs, then dispatch only to matching scoped subscribers.
`CrossTabCoordinator` selects BroadcastChannel or localStorage transport. This
spike reuses those invariants, not that implementation: database/workspace
identity scopes native RxDB reactive delivery; RxDB/broadcast-channel owns its
fallback and leader election. Web Locks only prevent duplicate edit-session
ownership (including copied sessionStorage); they are not a second sync engine.
If safe writer ownership is unavailable, writes are visibly disabled. Native
fallback without window.BroadcastChannel is fixture-tested. Source-tab save ACK
is the awaited journal/page operation, never a peer transport event.

A first dirty-tab save carries the full page/version captured when editing
began. It cannot adopt a newer peer commit as its base implicitly. Initial and
late-CAS divergence retain a bounded `sourceExternal` copy, distinctly from a
verified cloud receipt. This protects C even if its originating tab already
retired a remotely verified journal and a later E replaces the native page.
Each local body is capped at262,144 UTF-16 code units; each independent session
holds latest draft plus at most five baseline/conflict snapshots, not history.
Unresolved independent sessions are retained rather than pruned by age.

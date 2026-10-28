# Isolated hierarchical workspace research (#142)

This is a protected local-first projection on the unchanged native PageStore,
not a new replication engine. Existing demos and provider protocol are unchanged.
The entire version1 id/title/parent/order/Markdown envelope is the native body;
outer editId identifies its generation. See ORACLE.md before validation.

Cross-record hierarchy is not transactional. Local mutations reject cycles and
missing parents; incoming invalid trees are reported and block workspace
confirmation. Count always means locally known pages, never provider total.
Manual merge uses the complete serialized envelope to retain metadata intent.
Native journal conflict originals remain in their full envelopes.

Auto-sync candidate is deferred/HOLD: existing real-provider controller's timeout
races do not cancel all in-flight native work and it deliberately halts future
operations after timeout. A coalescing retry scheduler cannot safely assume an
old operation is quiescent. Keep explicit operations and the existing single
native owner; no parallel scheduler or polling has been introduced.

A handoff remains incomplete until a separate destination reads matching full
records/tree. This controller deliberately makes no destination availability claim.
Real provider evidence, performance targets and human usability are not implied
by offline tests. Existing #113 receipts cannot validate this new envelope.

`real-store.mjs` supplies the existing #113 provider/controller with an additional
entry gate: an existing account/client/folder binding is mandatory. It does not
authorize, create an identity/folder, export tokens or perform a request on open.
Use only the original approved browser context and the existing transport build
injection. The default loopback UI remains mock-only. The separate --real candidate build
uses this binding and the existing OAuth/transport flow; its two-profile wiring
is qualified only with intercepted Google endpoints. Actual provider AC4/AC8
remains blocked on the original approved context/fixture, not a live PASS.

## Run and evidence

- `npm run spike:byos-workspace`: loopback mock UI on port4142; fresh isolated workspace by URL. No Google request is possible in this default build.
- `node spikes/byos-workspace/server.mjs --real`: **separate real-provider candidate build**, never selectable by URL. Requires original approved browser origin, existing binding/client and fixture authority; a fresh localhost profile fails closed before provider traffic. Reauthorization uses the existing `drive.file` scope and in-memory transport. This command is not deployment or live-test authorization.
- `npm run test:byos-workspace`: native envelope/tree/journal/Changes/binding tests.
- `npm run test:byos-workspace:browser`: actual Chrome local UI/persistence/race tests plus completely intercepted two-profile real-build wiring. Zero real Google requests.
- `npm run test:byos-workspace:measure`:30 4KiB trials per12/500 ×idle/held-loopback-request cell. Raw metrics retained.
- `npm run test:byos-workspace:slow`: injected10s/45s/never UI callbacks measured with real clocks; not Google latency.

The existing static-only offline-shell helper/worker is reused; original #113
helper defaults are preserved. CacheStorage contains integrity-checked HTML/JS
only, with CSS embedded in HTML; no credentials, API payloads, synchronization or
post-close worker traffic. Full-record local ACKs remain native IndexedDB intent.
The existing provider preflight gains optional strict-existing-binding arguments;
its default #113 behavior and current demo routes are preserved and regression tested.

See ACCEPTANCE.md for partial criterion coverage and the HOLD decision. Human
usability NOT_RUN; satisfaction UNKNOWN. This is a draft research increment,
not a completed #142 or a recommendation to migrate Draft.

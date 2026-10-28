# Prepared per-page upload candidate — implementation in progress

Issue #142 now authorizes isolated Tools transaction/WAL composition changes
that preserve ownership, journal/CAS and existing data. It also requires bounded
safe retries. The earlier authority-pending conclusion in draft PR146 is
historical and superseded; its native counterexample and failed Drive run remain
valid, unchanged evidence. This candidate is not deployed or ready for acceptance.

## Target and evidence

Each page's own final input starts a five-second clock. The measured event is
the actual conditional page-file content request for that exact durable editId
and complete record, not WAL publication, eligibility, a lease PUT, or GET.
Record local ACK, deadline, WAL protection, actual upload request/response,
independent complete-record readback, retries and final matching generation.
All-final-generation safe closure includes every required cleanup and request;
B full readback and A actual close/reopen remain separate final checks.

The existing native path cannot provide independent onset merely by adjusting
timers: it serializes work through a shared lease/WAL, and native push can return
before materializing page files. The proposal prepares safe write prerequisites
before each deadline, while retaining the same elected owner and operation gate.

## Exclusive prepared mode

1. Preserve the current local journal/oracle and any prior run evidence. Refuse
   admission on dirty/unresolved foreign state or binding drift. Recover previous
   work in an explicitly separate preparation phase; never relabel the old failure.
2. Close native cloud operation entry, pause **and drain** replication, verify no
   adapter requests remain, then acquire the existing transaction lease. Pause
   alone is insufficient. No new replication instance or competing owner exists.
3. Resolve only the approved existing fixture files and independently read their
   complete records with revision-bound ETags. Existing twenty-six page IDs,
   file bindings and the original twelve-page preservation oracle are frozen.
   New files/folders and unsafe ambiguous legacy creates are outside this mode.
4. Local edits save immediately and asynchronously into the existing protected
   journal; they do not await provider work. A serial coalescing writer publishes
   immutable snapshots of the latest protected intents to the existing WAL file.
   Continued input does not restart a global debounce. An input is eligible for a
   content PUT only after its own current generation is durably protected there.
5. At the page deadline, synchronously recheck current generation, protected
   snapshot, ownership/lease budget and prior same-page work, then invoke its
   exact conditional content request without another asynchronous gap. WAL
   protection arriving late is measured as a missed onset, never hidden as success.
6. Independent readback must match the complete record/editId before acknowledging
   cloud verification. A new input immediately invalidates older readiness.
   A superseded in-flight/uncertain predecessor remains a recovery obligation;
   no successor may invent its baseline or silently use a new ETag.
7. Finish only with all final records verified, no dirty input, conflicts,
   unresolved requests, retry timers or unmatched journals, and verified WAL
   cleanup/lease release. Reconcile native metadata through native replication;
   do not manufacture assumed-master checkpoints. Retire only a generation-matched
   local journal after independent verification and final mutation-epoch checks.

## Versioned, fenced WAL

The initial cumulative native-array WAL idea is rejected: native recovery fetches
fresh ETags without checking the original assumed master and could overwrite an
external edit after a valid content-write412.

Use a strictly validated object in the **same existing WAL file**:
`{format, version, workspace, runId, rows}`. Each row binds fixture page/file ID,
generation, complete baseline, original expected page ETag and complete target.
All candidate transaction entrypoints must use version-aware recovery: adapter
pull/push, PageStore remote reads, verification/resolution and startup recovery.
Native-array rows require a safe complete-baseline audit; unknown versions,
malformed identity, missing baseline/file or ambiguous creation fail closed.

Recovery accepts an independently read exact target as already applied. Otherwise
both complete baseline and stored ETag must match, and the write uses that stored
ETag. A conflict retains WAL, local/remote full records and hierarchy intent.
WAL replacement/clear and lease release also use their original snapshot-bound
ETags. Never substitute a fresh validator to force an old mutation through.

Older native clients throw on the object before page writes or WAL clear, but
can strand a lease because native `runInTransaction` has no error-release finally.
This is fail-closed compatibility, not graceful coexistence. Rollback requires
closed dispatch gates, settled or explicitly retained uncertainty, compatible
empty WAL, lease release and preserved unmatched journals. Do not deploy an older
reader while this versioned WAL still needs recovery.

## Finite retries and clocks

Keep the existing native180s operation cap,20s fetch bound,60s lease and an
explicit bounded request/run budget. A lease is not extended by the operation
budget. Browser suspension requires a fresh budget check immediately before
dispatch; aborting a fetch is not proof that a server-side write was canceled.
The final preparation/lease margins must be frozen and tested before live work.

The initial retry policy is three attempts total per logical read/write,
500ms exponential base,4s base ceiling with bounded jitter, and `Retry-After`
as a minimum. A delay that exceeds remaining time stops rather than violating
the server instruction. One coordinator owns retries: IO is single-attempt and
must not wrap native helpers with hidden retry loops.

Classify errors by status and reason. Transient network/service/rate-limit errors
may retry. Every uncertain write is independently reconciled by page identity,
full target/baseline and ETag before idempotent continuation. An already applied
target requires no duplicate PUT. Auth, real permissions/quota/configuration and
unresolvable CAS conflicts retain pending intent and pause/fail explicitly.
States include pending/uploading/retrying/backoff/auth-required/conflict/failed/
verified, attempt and next retry/stop reason. Safe-close latency includes retries
and backoff. Injected faults are never reported as real provider events.

## Required validation before release

- Old-client object refusal before page writes; all candidate entrypoints covered.
- Crash before/after WAL publication and content mutation; external edit before
  recovery and between read/CAS; lost response; stale WAL clear and lease release.
- A2 during A1 upload/retry/readback, continued multi-page input, slow WAL writes,
  stale verification and new input during completion. Never retire the newer intent.
- Pause/drain failure, request/attempt/time budget exhaustion, suspension/lease
  expiry, another owner, delayed old requests and rollback refusal with uncertainty.
- Temporary failures followed by success, Retry-After, auth/permission distinctions,
  rate-limit reasons, unknown outcomes and no duplicate creation or stacked retries.
- Complete A–Z local/native-mock tests and exact-source independent review/gates,
  followed by coordinated Chrome, separately frozen preparation and actual Drive
  run, B full-record/tree readback and A close/reopen only after established safety.

The implementation now connects the coordinator, transport, per-page scheduler,
PageStore journal hold, version-aware native transaction runner, and an opt-in
`prepared=1` experiment route on the existing workspace build. This flag changes
the isolated experiment, never the provider or OAuth binding. Ordinary demo
routes retain their existing behavior. Do not open an older writer while the
prepared WAL or lease needs recovery.

The prepared route closes ordinary native transaction entry until a bounded
prepared action owns it. The separate recovery button records the prior complete
journals/WAL, safely drains known predecessors, uploads only approved existing
fixture records, reconciles native metadata, and retires exact matching journals.
It requires all26 pending journals, the original session, and a healthy unchanged
fixture. New input aborts recovery authority. Export recovery evidence and reload
before the formal sample; recovery duration is never counted as formal latency.

Lease acquisition uses the existing file with exact CAS. A nonempty lease may be
reclaimed only with provider Date/modifiedDate proving at least61s age (native
60s plus HTTP-date precision). The conservative write clock starts before the
acquisition request, and new mutations stop40s later, reserving the unchanged20s
physical request bound. No lease renewal or native timeout increase is used.
The formal scripted cadence must fit that window; human pauses or provider delay
can produce a measured missed onset or a safe failure. This is not a general
background sync guarantee.

Local evidence:51 core/recovery tests and49 existing workspace/native regression
tests passed before the final full gate. The separate headless browser test
passed26/26 final generations, injected503 recovery, unchanged original12,
independent B full-tree readback, and actual A close/reopen, using1133 intercepted
synthetic requests and ZERO real Google requests. The runtime/native-old-client
test and final full gate remain required on the submitted revision. Independent
core review passed; full integration review, staging and live Drive qualification
are still outstanding. No real waiting-time claim follows from these local tests.

Run `npm run test:byos-workspace` for native/core regression and
`npm run test:byos-workspace:prepared` for the fully intercepted end-to-end sample.
The latter uses the installed separate Playwright headless browser, never the
shared user Chrome profile. Its generated raw artifacts are under
`spikes/byos-workspace/.generated/prepared/`.

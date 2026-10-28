# Founder-authorized A–Z idle experiment

Related to #142. This continuation implements the approved scenario separately
from the preserved twelve-page HOLD report on draft PR144. No results from that
report qualify the new scenario. No Draft or production changes.

## Frozen protocol (before any new live traffic)

- Same original disposable account, app-owned folder, workspace and BYOS113 A/B
  profiles; same strict existing-binding staging route. No new OAuth scopes.
- Twenty-six new synthetic root pages with titles `AZ142 A` through `AZ142 Z`;
  stable IDs captured in a sanitized fixture manifest before live scenario.
  Retain original demo and twelve prior pages unchanged. No cleanup.
- Initial and final Markdown exactly4096 ASCII bytes, with heading/list/code/link
  and deterministic page-letter marker. Preserve titles/parent/order during the
  timed edit pass. Full decoded envelope (including editId) is the oracle.
- Warm starting fixture: all initial generations independently verified, zero
  raw protected journals in A, healthy tree, no dirty input or operation.
  Preparation is reported separately. New-page preparation may use batches of
  at most four, bounded by6000 Drive requests/30minutes, with no automatic retry
  after timeout or ambiguous failure. Native180s/1000request operation limits
  remain unchanged. Preparation failure stops before the timed experiment.
- One timed live sample. A edits A→Z with one complete4096-byte replacement per
  page and nominal1000ms between input events, recording actual event timestamps
  and any automation jitter. Page switch saves prior dirty input locally;
  final Z stays selected and auto-saves at its five-second idle boundary.
- Per-page eligibility is last-input+5000ms (timer may run later). Editing B
  never resets A's timer. Existing whole-workspace sync/Verify can transmit
  other durable records before their own eligibility; this is not per-page
  transport isolation. Cloud work remains a single native owner.
- Normal network/no throttling, original sessions authorized before timing,
  visible foreground A. Freeze exact reviewed source/build/deployment hashes
  and fixture oracle before traffic. Any auth/operator interruption is reported,
  never silently subtracted or classified as an uninterrupted successful sample.
- Experimental run limits:6000 actual Drive requests,25minutes, at most26 sync
  dispatches and52 Verify calls. No controller retry/rearm. Existing native
  retry semantics remain, but first ambiguous fetch/body or non-contention
  provider error latches the experimental transport closed, preventing further
  actual requests. Native CAS412 and expected404 are retained protocol behavior.
  `begin()` cannot reset cumulative limits. Stop/error never asserts cancellation
  of already-dispatched work or releases the guard for native retries.
- First timeout/error/limit exhaustion is a failed sample. Preserve all journals
  and data; no blind retry, deadline extension, conflict auto-resolution or
  clearing/restarting the guard. Observe/report remaining work and bounded safe
  recovery separately; never convert recovery into benchmark success.

## Implementation and close readiness

Start A–Z experiment is an explicit opt-in. Ordinary existing demos and the old
foreground experiment retain their prior defaults. The new run requires exactly
26 uniquely titled fixture pages and no initial journals/dirty input. New input
invalidates ready state immediately. Local autosaves are independent of cloud
work and clear only the matching captured buffer generation. Dirty input outside
fixture scope stops the run. Manual cloud operations and the other scheduler
cannot compete with this owner.

Each batch invokes the existing workspace Sync once, then independent native
Verify for still-current eligible generations. Verify itself includes native
whole-workspace sync. No replacement protocol, per-page replication owner or
native deadline change. A transport cutoff bounds future requests, not settlement
of already-dispatched operations: any uncertain outcome permanently forbids a
ready claim for that run.

Ready requires all26 pages edited and durably saved, latest matching generations
verified, no dirty buffers/local save, raw journals across all namespaces/sessions,
conflict/tree error, required cloud operation or transport uncertainty. A fresh
aggregate check is fenced by input generation and database invalidation. Further
input or database change withdraws ready. Browser close never flushes queued
network work; leaving before ready is warned. B observation remains separate.

## Evidence requirements

Record input/durable/eligibility/dispatch/Verify timestamps, final-Z input and
all-final-generation verified timestamp. Main result is their difference; do
not add work already completed during earlier editing. Report idle, queue and
cloud/verification spans without summing overlapping intervals. Export only
sanitized full-record hashes and allowlisted counters; no tokens, headers,
provider IDs or user data. Body bytes are decoded application payload, not wire
bytes. Experimental response-size accounting reads a clone before returning the
response and adds instrumentation overhead, reported with the measurement.

If ready is reached, independently read all26 complete records/tree in B, report
its duration separately, then actually close and reopen A and compare retained
records. Do not carry a persisted ready flag across restart. If not ready, do
not close A as though it were safe; report failed/incomplete state and retained
local intent. A single sample supports one observed value, not p95/range/upper
bound. All new live evidence is currently NOT_RUN.

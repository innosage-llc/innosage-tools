# Bounded foreground policy evaluation

Decision: CONDITIONAL for further bounded qualification; actual-provider qualification remains HOLD. This evaluation improves the earlier timeout-only HOLD
with executable evidence. The UI and separate real build now import this policy, off by default. A user must explicitly start each bounded store-lifetime run.

`foreground.mjs` invokes the existing `Workspace.sync()` only. It owns no page
data, journal, verification receipt, native checkpoint, lease or replication
instance. One policy instance is allowed per PageStore lifetime; replacement and
rearming are rejected. The visible Start foreground run control is the explicit opt-in.
The caller signals `saved()` only after an actual durable create/save ACK and
calls `wake()` on foreground/online or manual-operation completion events.

The policy debounces signals and permits at most two workspace-wide dispatches.
A counter retains signals acknowledged during either flight. Immediately before
dispatch it checks writer ownership, caller-supplied authorization, visibility,
online hint, the native operation slot and remaining budget. It does not join an
already-running manual Sync/Verify. Hidden/offline/busy conditions retain signals
without polling. Existing native sync still controls conflict protection and
workspace-wide ordering; no per-page scheduling/fairness claim is made.

Any rejection permanently halts the policy for that store. It never races the
sync promise against a new timeout, releases a pending flight, or retries. A
never-settling promise (including timeout cleanup stuck in pause) occupies the
flight indefinitely. Stop prevents future dispatch; it does not cancel the
current native operation. Already-dispatched work may continue after hiding or
stopping. This matters because the existing real-provider timeout can reject
while underlying native work continues.

`snapshot().pending` counts durable signals not yet covered by a settled sync
call; it is not a count of unverified pages or protected journals. A settled call
does not confirm that all its records reached Drive. The policy always reports
`cloudVerified:false` and `destinationObserved:false`. Actual state comes from
the unchanged workspace/native verification and recovery flows.

## Observed offline evidence

`npm run test:byos-workspace` passed 34 checks (25 existing, 9 added). New tests
cover coalescing, saves during both flights, bounded budget, indefinite work,
timeout rejection plus late underlying completion, replacement prevention,
dispatch-time visibility/online/auth/ownership checks and manual-operation overlap.
The native test uses the actual PageStore and Changes adapter with fake IndexedDB
and the accepted loopback provider; zero Google requests. Both clients have
independent local databases and receive identical complete page records/tree.

The retained first successful run is `evidence/foreground-loopback.json`:

| 12 pages, 4 KiB Markdown each | Explicit after every create | One coalesced batch |
|---|---:|---:|
| Native sync dispatches | 12 | 1 |
| Sender fixture requests | 982 | 133 |
| Request body bytes | 113832 | 109981 |
| Response body bytes | 648631 | 176972 |
| Sender scenario duration, ms | 2810.716375 | 320.560167 |
| Protected sender journals retained | 12 | 12 |

These scenarios have the same final content but intentionally different sync
timing. The explicit baseline is sync-after-each-save, not an optimized manual
batch. There is one sample per mode; durations include local creation and native
orchestration. No percentile, browser responsiveness, real Drive cost/latency,
or generic speedup claim follows. The existing app performance/UI receipts remain
applicable for unchanged local storage/controller paths; the changed app has fresh Chrome runtime coverage.
Independent Verify work is excluded from these counts; the complete manual
Save→Sync→Verify versus foreground acceptance comparison remains pending.

## Remaining work and rollback

Runtime events and visible status are wired through the existing UI. Qualify the exact original approved provider context before live use. Real A/B workload/count/byte/latency comparison remains NOT_RUN.
An online hint does not establish connectivity or authority; provider preflight
remains authoritative. No new OAuth grant, account, folder, origin deployment or
permission is authorized by this module. Do not clear the halt through a wrapper
replacement or use a new PageStore to bypass uncertain native work.

Rollback is removal of this isolated evaluation and its test registration, back
to reviewed candidate acd29fe. It requires no data/schema migration, journal
rewrite, provider cleanup or default-UI change. Master #142 remains HOLD/open.

## Runtime continuation

The visible controls start one run and stop future dispatches; neither resets the
budget. Durable create/save/conflict-resolution acknowledgments signal it.
Visibility, connectivity, authorization and manual-completion events wake it;
manual and foreground cloud operations exclude one another. Local Save remains
available during a held foreground operation. Error halt and pagehide prohibit
future dispatches. Already-started native work can continue. Real authorization
is checked separately; opt-in does not grant access. Disconnect invalidates held
OAuth callbacks so a late success cannot restore authority or wake a run.

Fresh Chrome UI coverage records default Save with no sync, opt-in, held-flight
local Save/typing preservation, manual exclusion, two-dispatch exhaustion, dirty
Verify refusal, explicit later Verify and permanent error halt. The separate
real-build test uses synthetic OAuth/intercepted endpoints only, including a
held OAuth callback after Disconnect with zero provider requests.

`evidence/foreground-runtime-loopback.json` records one new sample per mode with
identical twelve 4KiB pages, per-page independent Verify, then destination sync.

| Phase requests | Explicit after every create | Coalesced batch |
|---|---:|---:|
| Sender sync | 980 | 135 |
| Independent Verify | 204 | 225 |
| Destination sync/readback | 32 | 32 |
| Total | 1216 | 392 |

Both preserve all twelve journals before Verify, retire them only after exact
independent verification and read identical complete trees at B. Sync timing
differs by design; these are single loopback observations, not live cost, p95,
matched timing experiments or a production speedup. Original policy-only evidence
is retained unchanged. Runtime UI receipts/screenshot are adjacent in evidence/.

A failed manual Sync/Verify/resolution permanently halts an armed foreground run too; completion events cannot retry the failed cloud work. Chrome regression covers queued foreground plus manual failure and later local Save.

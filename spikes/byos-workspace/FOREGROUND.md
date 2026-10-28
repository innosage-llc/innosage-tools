# Bounded foreground policy evaluation

Decision: CONDITIONAL for further bounded qualification; actual-provider/runtime
integration remains HOLD. This evaluation improves the earlier timeout-only HOLD
with executable evidence. It does not enable automatic sync in the UI or real build.

`foreground.mjs` invokes the existing `Workspace.sync()` only. It owns no page
data, journal, verification receipt, native checkpoint, lease or replication
instance. One policy instance is allowed per PageStore lifetime; replacement and
rearming are rejected. Construction is the explicit opt-in for this evaluation.
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
applicable because the app does not import this evaluation module.
Independent Verify work is excluded from these counts; the complete manual
Save→Sync→Verify versus foreground acceptance comparison remains pending.

## Remaining work and rollback

Before runtime integration, bind events and visible status through the existing
UI route, define the bounded user opt-in and qualify the exact original approved
provider context. Real A/B workload/count/byte/latency comparison remains NOT_RUN.
An online hint does not establish connectivity or authority; provider preflight
remains authoritative. No new OAuth grant, account, folder, origin deployment or
permission is authorized by this module. Do not clear the halt through a wrapper
replacement or use a new PageStore to bypass uncertain native work.

Rollback is removal of this isolated evaluation and its test registration, back
to reviewed candidate acd29fe. It requires no data/schema migration, journal
rewrite, provider cleanup or default-UI change. Master #142 remains HOLD/open.

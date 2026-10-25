# Inactive retained Scene-slot proposal

Follow-up of #132 / Master #85. This is a security/retention proposal, not runtime
approval. The until-revoked implementation is integrated at 7728027c. A management
read on 2026-10-25 found 19 stored grants, all revoked, with cumulative shares 19.
The existing 20-lifetime-share trigger leaves only one further create. Do not
reset counters, raise the number, manually delete old grants, or claim staging
ready for repeated connections under that lockout.

One bounded read-only Astra HIGH consultation recommended preserving 20 **retained
slots**, including active grants and revoked grants still in quarantine. Active-
only counting would allow unbounded tombstones and create/revoke churn. Exact
reviewed SQL/config approval is required before replacing the classified bound
or changing replay-record retention. Local inactive preparation is separate.

## Proposed invariants

The additive candidate migration stamps old revoked rows at database migration
time; their true retirement times are unknown and are never backdated. New
retirement gets a database timestamp on the first transition to revoked. That
timestamp and the revoked state cannot be reversed. Eligibility uses a fresh read
of the same database clock, avoiding browser/Worker/database clock disagreement. Old fixed deadlines and new
until-revoked policy remain immutable and unchanged.

The atomic admission trigger counts every retained parent row. At 20 it rejects
insertion; historical `scene_budget.shares` continues increasing as telemetry,
without reset. Each parent retains at most 16 distinct requests, one consent
binding and one bounded reference. Thus parents remain <=20 and requests <=320;
rapid revoke does not immediately replenish capacity. This is bounded storage
and quarantine backpressure, not a new cumulative task budget. It does not solve
unauthenticated capacity denial or guarantee Free-plan availability. Provider
quota errors still stop/report; no paid resource or deliberate exhaustion run.

Only revoked slots are eligible after 30 minutes from recorded retirement. This
matches the existing maximum 1800-second OAuth access-token life and exceeds the
pinned provider 1.2.3 consent-transaction 600 seconds and proof 300 seconds. OAuth
refresh remains disabled. In-flight work cannot rely on KV expiry alone: the
application captures the posted proof before awaiting consent, checks the proof
against current live/revoked binding, and token/resource paths recheck D1 lease.
Reclamation first sweeps expired unpaired proofs, then removes each eligible
parent's references, requests, consent bindings and parent in one fenced atomic
D1 batch. An absent old ID can never be resurrected by a delayed write; new
creation chooses a fresh random ID. Cached-consent and delayed-write regressions
must pass before this horizon is accepted. No arbitrary HTTP-wall-time bound is
assumed from the provider TTL. A delayed token callback can even issue a token
that remains cryptographically unexpired at collection; every resource operation
still needs the current D1 grant/epoch fence. The local provider regression holds
a successful lease read across 29 logical seconds (within the documented 30-second D1 limit),
revokes, then proves that token cannot read before or after collection.

At most three slots are reclaimed per invocation, with id/epoch/retirement/cutoff
fences repeated on every deletion. Optional reference-table detection is separate
from image-access flags. Coupled with inactive-cache cleanup, the proposed cron
uses at most 37 SQL statements. This conservative ceiling is below the 50 Free
queries/invocation cap; a batch counts as one invocation query, rather than one
per enclosed statement. See [current D1 limits](https://developers.cloudflare.com/d1/platform/limits/).
Cleanup delay causes temporary backpressure rather than overflow. An unrevoked
until-revoked grant is never retired merely because its browser/cache is idle.

## Recovery and rollout

A stored device owner handle may outlive a reclaimed row. The service returns
`already_absent` only when the supplied server-issued share ID has no current row.
It does not authenticate ownership or claim to have performed a revoke. An
existing row with wrong credential/project/generation/epoch stays denied. A
network error, timeout, 401 or unavailable database is never absence. Only confirmed absence for the same captured stored control can clear that
corresponding device record; it does not authenticate ownership. The UI uses an
honest notice rather than the green revocation-confirmed claim; local Scene,
reference, Undo/Redo and exports remain intact. This recovery stays available
when new reclamation is disabled, while frontend retained-control recovery must
remain enabled as documented by the until-revoked rollback contract.

New reclamation is default-off behind `SCENE_RETIRED_RECLAIM_ENABLED`; candidate
SQL is outside normal migrations and no checked-in deployment enables it. Exact
activation must bind reviewed source, both candidate SQL hashes, existing staging
D1/Worker, the cleanup schedule, retention/recovery behavior, and live-readback
preconditions. Existing 19 revoked rows start a new 30-minute quarantine on applying
this migration. There is no immediate erasure or extra live-create allowance.
No live MCP run, new OAuth credential/scope, production or Master closure follows.

Rollback disables new creation first while keeping revoke/absence recovery and
cleanup available. Restoring the old cumulative trigger after telemetry exceeds
20 locks admission fail-closed; never reset the counter to hide that consequence.
Collected retired history cannot be reconstructed by reverting code. Backups and
already-delivered content remain outside immediate erasure.

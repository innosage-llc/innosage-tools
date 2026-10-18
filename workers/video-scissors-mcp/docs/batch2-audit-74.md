# Tools #74 — Batch 2 audit, no runtime changes

Baseline: `99d237f7f4d1f18625a781038dcef415e445fc3e`. Batch 1 does not
authorize implementing these higher-risk candidates. No new Cloudflare run,
architecture selection, security-check removal or deployment occurred.

## A idle long-poll — defer

`src/mailbox.ts`, `poll()` / `claimMeasured()`: each cycle reads live owner
metadata, retires stale/expired queued work and atomically claims current work.
Up to eight cycles means 24 SQL statements per empty poll, excluding startup
accounting. The existing real-local-D1 `empty long-poll` fixture measures this
directly, not a storage mock. Its original 3-second cadence stays unchanged.
Reproduced locally: eight checks, 24 queries, 32 rows read, zero rows written,
5 ms accumulated local DB duration, 21,063 ms wall time. This single local run
is not a Cloudflare latency estimate or p95 result.

**NO-GO for this batch:** skipping the two UPDATEs based on a prior empty read
can alter the enqueue/claim race or defer delivery to the next 3-second cycle.
A zero-row write is not evidence that its predicate/linearization is redundant.
No behavior-equivalent reduced-query prototype is proven; do not implement one
or claim projected savings as achieved. Future work needs a separate reviewed
atomic equivalent plus concurrent enqueue/stale/abort/delivery-latency proof.

## D authority/expiry — defer

`src/d/ProjectStateDO.ts`, `current()` / `expireIfNeeded()`: two SQLite reads
in a healthy `project()` call, one expiry-state lookup and one scoped authority
lookup. **OBSERVED LOCAL:** existing strict resource fixture at this baseline
reports one `getproject` = two SQL statements/two rows read/one project RPC.
PR #73 is already included; do not repeat its three optimizations.

**NO-GO for this batch:** combining reads must still run terminal cleanup,
revocation/tombstone transitions, alarm replacement and socket closure on expiry.
One potential avoided row is not yet a demonstrated equivalent implementation.
No code change, before/after gain or live cold-recovery claim is made here.

### PR #73 snapshot semantics — characterized, not automatically fixed

CTO source review identified the existing D request-local snapshot reuse as
analogous to the rejected A/B candidate. Added one deterministic **OBSERVED
LOCAL** test using the real SQLite DO: after the first authority read, the
fixture calls real `super.revoke()` before returning that read to MCP. The
current tool still returns its already-read metadata; the database is already
a cleared/revoked tombstone. Next getproject, next cut and direct admission all
deny, with zero queued commands. D suite **17/17 PASS** characterizes current
behavior; it does not approve that behavior as a newly accepted contract.

Pre-#73's second-read `null` result is **SOURCE-DERIVED / NOT EXECUTED** for D.
Classification: **CONTRACT_CHANGE_REQUIRED**, not SECURITY_BUG_CONFIRMED. No
cross-request cache or post-revoke new authority was demonstrated. Do not
automatically revert PR #73, change D's runtime or infer live exposure. This
finding must remain visible in Hub #358 before any future Draft adoption or
new D staging qualification. Restoring the former observation point or agreeing
a new in-flight-read contract requires separate reviewed scope/authority.

## B wake bridge — retain checks

`src/browser-routes.ts` and `src/VideoScissorsBridgeDO.ts` separate browser
possession, current D1 lease and one-use join authority:

| Warm successful path | Source-derived work, excluding HTTP budget/OAuth and DO schema initialization |
| --- | --- |
| Mint join proof | owner D1 lookup + one DO mint call with its own D1 lease lookup; two DO SQL statements (expired-proof deletion, proof insertion) |
| Open socket | Worker D1 lease lookup + DO consume-proof call (one SQL DELETE RETURNING) + DO fetch with a fresh D1 lease lookup |
| Notify | one DO call with one D1 lease lookup, then sends to matching live socket attachments |

These are **DERIVED SOURCE COUNTS**, not measured provider invocations/rows/cost.
The expiry index here is actually used by expired-proof deletion; D's unused
ticket-index finding does not apply to B. Possession and fresh lease checks
answer different questions, and the post-proof lease read covers intervening
revocation. **NO-GO:** no safe redundant check has been demonstrated. Keep B's
runtime and configuration unchanged. Actual hibernation-duration/CPU/whole-
journey overhead remains UNKNOWN without separate live measurement approval.

## Reproduce / decision

From `workers/video-scissors-mcp`:

```sh
node --experimental-strip-types --test --test-name-pattern='empty long-poll' test/mailbox.test.ts
node --experimental-strip-types --test --test-name-pattern='same D fixture records' test/d-candidate.test.ts
npm run test:bridge
```

All are isolated local fixtures. No Cloudflare credentials or quotas are used.
Keep observed local output separate from source-derived counts, old staging
aggregates and future projections. This audit deliberately stops at evidence;
Batch 1's resource reductions do not authorize a Batch 2 runtime rewrite.

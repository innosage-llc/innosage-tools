# Tools #74 Batch1 — NO-GO, audit/contract regressions only

Baseline: `99d237f7f4d1f18625a781038dcef415e445fc3e` (merged PR #73).
CTO decision relayed by lead: **REJECTED—observable behavior difference**.
The snapshot runtime hunk was withdrawn with apply_patch; `src/mcp.ts` is
byte-identical to baseline99d237f. All runtime source remains unchanged.
Branch: uncommitted `codex/mcp-ab-resource-dedup`. No accepted resource gains.
Exact complete Batch1 diff SHA-256 is supplied in the lead handoff
(includes this document; no self-referential hash here). Related to #74, not closure.
Main owns `batch2-audit-74.md` and Hub/browser coordination.

## Measurement boundary

**OBSERVED LOCAL**, real Miniflare D1/SQLite, existing migration, workerd date
2026-10-13, `nodejs_compat`, ephemeral isolated D1/KV. Node 24.18.0,
Miniflare 5.20261006.1-alpha, esbuild 0.28.2, Wrangler 4.149.0; no new dependency.
`test/batch1-worker.ts` wraps native sessions/statements and sums native
`meta.rows_read` / `meta.rows_written`. To retain metadata, test-only `first()`
uses native `all()` on identical SQL and projects the first row. No SQL mocks,
synthetic billing, production instrumentation, or provider usage claims.

Baseline was captured before runtime edits (six tests PASS). The now-rejected
candidate also passed its different snapshot expectations historically. Current
tests always enforce baseline's two reads/null-on-between-read-revoke contract.
The optional BATCH1_BASELINE/git-show source substitution was removed; native
CI runs current source directly. No further optimization exploration is authorized.

| Operation / fixture boundary | Baseline SQL / reads / writes | REJECTED historical candidate | Current runtime |
| --- | --- | --- | --- |
| Cold discovery HTTP (startup included) | 2 / 3 / 2 | 2 / 3 / 2 | baseline |
| Warm discovery HTTP (startup included) | 2 / 3 / 1 | 2 / 3 / 1 | baseline |
| Valid DCR registration (startup included) | 3 / 5 / 2 | 3 / 5 / 2 | baseline |
| Authorized getproject **tool only** | 2 / 2 / 0 | 1 / 1 / 0 | **2 / 2 / 0** |
| Next independent getproject **tool only** | 2 / 2 / 0 | 1 / 1 / 0 | **2 / 2 / 0** |
| Eight concurrent cold discovery requests | 16 SQL, HTTP=8 | 16 SQL, HTTP=8 | baseline |
| Eight DCR requests at DCR=19 | 24 SQL; 1 registered, 7 denied | same | baseline |

Getproject rows exclude OAuth/provider, HTTP startup, test setup/revoke SQL and
response plumbing. Its test-only auth-props route exercises the actual MCP
handler/SDK, not OAuth verification; canonical `oauth.test.ts` separately runs
the real provider and now asserts a successful getproject payload. No whole-call
resource or percentage saving is claimed. Cloudflare usage, CPU, latency benefit,
network RPC cost and money savings are **UNKNOWN / NOT_RUN**. Native counters
are local observations, not billable usage. Instrumented timing is not compared.

## Decisions and material semantic delta

**Budget consolidation DROPPED.** A/B caps are cumulative 2000 HTTP / 20 DCR /
20 OAuth, unrelated to D's daily caps. Existing initialization commits a singleton
with `http=0` before spending. Real SQLite trigger failure of the subsequent spend
returns 400 `REQUEST_REJECTED` while preserving that initialized row/started time.
A failing combined cold insert/spend cannot leave that separately committed
initialization. A real local upsert prototype also fails with no row; skipping
warm initialization loses its separate error boundary. Preservation of this
partial-failure state is treated as binding, per scope. `initialize()`, `spend()`,
entrypoint and schema are untouched; no unproven budget optimization is forced.

**Snapshot candidate REJECTED and withdrawn.** Its proposed earlier linearization
was not compatible with #74's observable-behavior requirement. Existing mutations
already recheck live authority in their own SQL predicates; that does not make
the read response difference acceptable. No new approval is needed to withdraw it.

Deterministic real-D1 test commits revoke after the first authority query and
before the callback resumes: baseline makes a second query and returns successful
text `null`; candidate returns successful already-read metadata. This is an
**observable difference**, not strict behavior/interleaving parity or an already
approved exception. Expiry/metadata changes between the former reads likewise
follow the candidate's earlier snapshot point. A second-query database failure
is also no longer an action failure because that query no longer exists.
CTO issued NO-GO in the same conversation; the old `null` interleaving is binding.
Current contract tests explicitly require it and two reads. Historical candidate
numbers above are rejected evidence only. This decision is not PR/merge greenlight;
main will prepare an audit/regression-only PR and seek exact final PR acceptance.

Tests cover both scope sources, missing/wrong epoch/project, consent, cross-project
isolation, expiry, committed revoke, next-request fresh reads, cumulative cap
concurrency, cold init and native failures. Eight HTTP requests at 1999 admit
exactly one and preserve `started`/other counters. Eight DCR attempts at 19 admit
one, consume eight HTTP units and stop DCR at 20. In-flight read/revoke returns
the baseline null result; subsequent read/cut denies, and revoke injected
between an authorized cut guard and admission still yields STALE_OR_REJECTED
with zero queued commands. Canonical existing OAuth budget tests retain 20 cap.

## D PR #73 contract finding — test-only follow-up

**CONTRACT_CHANGE_REQUIRED**, not a security-bug claim or authorization to
fix/revert PR #73. `TestProjectStateDO.project()` has a one-shot fixture hook:
await real `super.project(auth)`, then await real `super.revoke(browserAuth)`
before returning the captured value. It uses existing real SQLite/world/OAuth;
no production route, synthetic database response or additional framework.

**OBSERVED LOCAL current 99d237f**: the raced MCP getproject returns successful
metadata + original expiry after real revoke committed; inspection shows revoked
tombstone with metadata cleared. Exactly one project RPC; the next getproject
and cut both deny PROJECT_EXPIRED_OR_REVOKED, direct admission returns null,
and zero commands remain. The hook is one-shot and inactive in resource fixtures:
unchanged D resource counts still PASS (getproject 2 SQL/2 reads/1 RPC,
ten warm budget checks 40 SQL/40 reads/10 writes, ticket 2 SQL/2 reads/2 writes).

**SOURCE-DERIVED pre73 861b28b**, not runtime-executed: inspected old `src/d/mcp.ts`
using read-only `git show`; the guard and action each call project(), so revoke
between them would yield successful null. No old checkout/baseline runtime,
automatic D revert or claimed live/security finding. This records the same
observable contract discrepancy that caused A/B NO-GO, without changing D runtime.

## Exact commands and outcomes

Run from repository root unless explicitly prefixed by `cd` below:

```sh
cd workers/video-scissors-mcp
node --experimental-strip-types --test test/batch1.test.ts
```

Native test command imports these tests from `oauth.test.ts` with baseline
contract expectations by default. Post-withdrawal verification follows below.

| Command (repository root) | Outcome |
| --- | --- |
| `npm --prefix workers/video-scissors-mcp test` | Final post-withdrawal PASS 37/37, including six A/B contract tests and the one new D case (24.914 s) |
| `npm --prefix workers/video-scissors-mcp run test:d` | PASS 17/17 including new read/revoke contract finding |
| `npm --prefix workers/video-scissors-mcp run test:bridge` | PASS 5/5 |
| `npm --prefix workers/video-scissors-mcp run check` | PASS |
| `npm run test:video-scissors-remote` | PASS 12/12 |
| `npm run test:video-scissors-mcp-e2e:offline` | PASS 12/12 |
| `npm --prefix workers/video-scissors-mcp run test:integration` | Final **PASS 2/2**, A and B exact Cut1/Cut2/byte-and-plan Undo2, after local file-probe repair |
| `npm --prefix workers/video-scissors-mcp run test:d:browser` | Historical PASS 1/1, unchanged D byte-Undo fixture; not A/B acceptance |
| `npx eslint workers/video-scissors-mcp/test/batch1-worker.ts workers/video-scissors-mcp/test/batch1.test.ts workers/video-scissors-mcp/test/oauth.test.ts workers/video-scissors-mcp/test/integration.test.ts workers/video-scissors-mcp/test/integration-worker.ts workers/video-scissors-mcp/test/d-harness.ts workers/video-scissors-mcp/test/d-candidate.test.ts` | PASS exit 0 |
| `git diff --check` | PASS |

Browser commands ran in the Worker directory via `npm run`. Historical original
A single-cut/Undo fixture passed 1/1 with default Playwright Chrome (system Chrome
failed at debugging-port attachment); that did not establish byte-Undo2.

Bounded follow-up extends only existing `integration.test.ts` / wrapper: same
60 s MP4, official OAuth, real A polling / B SQLite wake bridge selected through
existing configs and ephemeral local binding overrides. No runtime/config edits.
Test checks hidden completion before foreground preview inspection; compares
current preview blob to GUID-matched downloaded bytes, Cut1 [2,4] / Cut2 [6,10]
plans and durations, exact Undo2 bytes/SHA-256/plan, then revoke/privacy.

Initial extension run: A timed out on hidden preview metadata/rAF readiness; B
was explicitly stopped at the same wait during withdrawal, not counted as PASS.
One focused repair moved preview inspection after hidden-completion assertion
and foregrounding. Retry on restored runtime: both A and B reached Cut2 completion,
verified Cut1 2 s and distinct Cut2 [6,10] plan/blob-download equality, then failed
at `execFileSync('ffprobe', [..., 'pipe:0'], { input: bytes })` with **EPIPE**.
ffprobe supplied valid H.264/AAC / 4.000000 s JSON and exit status 0, but Node
reported the closed input pipe. The worker stopped at that checkpoint rather
than claim success. Lead identified that specific pipe-lifetime failure and
changed only ffprobe's input to the existing downloaded path, avoiding Node's
stdin write race; no assertions were removed or weakened. Rerun **PASS 2/2**:

| OBSERVED LOCAL final media journey | A | B |
| --- | --- | --- |
| Output durations: Cut1 / Cut2 / Undo2 | 2 / 4 / 2 seconds | 2 / 4 / 2 seconds |
| Undo2 restores Cut1 bytes AND clip plan | PASS | PASS |
| Preview bytes equal each GUID-matched download | PASS | PASS |
| Hidden operation completion; revoke/old-token denial; privacy canary | PASS | PASS |
| Application WebSockets | 0 | 1 |
| Same-origin control bodies | 19 | 20 |
| Journey wall milliseconds (not total test/CPU or comparative p95) | 11773 | 6186 |

All four Cut1/Undo2 outputs share SHA-256
`06810c07992c56af03f9a58e519c06dfb38aad8c9ffa4efe8f067dcca77d6892`.
These execute real local WASM media processing, official OAuth and a synthetic
MCP caller, not live Cloudflare or real ChatGPT/Gemini Web. They establish the
requested A/B byte/plan journey on unchanged baseline runtime; no performance
ranking or optimization savings follows from one local run. Earlier failures
above remain historical. Historical D browser proof is separate.

One initial counter-instrumentation repair drained finite MCP responses before
writing headers (premature headers showed zero reads). Only corrected observed
baseline/historical rejected values above are evidence.
Shared synthetic MP4 SHA-256:
`d660065e12bbf3022711b8dee874521940b41cce6a1dea0bf0ad25efa1538c50`.

Rollback completed: only the `src/mcp.ts` snapshot hunk restored by apply_patch;
byte equality with baseline verified. No schema/data/counter/configuration rollback.
Batch2 runtime/D/PR #73 untouched;
no cloud/live/staging/production changes, secrets, fees, counter resets, commit,
push, PR or full Gatekeeper. Lead independent review, native submission/gates,
CI and explicit exact-PR CTO greenlight remain outstanding.

Reference checks used Cloudflare's current [Workers best practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/),
[D1 statements](https://developers.cloudflare.com/d1/worker-api/prepared-statements/)
and [D1 database API](https://developers.cloudflare.com/d1/worker-api/d1-database/),
plus installed Workers types. They informed native observation and request-local
state; they do not authorize a product contract change or establish paid savings.

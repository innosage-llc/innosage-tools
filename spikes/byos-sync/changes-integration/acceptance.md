# #111 core integration evidence

Scope: #102 revision 4 / #111 revision 3. Four focused successful invocations
use freeze003; `report.json` binds receipts, exact source and original attempts.
This packet is ready for independent engineering review, not Founder acceptance.
No deployed product, actual Google or full V4 runtime admission claim.

## Supported contract and evidence admission

The bounded supported hypothesis is an app-managed folder in the user's My Drive,
with stable access during each finite fixture. Shared Drives, inherited permission
changes, moves and arbitrary concurrent snapshot consistency are not qualified.
The existing supportsAllDrives/includeItemsFromAllDrives flags neither prove
Shared Drive coverage nor enforce My Drive-only configuration. Actual provider
configuration/admission is outside this offline milestone.

The adapter's actual requests remain:

- files.list: parent docsFolderId, trashed=false, orderBy=name, spaces=drive,
  pageSize=remaining capacity, pageToken when continuing. Fields now include
  nextPageToken,incompleteSearch,files(id,name,mimeType,parents,modifiedTime,size).
- changes.startPageToken: spaces=drive, supportsAllDrives=true, before inventory.
- changes.list: user token, pageSize=remaining capacity, spaces=drive,
  supportsAllDrives/includeItemsFromAllDrives/includeRemoved=true; fields
  nextPageToken,newStartPageToken,changes(fileId,removed,file(id,name,mimeType,parents,modifiedTime,size)).
- No corpora or driveId override. Full JSON bodies use the pinned native fetch
  helper; relevant parent/name/body identities are checked before native admission.

| Fixture | Source / concrete mechanism | Applicability and outcome | May block? |
| --- | --- | --- | --- |
| #109 S1 / S3 | CONTRACT_BACKED: [files.list](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/list), [changes.list](https://developers.google.com/workspace/drive/api/reference/rest/v3/changes/list); continuation, short/filtered pages, full bodies | Same positive traversal path; historical bounded PASS reused | Yes, A4 |
| I1 incomplete result | CONTRACT_BACKED field semantics; injected explicit response | Handles true conservatively under unchanged query. Not proof Google produces it for this particular query; no allDrives fiction | An observed explicit incomplete response must not yield verified completion, A3/A4 |
| I1 read failure / startup | APP_OWNED_FAILURE: required read unavailable; factory withheld instance until first sync settled | Same receiver/checkpoint retained; error visible before retry; a4 PASS after local lifecycle fix | Yes, A3/A4 |
| #109 S5 / I2 | APP_OWNED_FAILURE: remote write applied but response lost; concurrent newer journal generation; explicit resolution | Historical uncertainty controls plus new adapter-bound successful choices and D/E/unrelated progress | Yes, A2/A3/A5 |
| I3 crash / tabs | APP_OWNED_FAILURE: renderer dies during native downstream write; independent sessions and owner handoff | Real persistent IndexedDB, acknowledged complete bodies, unchanged identity; bounded PASS | Yes, A1/A2/A5 |
| S4_NO_EVENT | HYPOTHETICAL: omit from migration inventory and retained events, then expose listing without new event | Original failure preserved; real-contract applicability unestablished | No automatic veto or full-check mandate |
| Original F04 / F16 | Original stock runtime / fixture models | Unattended NOT_PROVEN and stock discovery FAIL remain unchanged | Do not relabel; unattended deferred, applicable discovery addressed by changed adapter evidence |

Changes tokens do not expire under the cited contract; files.list pagination
validity is different. HTTP 200 is not completeness. Missing entries or removed
events do not authorize deletion. A terminal token is bounded observed progress,
not proof of unknowable provider-wide completeness.

## Exact source reuse, not retrospective re-attestation

The candidate changes only imports, explicit incomplete-inventory handling and
factory startup sequencing in `changes-feasibility/adapter.mjs`. It leaves the
successful pull traversal/body validation, native push handler/transaction calls,
checkpoint shape and conflict policy unchanged. `freeze-v003.json` captures the
actual CJS/ESM dependency inputs; Node and Chromium execute the same adapter source.

`report.json.unchangedProtectionSources` verifies PageStore, UI controller and
fixture hashes against the original native-overlay report. No local journal,
resolution, verification, session ownership, schema or workspace routing changed.

| Requirement | New affected-path evidence | Valid reused evidence and why |
| --- | --- | --- |
| A1 durable ACK, complete bodies, safe tabs | I3_CRASH holds actual downstream bulkWrite, crashes renderer, reopens same native IndexedDB; D/B/C survive. I3_TABS preserves two acknowledged sessions through handoff | F01 and local-only F11 journal-committed/page-written/after-local-ACK boundaries; historical remote crash-results F11 separately covers resolution/verification/cleanup. F15 covers duplicate/no-lock/workspace guards. Local-only paths do not depend on adapter discovery; remote lanes reuse unchanged PageStore resolution/verification and native upstream helpers, with changed startup/admission covered by I1/I2/I3. Original report remains HOLD overall |
| A2 explicit progress and three choices | I2 D/B/C retained while E and unrelated O progress; cloud discard scoped to owned page; Keep local and Merge each independently read back before retirement. I3_TABS clean refresh/dirty warning | S5-a3 post-resolution E race and captured conflict bodies; same native push + PageStore resolve/capture logic. No unattended claim |
| A3 truthful verification and generations | I1 blocks during explicit incomplete/read failures, same checkpoint on retry. I2 pending until independent remote verification | S5_LOST_RESPONSE_INTENT-a3 records applied WAL write/lost response, newer ACK during uncertainty and before-cleanup generation guard. These unchanged upstream/verification/journal paths occur after successful startup, whose changed lifecycle is separately exercised by I1/I2/I3 |
| A4 discovery and checkpoint barrier | I1 incomplete/read-failure status plus I3 real interruption between handler proposed cursor and durable native admission | S0 transition/ties, S1 short/empty/filtered traversal, S2 token-before-inventory replay and real native bulkWrite barrier, S3 failed read, S4_RETAINED_EVENT ordered old/new recovery. Positive traversal logic unchanged; original receipts keep original source hashes |
| A5 native identity, Master Wins, ownership | I1 timestamp-to-token same receiver, I2/I3 identity metadata comparisons, one owner handoff; no reset/upsert shortcut | S0 assumed-master transition and S5 native WAL/CAS/conflict evidence. Native pinned dependencies unchanged; no rollback-to-stock claim |

Historical source-bound anchors:
`../changes-feasibility/criterion-map.json` and its named receipts;
`../native-overlay/evidence/report.json` and `raw-evidence.json.gz`.
These are reused observations with affected-path justification, not new runs on
freeze003. Review must reject reuse if it identifies an affected dependency/path.

## Progress and limits

| Attempt | Result | Requests actual / admitted or reserved | Wall ms |
| --- | --- | --- | --- |
| I1-a4 | PASS | 217 / 217 | 7296 |
| I2-a1 | PASS | 805 / 805 | 2536 |
| I3_CRASH-a1 | PASS | 265 / 526 | 3309 |
| I3_TABS-a1 | PASS | 200 / 394 | 2094 |

All include setup/teardown under 1000 requests/180s. I1/I2 use fake IndexedDB;
I3 uses Chromium 151.0.7922.34 native IndexedDB and multiInstance=true. Explicit
sync/live:false; transactionTimeout=50ms and retryTime=1000ms are fixture overrides.
No browser UI implementation was added. I3 exercises the existing UI by CLI.

Original I1-a1 (sandbox listen failure), a2 (real status assertion failure then
watchdog timeout), a3 (fixture held the native helper before its internal retries
finished) remain INCONCLUSIVE. a4 exhausts the finite internal read retries before
observing blocked status. Assertions and oracle were not weakened.

Draft audit is pinned at 7ff80252bfa6f9ef4aaf485f365147abf6731359 in the Hub session's
master-team-v4/design-audit-v1.md. Reuse clean/dirty/runtime-scope behavior; no
heartbeat/coordinator transplant. Draft local coordination is not Drive ownership.

Read-only upstream comparison found google-drive-mock v3 route blob
8fa619be51e4614ac2638073164ef430f5f82d67 and store blob
8810688260ac79dab220e702e21cbe2aafa54d52: list pagination exists, but incompleteSearch
is fixed false and getChanges returns all remaining changes without pagination.
Useful reference; replacing the existing decisive fixtures is not justified.

## Publication and delivery boundary

`publication/provenance.json` binds redacted private-stack copies to retained
original hashes. `publication/duplicate-source-archives.json` verifies each raw
pre/post source archive has identical decoded bytes to the retained freeze archive.
Raw originals/profiles remain locally intact and ignored, not deleted. No secrets
or real user data are part of the synthetic fixtures.

Founder resumed under V1 with the incumbent lead as sole executor. Historical V4
role requests remain historical; routed/provider identities and cost are UNKNOWN.
Independent review, native gates and exact PR/merge receipts are recorded in the
owning session. BOUNDED_GO requires those engineering checks; Founder acceptance
and real-provider qualification remain distinct. #102/#111 stay open, #109 closed.

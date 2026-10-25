# Second real attempt and minimal diagnostic follow-up

Source c287ca1 / staging473e13d8, human-authorized ordinary Chrome A/B.
[Original result](https://github.com/innosage-llc/innosage-tools/issues/113#issuecomment-6394081384)
is HOLD/incomplete, not a provider NO-GO. Exactly one A Verify remote action;
B was not synced. The complete synthetic body and pending journal remained
identical after the operation, downstream checkpoint and lastRemote null.

35 explicit revision-media reads had browser-visible ETag; no successful media
read lacked it. Inventory returned files:[]; Changes returned changes:[] with a
terminal newStartPageToken. No partial v2 metadata request was observed. Two412s
are not sufficient causal evidence: native acquisition412 retries, commit412
throws GDR11, and a WAL412 can throw GDR19. Native errors were not retained by the
deployed diagnostic surface. Its generic blocked status can coexist with retries.

The lead stopped live traffic using normal DevTools Go offline on A's current
test tab, preserving memory auth and all tabs/stores. Final191 dispatch rows =
146 GET200 +3 POST200 +3 PUT200 +2 PUT412 +37 subsequent client-offline errors.
The latter are deliberate intervention, not Google failures. Busy eventually
settled false. Successful control writes do not prove remote document delivery.
Do not restore A online or repeat the real flow blindly. Old-origin drafts also
remain untouched; new-origin results do not prove their recovery.

## Change boundary

Only bounded diagnostics are added. The real-provider factory subscribes to
native error$ before startup; snapshot retains32 allowlisted summaries with
error/request sequence, native/nested code, numeric HTTP status and pull/push
direction where supplied. Unknown messages, raw parameters, bodies, validators,
headers, credentials and stack traces are excluded. Traversal depth and nested
count are bounded. No external telemetry service or new framework.

Existing metadata responses are cloned for boolean HTTP-vs-JSON ETag
presence/strength/equality and field-shape checks corresponding to the media
validator's current preconditions. Local opaque file aliases correlate requests
without emitting actual IDs. Original responses/validators are returned unchanged;
no extra API request, retry, CAS rule, conflict rule or provider assumption.
Metadata observation parsing fails open to the original response.

CLI tests use exact pinned RxDB17.6.0 helpers to distinguish acquisition retry,
commit GDR11 and a hypothetical WAL representation mismatch GDR19. That last case
is a causal alternative, not an observed provider claim; the actual attempt had
no partial-v2 metadata request. Privacy tests verify secret/account/validator
values cannot enter diagnostic output. The existing offline browser fixture
checks actual error capture and alias/boolean telemetry with normal body/journal
assertions. One privacy-oracle attempt incorrectly rejected the public field-mask
name permissionId; corrected to reject the synthetic account value, preserving
the original failed log. No evidence was retroactively made green.

The first diagnostic real attempt must identify its earliest native error and
correlated request, then stop if blocked. Do not change validators or extend
timeouts based solely on a hypothetical fixture. Actual R1–R5 remain incomplete;
independent review/native gates/staging evidence do not substitute for real PASS.

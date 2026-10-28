# A–Z five-second idle Drive experiment — current checkpoint

Issue [#142](https://github.com/innosage-llc/innosage-tools/issues/142) remains open. Runtime [PR145](https://github.com/innosage-llc/innosage-tools/pull/145) is merged and deployed to existing staging. **HOLD: the formal timed sample and final acceptance are pending.** Do not use preparation measurements as Z-to-safe-close latency.

## Delivered runtime and verification

- Reviewed topic: `01e6ad02852bfcc54003c863a06a620f871df30f`; merged runtime: `cbfb1054319a19bb2bd1003ebbc307bee902f372`. Their source trees are identical. Independent exact-head review PASS.
- Staging version `0.1.7`; deployment `a47f4bf8-7bcf-42b7-bdd5-af642b25581c`; build `7175c368cbe4e3a348fc518fbb1d7d5a05f2af52e7d02c915cd515a363b803d1`. Native deployment receipt verified2routes/24assets/release identity; original A browser release identity matches.
- Candidate: https://a47f4bf8.innosage-tools.pages.dev/byos-workspace/ . Use the original BYOS113 A/B stable staging tabs and existing workspace binding for live work, not a new origin/account/folder.
- Native full gate PASS at submit and merge. Focused12scheduler/race tests and5experimentaltransport tests PASS. Full actual-Chrome local/intercepted workspace suite PASS. New26-record close/reopen mock case made2210requests and0realGoogle requests. These are correctness tests, not Drive performance.
- No hosted workflow runs were present for the merged runtime when checked. No remote CI was dispatched. Draft and production were not changed.

The separate opt-in experiment adds per-page last-input+5000ms eligibility, automatic durable saves including final Z, one native workspace replication owner and automatic independent verification. Later-page input does not reset earlier-page eligibility. Existing whole-workspace Sync/Verify can carry other durable pages; eligibility is not isolated per-page transmission. Existing journals, CAS, native180s/1000request operation limits remain. The run has6000RPC/25min/26Sync/52Verify ceilings, fails closed on uncertainty, and withdraws safe-close on new input or relevant state changes.

## Frozen fixture and real Drive preparation

Founder authorized26distinct synthetic pages in the original disposable account/workspace/folder and originalA/B contexts. [Frozen manifest](idle-evidence/idle-fixture-manifest.json) records all26IDs, initial complete-record hashes and expected final-body hashes before any new Drive request. Pages are roots titledAZ142 A–Z; each body is exactly4096ASCII bytes. Initialphase0 becomesphase1 in the formal pass. Original12pages and historic demo are retained.

[Preparation evidence](idle-evidence/idle-preparation.json) and [pre-traffic amendment](idle-evidence/idle-live-protocol-amendment.md) document actual operations and the instrumentation correction. Native Verify synchronizes the whole workspace and independently reads the selected complete record. No fictionalfour-page transmission isolation is claimed.

| Observation | Result |
| --- | --- |
| Initial generations independently verified | 26/26 |
| First preparation Verify start | 2026-10-28T12:42:04.7005Z |
| Last preparation Verify end | 2026-10-28T12:56:20.9832Z |
| Elapsed preparation including measurement pause | 856.283s |
| Sum of26sequential operation durations | 644.172s |
| Individual preparation operation durations | 20.356–58.667s; not Z-wait distribution |
| C–Z measured RPCs | 600, allHTTP200 |
| C–Z decoded payload bytes | 1,920up / 1,062,360down |
| A/B RPC and byte counts | UNKNOWN; outercounter missedURLobjects |
| Conservative unmeasured reservation | 2,000RPC; C–Z limited to4,000additional, original30min clock retained |
| Warmcheck at12:57:44.078Z | 38totalpages; pending0; healthy;26initialhashesmatch; original12fullrecordsunchanged; measuredinflight0; no native/providerfailure |

A/B both succeeded58.6671s/51.9637s before the counting defect was found. The driver stoppedafterB; the parser was corrected and tested locally forstring/URL/Request and fail-closedunknowninputs. Independent review approved conservative continuation under the same absolute deadline. A/B were not rerun; no provider failure or uncertainty latch was reset. Response bytes are decoded application bytes; cloned-body measurement adds overhead. Preparation request/byte coverage remains incomplete, neverzero or complete.

## Formal run and exact remaining blocker

**NOT_RUN.** A later attempted console start did not execute: nativeChrome focus was taken by another concurrent task. The observed A UI remained Off. No Zfinalinput, all-final-generation Drive verification time, independentBfinalreadback or actualAclose/reopen result exists for the newscenario.

The originalBYOS113A/B profiles currently require nativeChrome; the available browser-extension binding cannot target them. Native UI focus changed between observations/actions, so further typing risks targeting the wrong context. This is a shared-UI coordination blocker, not an OAuth denial or missing26page authorization. ExistingA was left with all initialrecords saved/verified and no operation active. No browser permission was expanded; a multiple-download prompt was closed and evidence saved via individual Save Link As.

Pending action: reserve nativeChrome foreground for this task, reconfirm originalA identity/currentOffstate and warmfixture, then invoke the already frozen [timed driver](idle-evidence/idle-timed-driver.js) once. Use nominal1000ms inputcadence, record actualjitter, leaveZselected forautosave. Primary metric is Zlastinput→all26finalgenerations independentlyverified/safe-close. Separate Bsync/readback delay and actualAclose/reopen checks. No claim of safe closure before zero dirty/pending/uncertain/conflict/required-inflight work. Do not reload or recreate the preparedfixture unnecessarily.

The user was asked to coordinate exclusiveChrome use. Approval of the26page test itself remains valid. A single eventualsample will not establishp95, a range, or anupperbound. Founder makes final staging/outcome acceptance; no production, issueclosure, cleanup or permission expansion follows from this checkpoint.

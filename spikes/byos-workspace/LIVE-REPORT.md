# Real Drive qualification — issue142

Decision: **HOLD on Draft integration.** The bounded engineering evaluation is
complete and ready for Founder outcome review; this is not product acceptance.
This report supersedes the historical
NOT_RUN/permission-blocked checkpoint in LIVE-RESUME.md. Founder authorized
existing Tools staging, original-session renewal and twelve synthetic pages in
the original disposable A/B contexts. No new account, folder or OAuth scope.

## Locked runtime and evidence applicability

- Implementation PR: https://github.com/innosage-llc/innosage-tools/pull/143
- Integrated runtime: `a5303edf5ebc0ac00c1769e108700ec517c1dee8`.
- Reviewed topic tree: `12d7d9e65d5f244908b99c5b67dc606290aee799`; identical
  runtime tree after squash. Independent review covered46 source/doc blobs,
  manifest SHA256 `d5ddcb567bb411b5275434cd2100b75483d0351bd9270eb6b745ac7a94a42dd5`.
- Staging: https://staging.innosage-tools.pages.dev/byos-workspace/
  (use each approved profile's existing workspace URL; a fresh unbound URL is
  deliberately refused).
- Deployment: `3dea6cc2-2da7-4778-9f50-1b9c796f1edd`, immutable origin
  https://3dea6cc2.innosage-tools.pages.dev, version0.1.6.
- Build SHA256 `4446a3ec32b4b39256cc225ecf74fc40cee32fbc2a88361da9c474783a782158`;
  configuration `76dc1ac162638450c1d376275e63f6b5f624fc6cc0324a4efb1ae17b06e8c369`.
- Stable-origin HTML SHA256
  `2b8303d1142063b8cec0db263be8f97df56a7d8b43d2dd2798097f46e6946ae9`;
  app bundle `8081f651693c919ed658a40d17dcebc16519c808f04809aeab4a96cd1ffc30c4`.
- Local Gatekeeper,35 focused checks and full browser suite PASS on this tree.
  Static staging path/offline reload separately PASS. No hosted CI run was
  dispatched; no production deployment. Report-only follow-up does not change
  the deployed application or qualify another runtime revision implicitly.

## Observed real-provider results

The final forward fixture was twelve existing synthetic pages, each4096 ASCII
Markdown bytes, in one root/eleven-descendant chain. The independent B bootstrap
matched all twelve SHA256 hashes of complete decoded envelopes, including
workspace/id/title/parent/order/body/editId. The reverse test renamed every page,
changed every body and reparented into a healthy three-level tree: root01;
children02/03/04; grandchildren05–07 under02,08–10 under03,11–12 under04.
Independent A readback matched all twelve B complete-record hashes.

| Preparation phase | UI seconds | RPCs | Request body bytes | Decoded response body bytes |
|---|---:|---:|---:|---:|
| Corrected A fixture upload |146|219|118028|551110|
| Independent B readback |33|55|385|149649|
| B reverse upload |148|222|164293|676226|
| Independent A readback |33|54|120|134496|

All twelve source generations were also explicitly verified in each direction,
with zero source journals afterward. These per-page operations are additional
to the table; they are not hidden in the Sync timings. A verification took about
18–30seconds per page; B about18–37seconds. The reverse readback overlapped B
verification, so these preparation phases are not an equivalent-workload cost
comparison. One actual CAS412 was observed in each upload and A readback, with
matching final destination records; this is not injected-failure coverage.

The first native A attempt waited for same-database leadership with zero
requests. After a safe reload and confirmation that the old demo had no drafts,
its runtime was unloaded by navigating to about:blank, retaining history and
IndexedDB. The same safe ownership handoff was applied at B. The first successful
connectivity upload (159seconds/225RPCs) used an imperfect fixture and is excluded
from performance comparison. Deep-tree native UI automation sometimes hit an
expansion control or failed to enter an edit; the fixture was corrected and
validated against exact stored records before the reported forward run.

## Controlled comparison and actual failure

The frozen comparison uses the same A profile, twelve warm existing pages,
unchanged titles/parents/order, equal4096-byte bodies, identical save ordering and
250ms spacing after durable-ACK observation. Bodies contain a heading, list,
code and link; only one phase-marker character differs. The explicit baseline
is a **batch**: save all12, one explicit Sync, then Verify each page. The candidate
coalesces the same12 saves with its existing750ms foreground debounce, then uses
the same separate verification and B readback. This is not twelve manual Sync
calls; synthetic per-page baseline results remain separate.

The first controlled manual batch failed with `SYNC_BUDGET_EXHAUSTED` at the
existing180second ceiling,234RPCs,164230 request-body bytes and737446 decoded
response-body bytes (232HTTP200,2HTTP412). All12 exact acknowledged records and
their12 journals remained locally, with a healthy tree and no false cloud
verification. The diagnostic runner halted without retry. Independent B readback
then matched all12 complete records in27seconds/42RPCs; the writes had arrived,
but A had correctly withheld confirmation. A reload preserved all12 full hashes
and pending journals while showing unauthorized/cloud-unverified state.

Recovery proceeds only after that independent observation, using the existing
reload/unchanged-account renewal and explicit Verify controls. The failed attempt
remains a failure; recovery must not be relabeled as an uninterrupted benchmark
PASS. Explicit recovery verification completed for all12 generations in a summed
252.816seconds/318RPCs,1265 request-body bytes and589536 response-body bytes.

Foreground then coalesced12 equivalent saves into **one** native dispatch. Sync
completed in167 UI seconds (168.053seconds including the remaining debounce),
255RPCs,164414 request-body bytes and776745 response-body bytes. Separate12-page
verification added300RPCs. Source save→sync→all-generation verification took
422.121seconds,555RPCs,165374 request-body bytes and1303828 response-body bytes.
The foreground run was explicitly stopped after completion, at1/2 dispatches.

B's local authorization had expired; its first readback stopped with
`REAUTHORIZE_REQUIRED` and **zero provider requests**, with zero local journals.
The original account/session was renewed without broader consent. B then read
the exact12 complete foreground records in32seconds/55RPCs,385 request-body bytes
and150059 response-body bytes. Both trees were healthy and both profiles had
zero pending journals. Temporary measurement wrappers were removed.

The successful foreground source+destination phases total **610RPCs**,165759
request-body bytes and1453887 decoded response-body bytes:50.8RPCs per changed
page for this sample, including independent verification/readback. The complete
observation ran from08:20:28.225Z to08:32:09.463Z (11m41.238s), which includes
operator work and B renewal; it is not uninterrupted network latency. The failed
manual attempt plus its independent readback and recovery totaled594RPCs. These
sequential, single-sample outcomes have different failure/renewal histories, so
**no causal speedup, cost reduction, scenario p95 or clean uninterrupted paired
benchmark is established**. The same data/input workload does not erase those
condition differences. The first manual end-to-end timestamp was not exported
before reload; retain its observed phase times, not an invented total.

Raw observed numbers, complete-record hashes and limitations are in
[live-drive-20261028.json](evidence/live-drive-20261028.json). The
[frozen plan](evidence/live-comparison-plan.md) and
[payload counter](evidence/live-payload-counter.txt) explain the measurements.
Across the listed preparation, verification, comparison and recovery operations,
2684 Drive requests were observed; aggregate whole-session byte coverage is
incomplete. OAuth and staging HTTP traffic are outside that Drive count.

## Criteria coverage and decision

| Criterion | Engineering evidence and limits |
|---|---|
| AC1 fidelity | Root/child/grandchild, rename/reparent and full-body tree regressions PASS; real12-record reverse reparent and reload hashes PASS. Deep12-level tree labels were awkward for native pointer automation; three-level fixture used for reverse/comparison. |
| AC2 local safety | Protected-commit/offline/owner-failure tests PASS; actual timeout retained12 exact journals and reload preserved them. Local-only benchmark remains separate from live timings. |
| AC3 atomic records/tree | Full-envelope equality and stale-generation/tree guards PASS; real bidirectional full-record hashes match. Cross-record changes are not transactional. |
| AC4 real Drive | Actual A→Drive→B and B→Drive→A exact12-record/tree matches PASS; original account/client/folder binding enforced. Live multi-page pagination not exercised; synthetic pagination coverage is separate. |
| AC5 honest UX | Actual pending/verified distinction,180s blocked outcome, stopped foreground and zero-request local auth-expiry boundary observed. No false current success. UI remains INCOMPLETE because it has no imported B receipt; independent destination evidence lives in this report. |
| AC6 recovery | Full-envelope conflict choices/stale completion/lost-response guards PASS in regression fixtures; actual timeout/reload/explicit verification recovery PASS. Real concurrent conflict choices, provider401/revocation/lost-response injection NOT_EXERCISED. |
| AC7 responsiveness |120 local trials,30 per size/mode, meet proposed ACK/switch p95 targets; raw local evidence retained. No live-cloud SLO claimed. |
| AC8 sync cost | Live phase counts/bytes/times and failed manual/successful foreground outcomes recorded. Clean paired causal comparison remains INCONCLUSIVE because of timeout/recovery/renewal; no p95/SLO. |
| AC9 human journey | Three bounded journeys below. Human usability NOT_RUN; satisfaction UNKNOWN. |
| AC10 reproducibility | Locked runtime/review/build/deploy identities, local gates, original PR, raw live receipt and report-only follow-up. Founder acceptance still pending. |

The safety observations support retaining this isolated prototype for review.
They do not justify a Draft migration: cloud confirmation takes minutes for12
small pages, one run exhausted the native ceiling, request amplification is
large, and destination-receipt UX is incomplete. The next technical investment
should investigate existing native request amplification and bounded operation
completion without weakening CAS/journal guarantees. Any native-protocol change
remains outside this spike's grant. #125 remains the later consumer-interface
gate. Do not force a GO by increasing the deadline or hiding verification work.

## Founder verification (existing twelve-page fixture)

Use the existing approved A/B Chrome candidate tabs. The final three-level tree
has B142 Page01–12; A shows verified generations, stopped foreground, and
incomplete destination handoff. B contains the exact same records. Original
historical demo tabs were left about:blank with history/data preserved to avoid
competing database leadership. Cloud actions can take minutes; these journeys
are not promised to finish in five minutes collectively.

1. **Normal handoff:** change one existing leaf's title and Markdown in A. Save
   locally, then Sync and Verify. Observe that local ACK is immediate and cloud
   status remains pending until exact verification. Sync B and compare the full
   leaf/title/parent. Reverse one edit. The app's handoff stays incomplete without
   a separate destination receipt; do not interpret that label as an automatic
   availability guarantee.
2. **Local recovery:** Disconnect A, edit two existing leaves and Save. Reload and
   check complete text/tree/pending state before renewing the same approved
   account. Sync/Verify, then read in B. Retained input must never be replaced by
   a success label or an older generation.
3. **Concurrent change:** save different body/title changes to one existing leaf
   in A and B before syncing. Inspect full recovery originals and use one explicit
   conflict choice. Verify the chosen generation and read it at the other profile.
   Report any missing original, overwritten typing or false current verification.

Accept/reject the **HOLD evaluation and bounded staging behavior**, with any
observed failures; Master142 remains open. No production/cleanup/closure follows
from acceptance. Previous stable staging source was
`bc4697a87253b1056c872a7aa8272fe2a38aaf25`; no rollback was performed. Production
was untouched. Any later staging replacement follows its normal owner/release
contract; preview deployments are not production rollback targets.

## Measurement boundaries

Native Chrome on authorized Mac Studio, original independent browser profiles,
normal network (no throttling), same strict real-provider build. A temporary
in-memory wrapper counts only request method/body size, cloned decoded response
size, status and duration; it retains no headers/tokens/URLs/content, creates no
requests, and returns the original response unchanged. Bytes are application
payload, not compressed/wire bytes or provider billing. Completion polling adds
50ms or250ms to some diagnostic timings. Single scenario samples cannot support
a scenario p95 or latency SLO. Human usability remains NOT_RUN; satisfaction
UNKNOWN. Real provider401, revocation and lost-response injection remain
NOT_EXERCISED. Twelve live pages do not prove multi-page provider pagination;
that path has separate synthetic regression evidence.

The120 local responsiveness trials remain local/loopback evidence:30 each for
12/500 pages with cloud idle/in-flight. Worst ACKp95=35.9ms (target200ms), worst
switchp95=22.1ms (target150ms); no real cloud-latency conclusion follows.

No Draft source/data changed. No cleanup, production, permission expansion or
Master closure is authorized by this report. #125 remains a separate future
integration gate. All original demo data and the synthetic qualification fixture
are retained for Founder verification.

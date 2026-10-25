# Acceptance candidate — issue #136 frozen v1

Engineering verdict PENDING checks/review. Human usability NOT_RUN; satisfaction UNKNOWN.
No source is integrated or deployed by this draft deliverable. #102/#113 remain open.

| Criterion | Current evidence |
| --- | --- |
| U1 | isolated loopback route; persistent simulation notice; 12 / 10,000 catalogs, one editor, distinct pending pages |
| U2 | IndexedDB strict transaction completion before ACK; failure test; browser process restart fixture |
| U3 | fake-clock coalescing/single-flight/FIFO; offline/auth; 60s stall + cancel/retry; cancelled late callback fence |
| U4 | immutable edit identity; old receipt cannot confirm new edit; full conflict sources/history; cloud/local/merge tests |
| U5 | explicit handoff, matching identity and full body; second-device view only confirmed content; new edit invalidation |
| U6 | browser script records 20 × 4096-character fills/ACKs per size under identical never-completing operation; real clock |
| U7 | deterministic.tap; browser.json/screenshots; independent review + native gate results to be finalized |
| U8 | final decision, exact hashes/SHA and remaining risks to be finalized after review |

The fake-clock matrix runs both sizes, both 10s/45s ordinary edit/switch and older
completion, fairness/inactive progress, handoff completion/re-edit; never-completing,
offline/reopen/auth/retry; same-page conflict while typing and all three resolutions.
Actual browser verification uses Chrome profile process restart, not fake storage,
plus real-time simulated 10s/45s checks. Mock results do not establish Drive speed.

Remaining design risks: browser eviction is not backup; no cross-device protocol;
logical cancellation does not prove real transport cancellation; no tab cooperation
beyond single-writer refusal; active conflict history serialization grows with local
history; automation sample size is bounded and no target SLO was agreed.

## Up to three human journeys (not yet performed)

1. Start `npm run spike:byos-ux`, open loopback URL, select 45 seconds, edit two
   pages. Expect immediate typing, local ACK only after commit, two pending pages,
   and incomplete handoff until matching generations finish (up to 90 seconds).
2. Select Never completes, edit, cancel/recover and deliver old completion. Expect
   uncertain pending state, no false confirmation. Close and reopen this browser
   profile/URL: exact acknowledged text returns. Retry with 10 seconds.
3. Inject conflict while typing; inspect complete bodies; Keep local or Merge
   manually. Expect no automatic text replacement. Prepare handoff, then edit again:
   handoff returns to incomplete. Report page, edit IDs, scenario and expected/actual.

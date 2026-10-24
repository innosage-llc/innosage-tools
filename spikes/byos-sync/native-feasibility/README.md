# Tools 107: bounded native discovery candidates

This packet is mock-only evidence for lead convergence and independent review. It does not qualify Google Drive, unattended delivery, product adoption or universal impossibility.

From `spikes/byos-sync`, in a clean evidence destination:

```sh
node --check native-feasibility/run.mjs
node native-feasibility/run.mjs --self-check
node native-feasibility/run.mjs T10
node native-feasibility/run.mjs T100
node native-feasibility/run.mjs H100
node native-feasibility/check.mjs
```

The existing evidence directories deliberately reject overwrite. Preserve them when replaying in a separate copy. The oracle was expanded and hashed before execution; `freeze.json` records both issue-container and exact issue-body hashes. Initial freeze failed closed because the delegated hash identified JSON.body rather than container bytes; the lead independently reconciled that provenance before execution. The first T10 setup could not bind loopback in the sandbox (zero requests); `evidence/setup-sandbox-denied-T10` preserves it. The three actual cases ran with approved local-listen escalation, unchanged harness/oracle, no automatic retry.

| Case | Criterion outcome | Complete bodies on receiver | Admitted/observed | Elapsed |
| --- | --- | --- | --- | --- |
| T10 | C3 FAIL | 16/30; page016–029 missing | 193/193 | 578.378 ms |
| T100 | Tie subcase PASS | 30/30 | 207/207 | 613.396 ms |
| H100 | C3 FAIL | visibility0 stays original after both restart candidates; fresh diagnostic has both latest bodies | 458/458 | 1560.554 ms |

Exit 0 means the bounded experiment completed and captured evidence; it does **not** mean C3 PASS. Setup/capture/source/cap/timeout failures are INCONCLUSIVE, exit 2. The original setup failure remains exit 2. The audit reports capture/source/control PASS separately from criterion FAIL.

Every actual run stayed below 1000 admitted loopback fetches and 180 seconds. Admission checks are synchronous and reject request 1001 before dispatch; the origin check rejects every origin except the exact mock server origin before native fetch. The parent watchdog kills only its own direct child. Partial phase/event files survive cap/timeout. No cap or timeout occurred; these actual cases do not constitute a live timeout fault test. Request admission and nonmock-origin boundary self-checks passed.

All 24 source/oracle/harness entries match pre/post hashes and archived source text, including published CJS **and** TS Drive downstream/index, generic lifecycle, protocol downstream/checkpoint/default conflict handler, shared mock, schema candidate reference and lockfile. These are supplemental attestations, not retroactive CJS/schema attestations for historical runs. `sources-{pre,post}.json.gz` contain original labels, relative paths, source bodies and hashes; they are data archives, not compilable copied modules. Actual module resolution is published RxDB 17.6.0 CJS, Dexie plus fake-indexeddb. The unchanged page schema is imported from `src/candidates.mjs`; no custom conflict handler is supplied.

Full listing/content responses and actual URLs/query strings are in `events.jsonl.gz`, with admission, response, native config, round and phase markers. `phase-*.json.gz` preserve every phase's direct mock inventory (including hidden IDs, full raw body, parsed document and document-folder association), all receiver payloads, native checkpoint documents, missing/mismatched IDs and native request observations. Gzip packaging changes no phase content. Export resolution uses `<byos>/` instead of the local absolute prefix; receipts retain original result SHA and packaged result SHA. All auth/config values are synthetic; request authorization headers are not logged. Response CORS header names are preserved.

One H100 response was HTTP 412 on native transaction-file CAS PUT (`n=214`, writer-update1-round1), followed by native retry and completed materialization. It is preserved in full; no listing/content request failed, no native error was emitted, no unsupported mock endpoint occurred. The offline audit originally assumed every response was 200, exposed this 412, and was corrected to identify that exact transaction-file operation. No research rerun or fixture/oracle change followed the audit correction.

The only timing interpretation is compliance with resource bounds. `transactionTimeout:50` and `retryTime:20` reuse existing fast-harness overrides; they are not product defaults or performance evidence.

The source causes and remaining scope boundary are in `assessment.md`; `criterion-map.json` is the compact C1–C3 handoff. Requested implementer is Sol HIGH; host-routed/provider identity/effort and usage/cost remain UNKNOWN. Independent review, native full gates, initial draft PR and lead verdict are pending; no commit, submit, merge or publication occurred.

Console logs are archived as `console.txt.gz` with exact original-byte SHA256 and compressed SHA256 in each receipt. Native SDK trailing spaces are preserved inside gzip. `packaging-provenance.json` records the packaging-only hash transition; ignored `.generated` retains the original console files. The offline checker verifies decompressed original bytes. No research case was rerun for this packaging change.

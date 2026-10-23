# Foundation independent-review repair

Repaired the two P2 findings against reviewed commit
`84eda9e8885eb7499e206cd691975a808406b98a` (draft PR #93). Executor writes stopped
at this validation handoff; native resubmission and exact-head review remain
lead-owned. No Git/PR/deployment action was performed by the executor.

1. The report now selects the last ledger record for **each** A1/A2/A3, regardless
   of result, and verifies every latest raw artifact hash before admitting PASS.
   Missing witnesses, missing files, invalid/hash-mismatched evidence and latest
   failures produce `FOUNDATION_NOT_PASS`. Historical recorded PASS entries are
   separately labeled and never replace latest evidence. A3 metrics are unavailable
   when its latest result cannot be admitted; valid A3 metrics cannot override a
   missing/failed A1 or A2. The command writes the current non-PASS reports before
   returning a nonzero exit status when required evidence is not passing.
2. Current harness labels are `delayed-get` / `delayed-response`. The historical
   `reordered-get` / mock `reorder` case delayed a **single sequential GET** by
   250 ms; it did not demonstrate response-order inversion. Historical source/raw
   bytes remain unchanged. Reports and README explicitly leave actual inversion
   NOT RUN for R5. The focused test verifies the renamed case and exercised delay.

Fourteen report regressions use only in-memory synthetic records and evidence
loaders: later FAIL for each required witness, blocked/timed-out/not-run latest
A3, missing A1/A2, missing/hash-mismatched/invalid evidence, contradictory receipt
envelopes, absent metrics and nonzero false-state observations. No fabricated
failures were written into the real ledger. This repair is validation of the
existing three hypotheses, not another unblock attempt.

Validation command: `npm --prefix spikes/byos-remediation test` — **18 passed,
0 failed, 0 skipped**, including the affected A1–A3 focused regressions and the
14 report tests. [Current source and validation receipt](../../../spikes/byos-remediation/evidence/foundation-review-validation-20261023.json)
binds the source archive to the losslessly packaged console output.

| Item                            | SHA-256                                                            |
| ------------------------------- | ------------------------------------------------------------------ |
| Current source archive          | `c48dcb6cfeae3e91cd08177d20b5c075e4820b3689fef65018bdd356b2837f76` |
| Decompressed raw validation log | `5bba21de90013a89b029e89c715ae2f8cf22fbe5b3d4735419ef858b2f1ebc37` |
| Gzip validation container       | `89987a7646608eb5831056feeae763c3bbb3f13f8e8154b940f6e6e9de4cd6c5` |

[Source provenance](../../../spikes/byos-remediation/SOURCE_PROVENANCE.md) now
provides exact verification recipes for preserved A1/A2 sorted Python JSON
aggregate hashes versus later compact JavaScript/insertion-order hashes. The
recipe verified all five archives and every recorded file/dependency hash.
`npm --prefix spikes/byos-remediation run report` regenerated derived current
SUMMARY/SCORECARD/machine summary from the unchanged real ledger;
`git diff --check` passed on the owned paths.

Known full-acceptance gaps remain unchanged: R5 full scaled/seeded/browser and
actual response inversion coverage, explicit recovery state for suppressed child
edits, concurrent recreates/resolutions, R6 repeated diagnostics, and R7 independent
re-review/native gates/integration. No full adoption, real-provider, deployment,
or Master-closure claim. No denied or pending operation.

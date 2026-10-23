# Remediation foundation scorecard

**Latest hash-verified evidence passes all required focused A1–A3 witnesses. Full R1–R7 acceptance remains pending.**

| Latest witness | Result | Source hash prefix | Evidence | Reason |
| --- | --- | --- | --- | --- |
| A1 | PASS | abb9baba1f0f | [raw](evidence/a1-initial-console.json) | — |
| A2 | PASS | da02ed0ad96e | [raw](evidence/a2-initial-console.json) | — |
| A3 | PASS | 64cc9a4c775d | [raw](evidence/a3-2026-10-23T10-10-44-672Z.json) | — |

Latest valid A3 evidence sampled 152 states across 38 provider/scenario cases, with 0 false local/remote/pending observations under the documented exact-set contract. Requests: 270. These A3 observations do not override other required witness results.

Historical A3 raw/source labels `reordered-get` and mock `reorder` exercised only a single sequential GET delayed 250 ms. Current source calls this `delayed-get` / `delayed-response`. Actual response-order inversion is NOT RUN and remains R5 work; historical bytes are preserved.

Historical recorded PASS entries (not current acceptance; not revalidated here):

| Witness | Historical status | Source hash prefix | Evidence |
| --- | --- | --- | --- |
| — | No superseded PASS entries | — | — |

Full 10/1,000-page/100-seed safety and real renderer crashes: NOT RUN. Normal repeated diagnostics: NOT RUN; percentile comparison INELIGIBLE until hard gates pass. Quota weights and provider cost are UNKNOWN. Custom transport requires complete coherent GET/strong ETag/If-Match semantics; live providers were not tested. Independent review, native gates and integration remain required. No deployment or Master closure.

Endpoint/method counts and complete ledger references are in the [machine summary](evidence/foundation-summary.json). [Original baseline scorecard](../byos-sync/SCORECARD.md) remains unchanged.

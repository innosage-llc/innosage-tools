# Remediation foundation scorecard

**Partial progress; no adoption or full R1–R7 acceptance claim.**

| Witness | Result | Source hash prefix | Evidence |
| --- | --- | --- | --- |
| A1 | PASS | abb9baba1f0f | [raw](evidence/a1-initial-console.json) |
| A2 | PASS | da02ed0ad96e | [raw](evidence/a2-initial-console.json) |
| A3 | PASS | 64cc9a4c775d | [raw](evidence/a3-2026-10-23T10-10-44-672Z.json) |

A3 sampled 152 states across 38 provider/scenario cases, with 0 false local/remote/pending observations under the documented exact-set contract. It retained complete acknowledged bodies and recovered within the declared bounded stable-transport cycle. Permanent denial correctly remained blocked before access was restored in the fixture.

Requests: 270; endpoint/method counts and all raw failed/blocked outcomes are retained in [machine summary](evidence/foundation-summary.json) and raw runs. Quota weights and cost are UNKNOWN. These are correctness diagnostics, not normal-network latency measurements. Full 10/1,000-page/100-seed safety and real renderer crashes: NOT RUN. Normal repeated diagnostics: NOT RUN; percentile comparison INELIGIBLE until hard gates pass.

[Original baseline scorecard](../byos-sync/SCORECARD.md) remains unchanged. Custom transport requires complete coherent GET/strong ETag/If-Match semantics; live providers were not tested.

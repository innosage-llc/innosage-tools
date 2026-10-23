# BYOS decision — NO SAFE WINNER

**HOLD.** Both engines lose one concurrent acknowledged edit after reopen. Selfstore manual mode preserves no full conflict archive. No safety-qualified engine is ranked.

**Engine comparison — same mock Google Drive**

| Metric (10 / 1000 pages unless stated) | RxDB 17.6.0 → Drive | selfstore 1.8.29 → Drive |
| --- | --- | --- |
| Same-page hard gate; lost / ACK (n=1) | FAIL; 1/2 | FAIL; 1/2 |
| One-edit HTTP requests (n=1 each) | 169 / 167 | 20 / 20 |
| One-edit payload up+down bytes | 35,301 / 35,720 | 7,105 / 194,901 |
| One-edit known quota + unknown-weight requests | 6,800 + 101? / 6,800 + 99? | 115 + 6? / 115 + 6? |
| Post-ACK foreground settle ms (n=1 each) | 1,670.24 / 1,683.05 | 185.92 / 305.59 |
| Seed cases converged / attempts | 50/100 | 50/100 |
| Fault attempts PASS / BLOCKED / TIMEOUT | 7 / 1 / 1 | 8 / 1 / 0 |

**Provider comparison — same selfstore engine**

| Metric (10 / 1000 pages unless stated) | selfstore 1.8.29 → Drive | selfstore 1.8.29 → WebDAV |
| --- | --- | --- |
| Same-page hard gate; lost / ACK (n=1) | FAIL; 1/2 | FAIL; 1/2 |
| One-edit HTTP requests (n=1 each) | 20 / 20 | 27 / 27 |
| One-edit payload up+down bytes | 7,105 / 194,901 | 6,895 / 194,726 |
| One-edit known quota + unknown-weight requests | 115 + 6? / 115 + 6? | N/A |
| Post-ACK foreground settle ms (n=1 each) | 185.92 / 305.59 | 253.23 / 371.56 |
| Seed cases converged / attempts | 50/100 | 50/100 |
| Fault attempts PASS / BLOCKED / TIMEOUT | 8 / 1 / 0 | 8 / 1 / 0 |

**Limits:** MOCK-TESTED synthetic normal8±2ms/request; n1 diagnostics are LOW_CONFIDENCE, with P50/P95 and30-trial ranking NOT_RUN after safety failure. Payload bytes exclude headers/TLS. Quota is known subtotal plus UNKNOWN requests, never total/billing. Lifecycle differs: RxDB reinitializes native non-live replication each cycle; selfstore retains its adopted target. No latency/cost ratio or real-provider claim is justified.

**Next:** require durable conflict recovery and repair/retest RxDB same-time checkpoint stall (16/30 propagated,14 still locally durable). Keep Drive preferred and native WebDAV secondary; rclone is architecture-only. Then seek separate authorization for the smallest disposable-account smoke.

[Detailed numeric scorecard](SCORECARD.md) · [Raw attempts](evidence/results.json) · [Supplemental probes](evidence/extra.json) · [Browser crash/CORS](evidence/browser-smoke.json) · [Full-fixture checks](evidence/fixture-check.json) · [Replay/provenance](README.md). Regenerate both tables: `npm run report`.

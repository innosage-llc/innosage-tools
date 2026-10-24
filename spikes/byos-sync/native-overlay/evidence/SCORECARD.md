# Native RxDB overlay scorecard

**NATIVE UX SPIKE PASS; HOLD FOR CHECKPOINT**

MOCK-TESTED; REAL-PROVIDER-NOT-RUN. Master remains OPEN.

Source: `90de7b8df847f6f5fc8b25a88f6da6af76155c8b`; fixture/source digest `fa3094ced9a645d134e6eb2b291fd163b7f9a4f1516158cbcc3726dc02497187`.
Runtime v22.22.3; Chromium 151.0.7922.34; RxDB17.6.0.

| AC | Result | Executable evidence |
| --- | --- | --- |
| F01 | PASS | results:F01; browser-results:F11/after-local-ack |
| F02 | PASS | results:F02 |
| F03 | PASS | results:F03; ui-results:F03; crash-results:F11 |
| F04 | PASS | results:F04; ui-results:F04 |
| F05 | PASS | results:F05; ui-results:F05 |
| F06 | PASS | results:F06; ui-results:F06 |
| F07 | PASS | results:F07; ui-results:F07 |
| F08 | PASS | results:F08; ui-results:F08; crash-results:F11 |
| F09 | PASS | results:F09; ui-results:F09 |
| F10 | PASS | fault-results:F10 |
| F11 | PASS | browser-results:F11; crash-results:F11 |
| F12 | PASS | browser-results:F12; ui-results:F12 |
| F13 | PASS | browser-results:F13; ui-results:F13 |
| F14 | PASS | browser-results:F14; ui-results:F14; leader-results:F14 |
| F15 | PASS | browser-results:F15 |
| F16 | FAIL | results:F16; hidden-checkpoint:F16 |
| F17 | PASS | measurements:F17; overlay-measurements:F17 |

Seeds: 100/100 passed. Complete bodies are checked in journal, chosen view, native pages, mock remote and recovery.

Checkpoint: 30 remote documents; cold replica 16/30. Hidden older edit remains undiscovered after visibility returns. No native patch/fallback.

One offline replay: `npm run test:byos-native-overlay:full`. JSON report and compressed raw request/fault ledger accompany this scorecard.

Synthetic measurements (n=3 each scale):

| Pages | Overlay p50 settle ms | Overlay p95 settle ms |
| --- | --- | --- |
| 10 | 267.7 | 274.9 |
| 1000 | 1425.7 | 1432.4 |

Foreground local rendering is separate from cloud settle; native network checkpoint ordering is unchanged. These are not Google timings. Founder final acceptance, deployment and product adoption are not granted by this report.

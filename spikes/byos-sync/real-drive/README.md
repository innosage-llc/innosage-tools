
## Explicit-action latency regression (#113)

`npm run test:byos-latency` reuses the existing native mock/provider and browser
binding with two isolated synthetic profiles. Google requests are intercepted;
this does not test real OAuth or measure Google service latency. Set
`BYOS_FIXTURE_DELAY_MS=250` for a controlled250ms delay per physical request.
Private receipts remain in ignored `.byos-real/latency-repair-*` directories.
`BYOS_LATENCY_APP_URL` can select the exact deployed demo for the same intercepted
boundary test; it must not be reported as real-provider acceptance.

Explicit actions reuse one native state through public start/pause and disable
visibility-triggered resume. Verify/Resolve omit duplicate journal materialization
while retaining independent full-body reads, second native settlement, original
CAS and generation checks. Events do not launch background transactions in this
mode. Local Save and visibility changes while paused must dispatch zero requests;
the next explicit action must pick up and independently verify the saved body.
The entire action owns progress, timing and duplicate/competing-click coordination.
Resolution captures its intended journal generation before account preflight.
A later local ACK invalidates the choice and remains protected. Read/local-check
errors are surfaced after native CAS lease release; native transaction failures
remain failures. No lease shortening, metadata reset, native fork or auto-upload.

The focused fixture checks immediate feedback (<100ms in the declared local
fixture), unchanged full conflict bodies, no duplicate request amplification,
zero idle/Save/visibility traffic, paused-edit resume, held-preflight newer-ACK
cloud/merge retention and lease release after rejected choices. Request/header/body
timings have per-operation monotonic clocks and contain no credentials, query
values or raw file IDs. Completion remains bounded by real sequential network work;
a spinner is not proof of latency repair or Founder acceptance.

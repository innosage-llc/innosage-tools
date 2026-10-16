# Hub #344 — DO wake repair checkpoint

Baseline: `e4162b2800fded7d67bc5ecd3ab0243dfc0ee746`. Existing candidate:
[innosage-tools PR #65](https://github.com/innosage-llc/innosage-tools/pull/65).

Scope remains the two-arm comparison: A's deployed D1 long-poll and physical
bindings stay unchanged. B reuses the D1 schema/mailbox and OAuth implementation
but must bind a separate new physical D1 and OAuth KV. DO remains a hibernating
generic wake channel, not command authority. No Cloudflare resources or
deployments are changed in this repair phase.

Repairs: capture the validated bridge-proof expiry before the socket timer;
retain one delayed catch-up after a transient wake-triggered metadata-sync or
pre-claim failure, with a second failure waiting for a fresh wake; query
cancellation once when a claimed operation becomes active, in addition to
subsequent wake checks. A failed ACK still retries only its saved result.

Focused evidence: root browser remote tests 12/12 PASS; focused strict root
TypeScript check PASS; Worker TypeScript check PASS; bridge tests 5/5 PASS; ACK
tests 2/2 PASS; `git diff --check` PASS. Full native CI, Cloudflare staging,
deployment, and merge are not part of this checkpoint. Fresh independent review
is required on the updated exact PR head before any B resource creation.

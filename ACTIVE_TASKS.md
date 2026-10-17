# Active task

Hub #358 — V1 source preparation for the isolated D staging candidate. Lead
authorized only the existing matched E2E runner, its focused offline regression,
and the existing runbook/candidate docs; no runtime/A-B changes, Cloudflare
writes, live requests, issue updates, commit, push, or PR. First matched round is
one 60-second synthetic journey: hidden idle 120s, Cut1 2s, Cut2 4s, Undo2 to
Cut1 bytes/plan, then disconnect/revoke (three mutations; no final Undo to
original). Preserve older reports as history. D is absent; A/B remain enabled
at read-only observed versions. D daily DO headroom UNKNOWN is accepted/non-
blocking under the current #358 waiver; no further generic quota probing. The
application's 200-request ceiling is not a Cloudflare spend cap; at most two
project attempts/day and one journey/day. The pre-existing `-oauth-kv` namespace
has unverified provenance and stays untouched; keep the new namespace ID
parameterized and the template's zero placeholder unchanged until approval.
Disabled provisioning approval and enabled-test approval are separate; never
generate, print, or persist the live HMAC secret. Product branch
`codex/d-matched-bakeoff-prep`; lead diff review then one independent review.

Hub #346 (parent #344) — coherent LOCAL OAuth/MCP/browser increment.
Requested executor gpt-6-luna MAX owns isolated Worker/D1 schema, headless adapter,
official auth/transport, tests/config and evidence. Lead owns architecture and exact review; HIGH
independent auth review required before merge/live work. No UI writes: actual
Antigravity gemini-3.8-flash-high HIGH only, stop without fallback.
Actual Gemini CLI 1.3.6 generated only ConsentView.ts/RemoteConnectionView.tsx,
SUCCESS, no fallback. Final HIGH PASS on repair-02 (e0276dc8...), including the
four repaired artifacts and32 unchanged prior hashes; engineering approval granted.
Native autonomous submit/PR next; STOP before auto-merge for lead exact-head
approval. No cloud provision/deploy. Root version fields
match pure-version origin/main ac795b2 (0.1.4); feature WIP remains at20d05.
#345 accepted at Tools 20d05aaf / staging 95c69d8c and closed completed.
No live resources/deploy/paid changes, production, #347, archive or reset.
Hub context: docs/sessions/20261016-hub346-oauth-video/.

## Previous task history (preserved)

Tools #48 — recorder format, duration and ordered finalization; parent Epic #47.
Lead owns recorder library, regression tests, review/gates and staging evidence.
UI worker completed; independent library/UI review PASS, findings repaired.
Focused tests and local real-media checks passing; native gate/PR/staging next.
Completed #49 deployment contract is reused, not rebuilt.
Production, issue closure, archival and reset are not authorized.

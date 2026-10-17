# Hub344 MCP staging check persistence

Status: implementation complete; no new staging flow, deployment or production
action was run.

Persisted one manual, allowlisted D1/DO runner for the existing synthetic
single-cut → Undo-to-original MCP flow, a short operator runbook, one offline
regression on the existing Gatekeeper path, and this product receipt. The
existing fixture is read and hash-checked; it is not regenerated or modified.
The live command is not part of default CI.

The prior Hub evidence remains authoritative: final A passed, while B's raw
result remains FAIL under its original close assertion. This change does not
rewrite or claim to rerun that evidence. The corrected preview check accepts
metadata readiness at readyState 1 with the expected 60-second blob preview.
Only a clean 1008 project-revoked close during explicit disconnect cleanup is
accepted, alongside the existing 1000 disconnected close; any WebSocket error
fails.

The report separates runner Git revision/script hash from deployment identity.
Target deployment version/source revision remain UNKNOWN without existing
operator readback. It stores no OAuth values, IDs, proof, callback content,
media, private paths, screenshot, trace or HAR data.

Offline verification: PASS — runner/test syntax checks, the offline fixture test
(6 reported tests), changed-script lint, whitespace validation, and the pinned
Playwright dependency check. The repository submission workflow runs the full
Gatekeeper before commit; this persistence work does not launch the live staging
command.

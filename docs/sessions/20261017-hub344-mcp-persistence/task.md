# Hub344 MCP staging check persistence

Status: implementation and one explicitly bounded DO smoke attempt complete;
no deployment, production action, second smoke attempt or merge was performed.

Persisted one manual, allowlisted D1/DO runner for the existing synthetic
single-cut → Undo-to-original MCP flow, a short operator runbook, one offline
regression on the existing Gatekeeper path, and this product receipt. The
existing fixture is read and hash-checked; it is not regenerated or modified.
The live command is not part of default CI.

The prior Hub evidence remains authoritative: final A passed, while B's raw
result remains FAIL under its original close assertion. This change does not
rewrite or claim to rerun that evidence. The corrected preview check accepts
metadata readiness at readyState 1 with the expected 60-second blob preview.
Both 1000 `disconnected` and 1008 `project-revoked` require a clean close after
explicit revoke during disconnect cleanup; any WebSocket error fails.

The one authorized DO smoke (2026-10-17) reported FAIL:
`PRIVACY_AUDIT_FOUND_MEDIA_OR_LOCAL_PATH`. Cut/output verification,
Undo-to-original, explicit revoke and disposable-profile cleanup passed. The
offline review traced the audit failure to local `blob:` preview URLs being
counted as network markers; the runner now excludes browser-local schemes while
retaining HTTP(S) request checks. No second live attempt was made, so the
original report remains FAIL. It recorded 63 client request starts and 59
completed responses. The existing operator readback identifies target DO
staging B as `fce5281b-e45e-498d-ac4e-3ccde3816f43`; the smoke's runner Git
revision `502e4066b78454b7c6f0cdc7a0f2ac46f5d44a9c` and source hash
`ba22cc9de573c651ade88af7df3c21d63cde557b0f1a406f80b4157ecf49d995` are
reported separately and are not deployed Worker identity. The redacted runtime
report is `.deploy/video-scissors-mcp-e2e-do-20261017T014534137Z.json`.
The report stores no OAuth values, IDs, proof, callback content, media, private
paths, screenshot, trace or HAR data.

Before the smoke, syntax, offline regression (7 tests), changed-script lint and
the pinned Playwright check passed. After correcting the local-blob audit
classification, the final offline suite passes all 8 tests, with syntax, lint
and whitespace checks clean. Full Gatekeeper passed again after these repairs;
the existing draft PR will be updated at its head. No further staging run is
authorized in this task.

# Active task

Tools #49 — explicit Pages staging/production release contract, parent Epic #47.
Hub lead owns scripts, adapter, integration, secret preflight and staging evidence.
Bounded worker owns only `.github/workflows/deploy-tools.yml` and its focused
workflow regression test. No deploy, merge, branch switching or provider mutation.
Worker implementation completed; lead repaired dispatch gating. Independent
review completed PASS; 15 focused tests passing. Native gate and staging next.
Production, issue closure, archival and reset are not authorized.

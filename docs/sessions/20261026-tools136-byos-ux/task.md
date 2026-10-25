# #136 frozen v1 delivery

Isolated prototype only. Lead V1, no executor. Baseline Tools 8e68426 / Hub 0c25a36.
Current candidate: new local-only `spikes/byos-ux`, 12 / 10,000 metadata catalogs,
journal-first IndexedDB saves, single-flight simulated queue, explicit handoff,
protected generations/conflicts and browser recovery. No live provider calls.
Deterministic 15 tests PASS (fake clocks); actual browser and native gate running.
Independent exact-head review and draft PR pending. Human usability NOT_RUN.
No production, #102/#113 closure, session archival or worktree reset authorized.
Actual Chrome first run PASS: process restart exact body/edit/pending, zero external
requests/page errors. 12/10,000 ACK p50 16.7/16.3ms; maxima 343.8/189.9ms.
10s/45s simulated operations honestly timed 10.08–10.12s / 45.04–45.06s.
Visual inspection prompted readable multiline handoff counts and overflow wrapping;
replay final candidate browser evidence after repair. Independent review underway.
Native full Gatekeeper precursor PASS (exit 0). Reviewer identified hidden archive
presentation; moved archived full conflict history outside the active-conflict panel
so explicit resolution does not make retained originals inaccessible.
Independent review REQUEST_CHANGES: overlapping asynchronous catalog starts could
release another start's writer lock and install stale catalog. Lead repair serializes
catalog initialization and awaits prior lock disposal. Focused Chrome regression PASS
with delayed IndexedDB reads and four overlapping size switches; a second tab is
correctly refused. All three UI resolutions expose archived complete originals;
1280px layout has no horizontal overflow. Final full browser replay pending.
Independent source re-review PASS at d975851 after race repair. Final full Chrome
replay PASS; all six runtime hashes match focused evidence and current files.
Final 20-sample p50 small/large 16.7/16.3ms, max 30.7/37.6ms. 10s simulations
10.05–10.08s; 45s 45.045–45.047s. Earlier outliers remain disclosed in manifest.
Decision: bounded engineering GO after exact-head submission gate; human NOT_RUN,
satisfaction UNKNOWN, production/integration not authorized. Draft submission pending.

# Visual Remix #140: direct canvas MVP

Related to https://github.com/innosage-llc/innosage-tools/issues/140.

Isolated Hub/product branch, baseline Tools 5b5b42e. Lead owns implementation,
repairs and local verification; bounded UI source packet to exact Antigravity
Gemini 3.8 Flash HIGH authorized by user. Independent focused read-only review
found and prompted fixes for candidate preservation on selection, rotated center,
crossing resize anchors, same-revision IME discard and numeric gesture grouping.

Implemented: Scene hit-testing/selection, Fit/100% pointer drag/resize with
transient bounds and one commit/history ID, DOM multiline/composition-aware text
editing, contextual existing appearance controls, center alignment and lifecycle
cancellation. Renderer/controller/Scene schema/asset bytes/remote authorization
remain unchanged. No dependency, backend, permission or production change.

Executed checks: lint, TypeScript, connected build, 9 geometry/controller tests,
new actual-route canvas browser journey, existing controller/render/editor/HTML
unit and browser suites. Native full gate is required at submission and integration.
The browser journey verifies pending candidate preservation on selection, overlap
fallback, rotated resize and drag at 100%, Fit resize, Escape, synthetic IME and
discard during composition, contextual font/color, image/crop byte identity,
PNG Blob parity, HTML contents and save/reopen. Screenshots: before.png/after.png.
Ignored local command receipts are under .deploy/tools140-*.log.

Limit: composition events are synthesized in Chromium. Native OS CJK candidate
window behavior and Founder staging acceptance are pending. Transient feedback
shows geometry bounds; committed glyph/raster preview uses authoritative Konva.
No actual identity poster reconstruction, live MCP/remote traffic, production or
issue closure is claimed. This additive work does not gate #85/#127 retroactively.

Rollback: revert this feature commit; existing Scene/project files remain valid.
PR starts draft. Commit skip marker enforces the task's local-CI-only restriction
without changing Actions configuration or bypassing required branch protections.

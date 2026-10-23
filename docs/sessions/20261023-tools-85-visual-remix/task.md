# Tools #85 — core implementation ready for independent review

- #86 ADR passed independent architecture review and merged via PR #90.
- Current bounded #87/#88 increment adds local core primitives; public UI,
  image reconstruction, motion and live ChatGPT/MCP acceptance remain unproven.
- User-assigned Astra MEDIUM executor / Astra HIGH lead override default V1/UI
  implementation routing only. Independent Sol HIGH review remains mandatory.
- Founder original reference is available locally outside the repo at
  `reference-assets/1(1).png` (workspace root), SHA256
  `a933a808934eb8bf521b0d32c4bedb950698e76fccb62a997221e2d7b39715b5`.
  It was not consumed by this core increment or committed as a fixture.
- No model API service, deployment, live MCP call, production or closure action.

## Core implementation increment

- ADR PR #90 merged as 0c657463aefbc457f9d1b718964099f4a53491f7.
- Branch codex/tools-87-scene-core started with repository autonomous-ops.
- Requested/routed executor: Astra MEDIUM. Provider-observed identity/effort,
  usage/cost and tool version UNKNOWN; no substitution claim.
- Strict data-only Scene/project/proposal validators, bounded local PNG/JPEG
  assets and portable save/reload, revision/generation-fenced preview/Apply/Undo,
  lazy Konva 10.9.0 renderer implemented. No route or live transport added.
- Targeted tests cover unsafe imports, allocation bounds, late/replayed/canceled/
  revoked proposals, content+geometry edits, portable assets, real browser CJK
  reflow/collision/overflow and PNG byte parity. Core tests enter native gate.
- Loopback browser harness reports Chromium 151.0.7922.34; CJK content measured
  404px at unchanged 48px font; 60px box correctly fails export diagnostics.
- First two unit assertions corrected (test fixture prototype assignment and
  shared caller object alias), then 9/9 unit tests passed. Type annotation fixed
  for modern BlobPart typing. TypeScript/lint passed; known baseline lint warnings.
- npm install incidental lock ordering was removed; only exact Konva dependency
  and resolved package entry remain. Clean npm ci --ignore-scripts passed.
- Initial verification: 9/9 core tests, real-browser renderer test, TypeScript,
  lint (only existing warnings), production build and SEO contract PASS.
  Build required approved network retry for existing Google Fonts; branch start,
  dependency install and loopback harness also used approved sandbox escalation.
  No auto-review denials. `git diff --check` PASS.
- Rendered `.deploy/visual-remix-core/long-cjk.png` visually inspected: six legible
  Chinese lines, no clipping or overlap, unchanged 48px font. This is a stress
  fixture, not a reconstructed poster. Machine evidence lives beside the PNG.
- Founder original reference now materialized outside the repo by coordinator;
  not inspected in this core increment. No image reconstruction acceptance claim.
- Independent Sol HIGH review, native full gate and lead publication remain pending.
  No commit/push/PR/merge/deploy/live MCP performed by executor.

## Independent review repair cycle 1

- Sol HIGH review found two P2 defects: Konva could silently omit text when the
  next grapheme could not fit; revoke did not cancel an in-flight project open.
- Added regressions before repair. Both failed on the reviewed code: browser
  expected an overflow diagnostic for `中` in a 1px box; delayed-open unit test
  expected rejection after revoke but the old load resolved and committed.
- Renderer now verifies complete non-whitespace content against Konva's laid-out
  lines and blocks export for omitted content, reporting actual active-font
  grapheme measurements. Browser tests cover full and partial paragraph omissions,
  while narrow Latin `iii` at 48px in a 20px box correctly remains exportable.
- Revoke now aborts and clears the pending project load before rotating generation.
  The delayed renderer regression ignores AbortSignal and still cannot replace
  the last committed scene, revision, project ID or PNG after revoke.
- Affected checks PASS: 10/10 core tests, Chromium 151.0.7922.34 renderer regressions,
  TypeScript, lint (baseline warnings only), diff whitespace. Prior build/SEO/clean
  install evidence retained; full native gate follows renewed independent review.
- Requested/routed Astra MEDIUM; provider observation, usage and cost UNKNOWN.
  No additional scope, commits, external transport or publication action.

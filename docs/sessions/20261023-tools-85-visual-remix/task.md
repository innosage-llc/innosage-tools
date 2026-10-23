# Tools #85 — local editor ready for independent review

- #86 ADR passed independent architecture review and merged via PR #90.
- Core PR #91 merged as c02e2b00e6bab11886357adf43b09983a53afcde after independent
  review and native/GitHub gates. Current bounded increment adds the local editor.
  Actual vision reconstruction, motion and live ChatGPT/MCP acceptance remain unproven.
- User-assigned Astra MEDIUM executor / Astra HIGH lead override default V1/UI
  implementation routing only. Independent Sol HIGH review remains mandatory.
- Founder original reference is available locally outside the repo at
  `reference-assets/1(1).png` (workspace root), SHA256
  `a933a808934eb8bf521b0d32c4bedb950698e76fccb62a997221e2d7b39715b5`.
  Its actual pixels were inspected before editor work; bytes remain outside the repo.
  No reconstruction acceptance is inferred from inspection or control-fixture tests.
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
- Core independent review and native full gate passed; lead merged PR #91.
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
  install evidence retained; renewed independent review and full native gate passed
  before lead integration as PR #91.
- Requested/routed Astra MEDIUM; provider observation, usage and cost UNKNOWN.
  No additional scope, commits, external transport or publication action.

## Local editor increment — frozen for independent review

- Branch `codex/tools-87-visual-remix-editor`, base `c02e2b00e6bab11886357adf43b09983a53afcde`.
  Unrelated BYOS #89 changes on main are preserved.
- Added `/tools/visual-remix`, discovery and SEO, local reference and explicit asset
  approval, descriptor-only agent brief/schema, proposal preview/diff/Apply, Undo,
  cancellation/revocation, node content/geometry/stacking controls, editable CN/EN
  captions, portable project save/open and committed PNG/caption downloads.
- Actual static-route Chromium test covers PNG reference plus real canvas JPEG
  approval/decode/portable reload; explicit candidate/Apply and byte-identical PNG;
  edits, Undo/Cancel/revoke/stale proposals and delayed file-read cancellation;
  invalid export blocking, mobile layout and zero external requests/uploads.
- Checks PASS: 11/11 core units, TypeScript, lint (existing baseline warnings only),
  production build, SEO contract and actual route test. Final targeted editor/test
  lint and whitespace checks pass. Existing font fetch and local loopback server
  required approved sandbox escalation; no auto-review denial.
- Route initial HTML adds 57,959 raw / 19,784 gzip JS bytes relative to index HTML.
  Dynamic Konva chunk is 190,548 raw / 57,032 gzip bytes, absent initial HTML and
  index observed fetches; editor initializes it for the first local render. Index
  prefetch may fetch editor chunks after hydration. This is not a prior-build delta.
- Evidence: `.deploy/visual-remix-editor/route-evidence.json`, desktop/mobile PNGs,
  and `editor-review-receipt.json` (exact file hashes and checks). Generated control
  scene tests workflow only, not agent vision accuracy or first-use/reuse timing.
- Independent second input: ignored `.deploy/visual-remix-editor/second-design.png`,
  1080×1440, SHA256 `48c93e58baf8453ec7d68c3f51aed2fccd3ac5ea8fe408da48373bfa8d81bfb9`.
  Original geometric art/event copy; public-safe, no external logos/portraits. Only
  pixels/path/provenance were supplied to lead, not construction coordinates.
- Requested/routed Astra MEDIUM; provider observation, usage and cost UNKNOWN.
  Independent Sol HIGH review, native full submit gate and lead publication pending.
  No commits/push/PR, live transport, motion, deployment or closure in this increment.

### Pre-review packaging correction

- Added exact installed Konva MIT license as a public distributable notice, with
  both author copyright lines and complete terms, linked from the editor.
- Targeted production export verifies notice presence and byte parity against
  `node_modules/konva/LICENSE`; scoped lint and whitespace checks pass.

### Editor independent review repair cycle 1 — frozen for rereview

- Review VR-EDITOR-1 (P2) reproduced in actual exported route before repair:
  remove crop → Preview edits → Apply → Save left the JPEG descriptor and bytes.
  Regression failed at expected empty `scene.assets` assertion.
- Central `savePortableProject` now validates/copies the scene, derives referenced
  asset IDs from image nodes, and serializes only referenced descriptors and bytes.
  Live scene, approved store and Undo history remain untouched.
- Unit regression covers a valid agent-style scene with unused descriptors; existing
  roundtrip test now has a real image reference/crop. Browser regression proves
  removal excludes both descriptor/payload, while Undo restores scene/crop and exact
  JPEG bytes. Retained JPEG already roundtrips through project reload.
- Approval copy and agent brief disclose whole approved PNG/JPG embedding for each
  referenced asset, including pixels outside any crop; docs aligned.
- PASS: 12/12 units, TypeScript, scoped ESLint, production build, actual Chromium
  route regression (77 requests, zero external), whitespace and license export parity.
  No native full gate rerun; exact-source independent rereview remains required.

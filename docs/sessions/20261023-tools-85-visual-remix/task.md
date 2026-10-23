# Tools #85 — version preparation ready for independent review

- #86 ADR passed independent architecture review and merged via PR #90.
- Core PR #91 merged as c02e2b00e6bab11886357adf43b09983a53afcde after independent
  review and native/GitHub gates. Editor PR #92 merged as
  adae10d1de135df52daf6d5bacee638dd6af00b9 after repair and independent rereview.
  Motion PR #94 merged as 49d11a949716e5d50076a9201be9bfe6e6f0e381 after
  independent review and native gates. Current bounded increment prepares version
  0.1.6 for immutable static staging; actual vision reconstruction and
  live ChatGPT/MCP acceptance remain unproven.
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

## Local editor increment — integrated through PR #92

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
  Editor independent Sol HIGH rereview and native full gate passed; lead merged #92.
  No commits/push/PR, live transport, motion, deployment or closure in this increment.

### Pre-review packaging correction

- Added exact installed Konva MIT license as a public distributable notice, with
  both author copyright lines and complete terms, linked from the editor.
- Targeted production export verifies notice presence and byte parity against
  `node_modules/konva/LICENSE`; scoped lint and whitespace checks pass.

### Editor independent review repair cycle 1 — rereview passed, integrated

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
  Exact-source rereview subsequently passed; lead ran native gate and merged #92.

## Local motion increment — integrated through PR #94

- Native start created `codex/tools-87-visual-remix-motion` from clean main
  `adae10d1de135df52daf6d5bacee638dd6af00b9`.
- Exact applied PNG feeds existing FFmpeg-WASM: 24fps, 5s, 1080×1440 H.264,
  0.5s fade from scene background then stable hold. Lazy explicit export, progress,
  cancellation, revision/authority invalidation, nonempty metadata-verified output.
- Shared runtime helper extracted from Video Scissors with abort checks after
  module load/decompression. No codecs/packages/Workers/scopes added. Full GPLv2
  and upstream wrapper MIT notices plus exact available source/build provenance
  are public; installed packages omit license files, upstream wrapper blob recorded.
- Transparent background has explicit MP4 limitation message and PNG fallback;
  opaque eight-digit alpha normalizes. PNG10MiB/output32MiB/encoding120s bounds.
  Existing binary32,129,114 bytes, gzip10,228,358 bytes; peak memory not measured.
- Actual Chromium151.0.7922.34 WASM proof PASS: 2,835ms warm local control render,
  217,181-byte MP4, verified play/seek/5s1080×1440; decoded first/final pixels inspected.
  Final RGB MAE2.36185/255 vs PNG, stable hold MAE0.000173/255; zero external requests.
- Checks PASS: motion3/3 units (added to native gate), TypeScript, lint (baseline
  warnings only), build, actual motion+editor route tests, SEO, Video Scissors16/16
  executed tests (1 optional nativeFFmpeg test skipped: binary unavailable).
- Initial browser assertion needed waiting one effect frame for video URL removal;
  corrected asynchronous test assertion, then PASS. Read-only npm sandbox EPERM
  retried with approved network; wrapper guessed tag URL404 resolved by upstream
  file listing, exact blob recorded. No auto-review denial or permission blocker.
- Artifact/receipt: `.deploy/visual-remix-motion/`. Requested/routed Astra MEDIUM;
  provider-observed identity/effort/usage/cost UNKNOWN. No original vision acceptance,
  live MCP, staging, commit/push/PR or production action. Independent review and
  native full submit gate subsequently passed before lead integration as #94.

## Version and staged vision harness preparation — frozen for review

- Native start `codex/tools-85-version-016` pulled fresh main to 326d7e6; unrelated
  BYOS remediation changes are preserved. Version changed with required
  `npm version patch --no-git-tag-version`: 0.1.5 → 0.1.6. Only package version and
  both root lockfile version fields changed; dependency graph remains identical.
- Ignored operator-stepped UI driver prepared under `.deploy/visual-remix-vision/`.
  It restricts network to exact immutable static origin, GET/HEAD without bodies,
  blocks service workers/WebSockets/MCP/OAuth/API paths, and never injects Scene
  or application/controller state. Apply and whole-file asset approval require
  explicit operator authorization. Proposals, downloaded artifacts, timestamps,
  hashes and redacted request metadata stay local and untracked.
- Local smoke only: driver opened current static build, read status, downloaded
  empty-project brief and closed successfully. No original/reference selected,
  no proposal/reconstruction, no staged URL visit or upload. Remaining driver
  actions are prepared from exercised app UI controls but not yet final acceptance.
- Final first-vision/reuse/long-CJK/synthetic and same-original-Scene MP4 proof must
  execute the immutable staged candidate after reviewed version integration.
  Independent version review and native submit gate pending; no commit/push,
  deployment, Worker/OAuth/MCP/network integration or acceptance claim here.

## Canonical V1 staging repair

- Top-level lead directly owns execution; earlier custom executor assignments are superseded.
- Version PR95 merged192d2c178eb4768f5d526969c9a5c83cb0583c92,v0.1.6. Reused existing PASS evidence; no repeated merge.
- Static staging run39942121566 checks PASS; deploy job FAILED before upload at Next TypeScript: shared Worker UI types could not resolve its nested OAuth dependency. No deployment/success tag was created.
- Root cause: the checks gate installs isolated Worker dependencies, but the separate staging job installed root only. Added the same locked, ignore-scripts nested install to staging and documented standalone local build prerequisite. No scopes, credentials, Worker runtime, version or production behavior changed.
- Evidence is the actual failed clean GitHub staging build; next verification is native required gates and repaired clean staging job. Independent read-only review pending.

## Offline Scene bridge preparation (#88, canonical lead-owned)

- Added an unrouted browser-side adapter over the real Scene controller: explicit field consent, finite project/generation lease, descriptor-only get, proposal/status/cancel, no Apply/export/network/OAuth capability.
- Reuses controller payload identity and revision fences; caps payloads at12KiB UTF-8 without altering existing16KiB HTTP limits. Actual wire-envelope verification and purpose-specific authentication remain future host work, not claimed by this adapter.
- Targeted seven-case synthetic controller tests PASS initially; final unused-asset privacy fixture extended before freeze. TypeScript/scoped ESLint PASS on initial snapshot. Native full gate and independent security review pending.
- Corrected static deployment ccb6f7e/v0.1.6 is verified at immutable Pages URL, receipt/tree/config/online identity PASS. Original image drove a14-layer staged Scene preview; one orphan-punctuation iteration fixed at unchanged39px.
- Staged original Apply/download was denied by automatic approval review as lacking separate Apply approval after the Agent's preview-only instruction. Known unexecuted; read-only DOM confirms revision0 with candidate available. Explicit narrow user approval pending; no retry/workaround. Real Apply/PNG/reuse/motion journey remains NOT RUN.
- Independent Sol review VR-BRIDGE-1 found consent could straddle a pending same-ID import. Lead repair exposes loading, rejects transitional shares and rotates authority again on successful commit. A held-render regression checks old, transitional and fresh settled consent; affected checks and exact rereview follow.


## Approved inactive Scene candidate continuation

Founder approved proceeding with inactive Scene MCP auth/storage preparation and
independent security review. Canonical V1 lead executes directly; Sol reviews;
Astra remains conditional consulting only. Active auth/scopes/storage expansion
and live MCP still need exact action-time approval; no production/Master closure.

First slice adds descriptor-only protocol and separate inactive Scene store/SQL
outside normal migrations. No active entrypoint, video scope/counter or deployment
config changes. Four local Miniflare/D1 regressions plus one schema/envelope case PASS; fixture
egress is denied;
Worker/root TypeScript and scoped lint PASS. Local loopback sandbox EPERM was
retried through the authorized native executor. Exact independent review and
native full gates follow. Prior real-image staging evidence/timing is preserved.

Independent Sol review VR-SCENE-STORE-1 found applied ACK retries were wrongly
rechecked against later snapshots. Lead repair preserves exact terminal retry
idempotence while retaining live owner/lease checks; regression covers a later
local revision, wrong credential and wrong epoch. Exact rereview follows.


PR98 merged d1fed61541ed5407cd87a03a034d2a9df62d6052 at15:16:25Z after exact Sol
rereview, native gates and GitHub39975180876 PASS. New native fresh-main branch
codex/tools-88-inactive-scene-oauth prepares shared-issuer/two-resource auth,
reviewed consent renderer and bounded four-tool/browser routes. Active index/config
and migration path remain unchanged. Three disconnected actual provider/SDK/D1/KV
scenarios PASS, including simulated pre-resource video compatibility and same-user
resource isolation. One ordinary async-catch repair plus empty-401 fixture parser
repair retained. No live MCP traffic or activation. Independent review/native gate
pending. UI browser transport remains a subsequent slice.


Independent Sol auth review initially PASS at9a329b8. Supplemental lead-raised
escaped-ID estimate mismatch confirmed P3 read availability only, not mutation
ACK loss. Repair uses safe-ASCII1–96 string ids (safe integers retained) matching
pre-admission envelope reserve; real SDK regressions reject escaped/empty ids
without request admission and retain96ASCII/safe-integer positive cases. Exact
repair checks/rereview follow before merge.


PR99 merged4dd9f51fdf5cc3aadc149b4a143235b8bd22250c at15:36:26Z. Repaired
headf109fbf exact Sol rereview/post-hook hashes, native update/merge gates and
GitHub39979269673 PASS. Native submit update had exit1 only because existingPR99
already existed after successful gate/commit/push; native merge subsequently
PASS. No active entrypoint/config or migration/traffic changed.

Fresh native browser branch prepares default-off generated panel/adapter. Five
actual-controller/mocked-HTTP lifecycle cases PASS, shared3auth regressionsPASS,
and actual local provider/SDK/D1/controller integrationPASS6.36s (renderer stub,
not PNG QA). Worker/root types and scopedlintPASS. Explicit connected local UI
buildPASS. Full Chromium check initially stopped in fixture setup due to caller
relative esbuild path; helper now uses explicit source/migration paths and the
affected check is running. No live MCP or original image upload.


Inactive browser continuation checks: transport5/mockHTTP+actualcontrollerPASS;
auth3actualprovider scenariosPASS; integration1actualprovider/SDK/D1/controller
PASS (renderer stub). Connected build and actual Next/React/Konva browser journey
PASS after two proven header repairs: Referrer-Policy same-origin preserves real
Origin; remove only new form-action directive to permit official callback. One
conditional read-only AstraHIGH consultation for the redirect blocker, no routine
Astra review. Exact advice/failed-baseline receipts retained. Principal also found
Playwright redirects may skip user routing, so old interception cannot prove no
browser egress. Final fixture uses deny-by-default proxy + real loopback callback;
only exact callback forwards, source image never loaded/uploaded. BrowserPNG and
desktop/mobile pixels inspected. SceneDeny/candidatevideo/disabledvideo real-browser
callbacksPASS. Reload/reopenedScene yields identicalPNG; revokepurgespayload and
oldtoken401; no autoconnect. One redirected rootHEAD failure retained, not hidden.
All disposable resources closed. Normal deployment/index/migrations unchanged.

Existing Worker control-plane GET settings/deployments read15:55:54Z identifies
version77713e9d-d74b-46c6-8fc4-303310525fe8, existingDB/KV/assets and noSceneflag.
No Worker/MCP endpoint invoked. Current usage/recentrequests/cumulativecounters and
reportinglagUNKNOWN. Specific activation/access/live-MCP approval remains pending.
Independent Sol review/native PR follows; Master85/87/88 remainopen. Original
reference28m04.708s and reuse34.426s findings unchanged, no freshvisionbenchmark.

Independent browser review found P2 VR-SCENE-BROWSER-1: revoked/expired Scene bindings returned a bare 401. Repaired using the official resource-server validator: reject a non-live D1 binding before handler dispatch, preserving the canonical Bearer invalid_token, resource_metadata and exact Scene scope challenge. Added actual provider revoked/expired and wrong-audience challenge assertions; data operations retain their D1 fences. Rereview and the repaired native gate remain pending at this checkpoint. Native submit previously passed its full gate but the commit hook rejected a new helper blank EOF; no commit/push/PR occurred, and the whitespace was repaired.

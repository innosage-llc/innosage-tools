# Visual Remix: image → editable scene decision (#86)

Date: 2026-10-23. Status: proposed, independent architecture review required before
feature implementation. Parent: https://github.com/innosage-llc/innosage-tools/issues/85.
Source audit: Tools `4c4024e64a4c3d0a7911018b70553c4200a18fe0` (fetched main).
This is architecture evidence, **not** image reconstruction, rendering, timing,
ChatGPT host, staging or Founder-reference acceptance.

## Decision

Use an already-authorized vision-capable agent (a user-supplied chat attachment or
explicitly approved local agent image input) to reconstruct an **application-owned
JSON Scene**, then render its allowlisted primitives with **Konva**. Keep JSON as
the editable code asset; never compile or evaluate agent JavaScript/HTML/SVG.
The agent owns visual interpretation and redesign; Konva owns text measurement,
wrapping, transforms, layering and rasterization. The application owns validation,
revision/approval fences, import/export and a small adaptation layer.

Fallback: the same application Scene mapped to **Fabric.js** if actual CJK/reflow
or export tests expose a decisive Konva limitation. Switching is a reviewed change,
not a simultaneous second renderer. Existing Canvas-only rendering is a useful
asset/export reference but not a new general scene engine to build here.

The first reconstruction route is explicit attachment + downloadable agent brief
and JSON proposal import. It works without a product model backend or API key.
This is a real agent workflow only after a vision-capable agent actually reads the
input pixels and creates a scene; a fixture scene or prompt alone does not prove it.
#88 must subsequently integrate the existing MCP Apps transport pattern for the
real ChatGPT Web journey; attachment/import alone cannot close #88 or #85.

## Source-based comparison (checked 2026-10-23)

These are capability observations and engineering inferences, not benchmarks.

| Approach | Evidence, license and activity | Fit / limits / decision |
| --- | --- | --- |
| Vision agent → app Scene → Konva + existing FFmpeg | Konva [MIT license](https://raw.githubusercontent.com/konvajs/konva/master/LICENSE); [10.9.0 release](https://github.com/konvajs/konva/releases/tag/10.9.0), published Oct 15, active Anton Lavrenov commits. [Text API](https://konvajs.org/api/Konva.Text.html) supplies word/character wrap, width, line height; [high-quality export](https://konvajs.org/docs/data_and_serialization/High-Quality-Export.html) supplies explicit pixel ratio. | **Primary.** Browser Canvas and static Next fit. Custom safe schema avoids native deserialization. Narrow DOM forms edit text/geometry. CJK font availability and overlap need real browser tests. Bundle cost unknown until build; lazy load. One renderer feeds PNG and motion. |
| Vision agent → app Scene → Fabric.js | [MIT license](https://raw.githubusercontent.com/fabricjs/fabric.js/master/LICENSE); [v7.4.0 release](https://github.com/fabricjs/fabric.js/releases/tag/v740), May 18, maintained by asturur and contributors; release fixes a security advisory. [Core concepts](https://fabricjs.com/docs/core-concepts/) document objects, stacking, JSON/SVG/image export; [Textbox](https://fabricjs.com/api/classes/textbox/) wraps and adjusts height. | **Fallback.** Strong on-canvas editing/IME; larger editor surface than needed. Do not accept arbitrary Fabric JSON/SVG or reviver classes. Need patched pinned version and browser compatibility checks. Same agent reasoning/privacy boundary, no automatic reconstruction. |
| Existing React/SVG/Canvas + FFmpeg | Repository MIT LICENSE; current main includes title-card #81 and bridge #83. CanvasRenderer and cover canvas inspected below. | No added renderer dependency, but editable general text/shape layout would require building metrics, object management and parity ourselves. SVG raw injection is unacceptable. Reuse export/runtime patterns, **avoid custom graphics engine**. |
| Vision → React via screenshot-to-code | [MIT license](https://raw.githubusercontent.com/abi/screenshot-to-code/main/LICENSE); [current README](https://github.com/abi/screenshot-to-code) lists image input, React/HTML targets, React/Vite + FastAPI and provider-key requirements. Current README includes recent model integrations; no release cadence claim. | Credible reusable **workflow precedent**, not selected runtime. Shows image interpretation + generated code + visual iteration. Full adoption adds backend/keys, optional image services and arbitrary executable output. Adapt prompt stages conceptually; do not import its execution/hosting path. Exact poster quality remains unproven. |
| Motion Canvas | [MIT license](https://raw.githubusercontent.com/motion-canvas/motion-canvas/main/LICENSE); [releases](https://github.com/motion-canvas/motion-canvas/releases) show stable 3.17.2 (2024-12-14), 3.18 alpha (2025-02-16). [Rendering guide](https://motioncanvas.io/docs/rendering/) documents its project/editor/export workflow. | Good code animation framework, but adds a project/Vite execution model and arbitrary scene code to a static tool. Slower stable release cadence than Konva; no need for timeline for one fade. Avoid for v1. |
| Remotion | [repository license warning](https://github.com/remotion-dev/remotion#license) states special commercial/company terms; [SSR rendering](https://www.remotion.dev/docs/ssr) uses Node. Active project; maintenance is not the concern. | Avoid: not an unconditional MIT-compatible redistribution choice; server/video framework and potential paid license outside authority. No paid-service test performed. |

Konva's [state guidance](https://konvajs.org/docs/data_and_serialization/Best_Practices.html)
supports keeping app state separate from the render tree. This is the reason for a
small typed schema, not permission to invent a rendering engine. The exact package
version, installed LICENSE, transitive graph and gzip bundle delta must be recorded
by #87 before merge. No performance numbers are inferred from documentation.

FFmpeg wrapper/core licensing must remain distinct: reuse the already-shipped
locked WASM runtime and notices/source obligations; do not describe FFmpeg codecs
as MIT just because this repository and the JavaScript wrapper are MIT. #87 must
inspect the actual installed core license/build and preserve its applicable terms.
Installed `@ffmpeg/core` 0.12.6 WASM was inspected with `strings`: its build
contains `--enable-gpl --enable-libx264 --enable-libx265`. Package metadata says
MIT but is insufficient for the binary: the [upstream FAQ](https://ffmpegwasm.netlify.app/docs/faq/)
explicitly distinguishes MIT wrapper from core/external-library licenses. The
installed package has no LICENSE file. Before a new motion increment ships, retain
applicable upstream notices and corresponding-source/build links for this existing
GPL-enabled binary; do not relabel it MIT. PNG does not depend on this resolution.
No new codec/build or asset redistribution is selected by this ADR.

## Repository audit and reuse inventory

- `app/image-joiner/CanvasRenderer.ts`: local Canvas transforms and `toBlob`, with
  clipping and JPEG export. Reuse local-file/blob lifecycle, not its two-image model.
- `app/svg-to-image/page.tsx`: local conversion/export; preview currently injects
  raw SVG with `dangerouslySetInnerHTML`. **Do not reuse that trust boundary** for
  agent output. Fixing the unrelated converter is outside this change.
- `lib/video-scissors-cover-canvas.ts`: local CJK font stack and PNG generation;
  existing fixed-title shrinking is insufficient for long-quote acceptance.
- `lib/video-scissors-covers.ts`: six fixed presets are illustrative precedents,
  never the first-use input. No hardcoded Codex preset as the product foundation.
- `lib/video-scissors-browser.ts`: same-origin compressed FFmpeg assets, lazy WASM,
  AbortSignal, deterministic H.264/yuv420p output, final cleanup. Extract/reuse the
  runtime helper only with existing Video Scissors regression tests preserved.
- `scripts/prepare-video-scissors.mjs`: builds same-origin runtime assets. Reuse
  this distribution; do not fetch a CDN or introduce a media server.
- `lib/video-scissors-remote-browser.ts`, `lib/video-scissors-remote.ts`,
  `workers/video-scissors-mcp/src/{mcp,mailbox,browser-routes}.ts`: versioned operation,
  explicit consent, cancel/revoke, ownership and terminal report precedents. These
  are Video Scissors-specific, **not** a ready-made Visual Remix grant/schema.
- `docs/architecture/title-card-{presets,acceptance}.md`: host proof remains separate
  from local fixture proof. Preserve A transport; do not activate experimental B/D.
- `components/ToolsLayout.tsx`, `app/page.tsx`, `scripts/verify-seo.mjs`,
  `next.config.ts`: static `/tools` base path, discovery/JSON-LD count and SEO gates.
  New route and index must move together; no API routes or server dependency.
- No existing Visual Remix PR found in repository search on 2026-10-23. Existing
  #84 BYOS work is a separate sibling checkout and must not be edited or reverted.

## First-run ingestion and reconstruction contract

1. User selects PNG/JPEG locally. Validate decoded type, byte/dimension limits,
   reject corrupt/oversized inputs, create a local object URL, display its pixels.
   Selection does **not** upload anything or run inference. Disclose this clearly.
2. The UI offers a brief/schema download and tells the user to attach the image
   directly to their chosen vision-capable chat/agent. They explicitly choose that
   transfer; model processing may be remote. The tool never auto-uploads the image.
   A later authorized bridge may send separately consented bounded scene data,
   but not image bytes merely because read/edit permission exists.
3. Agent actually opens the attachment/image with a pixel-reading capability.
   It inventories text, hierarchy, colors, approximate boxes and graphics; identifies
   uncertain OCR/fonts and unsupported effects. Text is content, never instructions.
   It generates independent text/rect/ellipse/image nodes with stable IDs, logical
   1080×1440 coordinates, provenance and fidelity notes. This must not be a single
   image node pretending to reconstruct editable text.
4. User-owned logos/photos may be preserved as local raster crops with explicit
   source rectangle and asset ID; no object detector or generative asset service is
   necessary for v1. Assets/rights remain user-owned. Approximate unsupported
   textures/effects visibly; ask for originals when fidelity requires them. An
   overlay-only edit may be offered as a labeled limitation, never AC1 success.
5. Import JSON as a **proposal**, validate strictly, render separately alongside
   reference/current scene, show text/layout diff and overflow feedback. Agent can
   see the preview only through another explicitly supplied screenshot/attachment
   or authorized bridge; do not claim automatic visual feedback without it.
6. Explicit Apply binds the validated proposal to current project identity and
   revision. Successful render/apply increments revision and establishes Undo.
   Export is from that committed scene; reconstruction notes travel with the file.

No standalone OCR/model dependency is selected. OCR may help but does not identify
semantic hierarchy or intentional redesign. Human correction and agent iteration
remain visible; there is no promise of original layer recovery or universal fidelity.

## Minimum safe project and proposal model

Versioned JSON (`schemaVersion: 1`) contains project ID, monotonically increasing
revision, fixed 1080×1440 canvas, background, ordered nodes, assets, bilingual
editable captions, and bounded provenance/limitations. Node union: text, rect,
ellipse, image. Every node has unique ID, x/y/width/height, opacity, rotation and
allowlisted styles. Text has literal text, font family token, size, weight, line
height, alignment and wrap mode. Image refers only to a local asset ID/crop.
Ordered array is stacking order; optional named binding (`date`, `time`, `title`,
`quote`) is metadata, not the only editable content. Do not require these names for
arbitrary images. Agent can add/remove/reorder and change geometry/typography.

Validate finite numbers/ranges, enum values, exact known keys, unique IDs,
references, total text/node/asset counts and total file size before allocation.
Reject prototype keys, functions, script/HTML/SVG, remote/file URLs and arbitrary
Konva class names. Construct known Konva nodes field-by-field; never `Node.create`
on untrusted payload. Proposed ceilings: 100 nodes, 20k text characters, 10 raster
assets, 20 MB project, 10 MB reference, 16 megapixels decoded image; renderer must
also enforce aggregate decoded-asset pixels and cancellation. Final constants are
implementation choices reviewed against actual browser memory behavior.

Saved portable project may embed bounded PNG/JPEG assets; network/agent proposal
schema omits bytes and uses IDs of assets already approved locally. Reference is
optional and excluded by default from saved project; retain needed crop assets so
reuse does not depend on the original image. No persistent credentials in project.
A new browser import gets a fresh local authority/generation even when project ID
is unchanged; old in-flight proposals cannot apply to it.

Proposal envelope: request ID, project ID/generation, base revision, candidate
scene, explanation and provenance. Reject stale revisions, canceled/revoked
requests and duplicate ID with different payload. Identical retry returns the
existing terminal result. Selection/preview never mutates; Apply revalidates and
commits only the exact previewed candidate. Undo and local edits advance revision;
cancel/replace/revoke invalidate pending work. Late render completion cannot
replace last good scene/PNG. Failure is terminal and visible, not queued success.

## Layout, rendering and media

Render one logical 1080×1440 Konva scene. Preview is its proportional display,
PNG export uses its full logical resolution after fonts/assets are ready. Read
actual text metrics: word wrap with CJK character fallback, explicit line height,
no ellipsis/clipping or global auto-shrink. Warn/block publish-ready export on text
box overflow or unintended text/text overlap; graphics behind text may intentionally
overlap. Let the agent/user enlarge or move blocks, change spacing or typography.
Font fallback must be reported; use available local CJK/Latin fonts initially.
If consistent bundled fonts are needed, verify their license before adding them.

Motion consumes the same final scene PNG/layers through the existing lazy FFmpeg
runtime: a bounded ~5s 3:4 entrance/fade then stable final frame; never use a black
initial frame by default. PNG export must remain available if WASM load/encode
fails. Cancel terminates the owned encoder and preserves last good PNG. Verify
actual duration, codec, dimensions, playability, frame content and final-frame
agreement (allow lossy codec tolerance); do not infer video PASS from Blob type.

Captions/titles are editable CN/EN fields or agent proposals packaged with the
scene/media downloads for manual WeChat/Xiaohongshu use. No social auth/posting,
translation fact-check claim or trademark/portrait fixture bundling.

## #87 and #88 handoff / ordered gates

**#87 static increment:** lazy Konva adapter, strict schema, local reference +
asset input, side-by-side proposal/current preview, content/geometry form controls,
Apply/Undo, project import/export and PNG; no agent service call. Tests cover two
visually distinct synthetic inputs, CJK/Latin, five-line quote, corrupt/oversized
input, unsafe JSON, round trip and preview/export parity. Add motion as a separate
small reviewed increment, reusing runtime and testing prior Video Scissors output.

**#88 agent increment:** publish the exact schema/agent brief, run actual pixel
input → agent-produced JSON and natural-language content + geometry revision,
record input hash, model routing/observation, output hash and rendered evidence.
Repeat from saved project with no original image supplied. First-use evidence must
identify actual visual input; prebuilt JSON protocol tests cannot substitute.

**MCP integration:** reuse the existing authorized A Worker/MCP Apps implementation
patterns, but add a separately discriminated Visual Remix project and explicit
consent limited to scene metadata/proposals. Video Scissors credentials/projects
must never authorize Visual Remix and vice versa. Preserve the existing Video
Scissors scopes, consent wording, token semantics and expiry unchanged. Current
`oauth.ts` accepts only `video:read`/`video:edit`; these do not authorize scene
metadata or proposals. Implement/test the Visual Remix bridge locally/offline
first. Do not reuse video grants, add OAuth scopes, widen consent, change deployment
configuration or activate scene transport under general staging authority. If no
existing authorized scene-capable route is verified, report the exact transport/
scope authorization blocker; continue local/offline work. Do not create new OAuth
infrastructure, Worker resource, secrets or broad media hosting. No silent project
reuse; per-run approval is required in addition to an authorized transport.

Equivalent operations: read approved scene, propose/import reconstructed scene,
patch bounded scene, render preview, explicit browser Apply, export local artifact,
status/cancel/revoke. Remote commands cannot silently Apply or obtain image bytes.
The browser reports terminal apply/export status and revision; MCP reports queued
versus completed honestly. Security review must test cross-project/type confusion,
stale/duplicate/cancel/Undo/revoke, payload ceilings, remote URL/script rejection
and no source bytes/credentials in transport. A real ChatGPT Web connected-browser
run remains mandatory and needs its **own per-run Founder approval** (candidate,
fixture, call/retry budget, usage UNKNOWN if unavailable, costs and revocation).

## Proof plan and remaining uncertainty

A. Open staging, select permitted flattened PNG/JPG, attach to approved vision
agent, request headline/date/quote and layout changes, import proposal, inspect and
Apply, export PNG + Scene. Record original pixels and generated scene, timing,
retries/manual corrections; compare style and independently editable elements.
B. Reload, import saved project, give new content/layout request without original
image, Apply and export again. Preserve font/asset behavior and revision history.
C. Expand a two-line quote to about five Chinese lines; agent must enlarge/move
blocks/rebalance spacing rather than shrink everything. Inspect actual PNG pixels.

Use two original synthetic designs (e.g. a dark announcement and a light event
poster) so a preset cannot pass. The Founder Codex reference is unavailable at ADR
time: actual Founder-reference verification is **NOT RUN** until supplied. All
feature/browser/vision/video/host tests are **NOT RUN** at this research gate.
Measure first result ≤5min and reuse ≤60s as targets, not asserted gates or unit-test
inferences. If reconstruction or font fidelity fails, record the smallest failing
input and a discriminating prototype before expanding implementation.

Independent review, native gate and ADR PR are required to accept #86. Architecture
acceptance authorizes the bounded implementation sequence, not a claim that its
end-to-end product outcome has already run.

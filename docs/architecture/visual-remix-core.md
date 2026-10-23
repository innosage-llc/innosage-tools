# Visual Remix core contract (#87 / #88)

This increment implements local data, asset, approval and rendering primitives.
It adds no public route, model call, upload, motion export or MCP transport.
The accepted [ADR](visual-remix.md) remains the product and authority boundary.

## Data and local use

`lib/visual-remix.ts` is the authoritative TypeScript union and runtime validator.
All keys are required and exact. IDs use 1–96 ASCII letters/digits/underscore/hyphen.
Colors are six/eight digit hex. Canvas is always 1080×1440. Array order is stacking.
Text/rect/ellipse/image nodes support position, dimensions, rotation and opacity;
text supports literal content, named local font stacks, size/weight/wrap/alignment.
Rect supports corner radius; raster image nodes require an approved asset and crop.
No native Konva JSON, HTML/SVG, arbitrary class, remote URL or program is accepted.

Scene contains `canvas`, `background`, `nodes`, `assets`, `captions`, `provenance`,
`limitations`. Asset descriptors contain `id`, `mime`, `width`, `height`; no bytes.
Captions contain `titleCN`, `captionCN`, `titleEN`, `captionEN`. No translation or
source fact verification is implied. Named bindings are not needed to edit text.

Proposal contains `schemaVersion: 1`, `requestId`, `projectId`, `generation`,
`baseRevision`, `scene`, `explanation`. Obtain identity/revision from controller
snapshot. `importProposal` enforces the JSON byte ceiling before parsing. Pass the
result to `propose`; separately display its preview, explanation and diagnostics.
Only a distinct user approval calls `apply(requestId)`. Local form changes use
this same proposal path. UI must not describe a queued/rendering proposal as done.

Project contains `schemaVersion: 1`, `projectId`, `revision`, `scene`, and an
`assets` array of `{id, data}` with strict PNG/JPEG base64 data URLs. Use
`loadPortableProject`, not `importProject` alone, to decode and verify every raster
before `controller.open`. Use `savePortableProject` to retain cropped/local assets
without retaining the original reference. Input reference selection uses a
separate `LocalAssets` store and does not automatically insert it into the scene.
There is no persistence or upload implicit in selection, rendering or project save.

## Bounds and lifecycle

Limits: 100 nodes, 20,000 total text/caption/provenance characters, 10 assets,
20 MB portable JSON, 250 KB proposal JSON, 10 MB per raster, 16 megapixels per
raster, 32 megapixels aggregate per asset store and scene. PNG/JPEG dimensions
are read before decoding, then checked against actual decoder output. Concurrent
asset decodes reserve pixel slots; renderer jobs are serialized across controllers
because browser decode cannot be aborted mid-call. Each render holds at most
32 megapixels of assets, releases every bitmap, and checks cancellation before
and after async work. Asset import can coexist with rendering, so these are
separate bounded budgets, not a claim about total browser memory usage.

Controller keeps committed output, one Undo state, and a separate candidate.
Caller inputs and snapshots are copied. Apply binds exact privately retained
candidate, project ID, fresh local generation, base revision and rendered output.
Apply and Undo advance revision; import always changes generation even for the
same project ID/revision. Failed/canceled/late renders cannot replace the current
PNG. Revoke aborts and invalidates an active project load as well as pending proposals,
preserving the last committed scene/PNG even if a decoder resolves late. It changes
generation; it is purely local,
not a server revoke or permission grant. Receipts retain terminal status for up
to 256 request IDs per open project; identical retry returns current receipt
status, conflicting payload rejects. Reopen creates new authority rather than
evicting tombstones. Terminal receipts release obsolete raster outputs.

## Renderer and evidence

Konva **10.9.0**, exact lock, installed MIT license inspected. No runtime
dependencies; optional Node canvas/skia peers are not installed or used. Dynamic
import keeps the browser library separate. This core is not yet imported by a
public route, so feature route bundle impact must be measured in the UI increment.

The same 1080×1440 PNG Blob is previewed and exported after Apply. Konva measures
actual wrapped text using auto height; fixed boxes do not clip/ellipsis/shrink.
Overflow, rotated out-of-canvas bounds and text/text bounds overlap block export.
Konva can silently omit a paragraph tail when its next grapheme does not fit the
width. The adapter compares laid-out non-whitespace content with the complete
input, blocks export if content was omitted, and reports the widest grapheme using
the active Konva font's actual measurements. A font-size/box-width heuristic is
not used: narrow Latin characters can legitimately fit a box smaller than the font
size. Wrapping may trim line-boundary whitespace without losing visible content.
Overlap is conservative bounding-box detection, not an ink-perfect intersection
test; graphics behind text are allowed. Font diagnostics disclose the local stack
and possible device fallback; they do not assert installed glyph provenance.

`npm run test:visual-remix` tests unsafe data, raster budgets, portable reuse and
stale/replay/cancel/revoke/import/Undo behavior. It is in native gatekeeper.
`npm run test:visual-remix-render` starts a loopback-only browser harness and
requires installed Playwright Chromium. It tests actual CJK wrapping, overflow,
collision, rotation, portable raster decode, preview/export byte equality and
canceled-render allocation serialization. Evidence goes to ignored
`.deploy/visual-remix-core/`. This is renderer evidence, not agent reconstruction,
public UI, original-reference, motion or ChatGPT Web/MCP acceptance.

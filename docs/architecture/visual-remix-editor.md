# Visual Remix local editor

The `/tools/visual-remix` route exposes the local core described in
[visual-remix-core.md](visual-remix-core.md). It begins with an empty scene, not a
poster template. No inference service or remote asset fetch runs in the editor.

## Workflow and approval

Choose a local PNG/JPG reference to view beside the scene. Reference selection does
not authorize its use as a scene asset. Separately approve local PNG/JPG assets to
receive bounded raster descriptors and IDs. The downloadable agent brief contains
the current scene, proposal identity, JSON schema, user request and approved
asset descriptors. It contains no reference bytes, asset bytes, local paths or
credentials. A user may explicitly attach the reference to their chosen external
agent; that agent's processing is outside the local editor.

Import the agent's JSON proposal to render a separate candidate. The applied PNG
and revision remain unchanged until Apply. Review the candidate, diagnostics and
content/layout/order/caption differences before applying. Cancel discards a
candidate; Undo restores the preceding committed content at a new revision.
Revoke cancels pending work and rotates approval identity. Download a fresh brief
after revocation or project replacement; old proposals fail closed.

Layer controls edit text, fills, geometry, opacity, stacking and typography. CN/EN
captions use the same preview/Apply flow. Raster crop rectangles can be supplied
in validated proposal JSON. No crop-selection UI or automatic image analysis is
implied. Empty/invalid scenes cannot export PNG. Text diagnostics block export
when content cannot fit; the editor does not silently shrink text.

Save project derives used assets from image-node references at the serialization
boundary and excludes unused descriptors and bytes, even when an agent proposal
includes them. It leaves the approved local store and Undo history unchanged.
For each referenced asset, the entire approved PNG/JPG file is embedded, including
pixels outside any crop, along with validated scene data.
Opening it restores assets without the reference and creates fresh approval
identity. Treat this local file as containing the images and text you selected.
The PNG download uses the exact committed preview Blob; caption JSON is separate.
Fonts depend on the device's available fonts, so cross-device typography can vary.

## Verification and evidence boundaries

`npm run test:visual-remix-editor` exercises the actual exported route in Chromium
through a loopback static server. It covers a PNG reference and real JPEG approved
asset, portable reload, descriptor-only brief, proposal preview/Apply, PNG byte
parity, content/geometry/caption edits, Undo/Cancel/revoke, stale proposals, delayed
project-read revocation, invalid export blocking and a 390px mobile viewport.
The browser records requests and rejects external traffic or request bodies.
Artifacts and the exact source receipt are in ignored `.deploy/visual-remix-editor/`.

The route test uses a preauthored control scene. It proves UI workflow, not actual
vision reconstruction or timed first-use/reuse acceptance. Original reference
bytes stay outside the repository. A distinct original flattened geometric poster
was supplied to the lead for subsequent independent vision work. No live MCP,
remote model integration or deployment is part of the editor increment. Local
motion was added subsequently; see [visual-remix-motion.md](visual-remix-motion.md).

## Bundle measurement

The production route's initial script tags add 57,959 raw / 19,784 gzip bytes
relative to the index page's initial tags. The dynamic Konva chunk is 190,548 raw /
57,032 gzip bytes; it is absent both pages' initial HTML and was not fetched by
the index during the test. It loads when the editor initializes its first local
render. Next navigation prefetch may fetch editor chunks from the index after
hydration. These are observed chunk measurements, not a before/after build delta.

## Third-party attribution

Konva 10.9.0 is distributed under MIT. `public/third-party-notices/konva-LICENSE.txt`
is a byte-for-byte copy of the installed package license, including both original
and modified-work copyright notices and complete terms. The editor links to the
exported `/tools/third-party-notices/konva-LICENSE.txt` notice. Preserve this file
and verify it against the package license when updating Konva.


### Consented reference detail extraction

The local crop UI materializes a tight PNG from the selected reference rectangle.
Preview is not approval; approval renders a placement candidate, and only explicit
Apply inserts that image node into the current Scene. Its used descriptor can
then cross MCP. This preserves the existing used-assets-only remote boundary;
no raster bytes cross. Apply all needed crops before downloading a fresh brief
and connecting. Identity portraits/logos should reuse original approved pixels,
not generated faces/marks. Saved projects embed only the materialized crop for
this flow; separately uploaded assets still embed their entire approved file.
Image nodes retain editable geometry/crop, not vector editing of their pixels.

Text collision diagnostics use per-line actual font glyph bounds with Konva's
baseline/alignment and rotation, not the full declared editable box width. Line
bounds remain conservative for rotated or interlocking glyphs; visual review is
still required. Genuine overlap, omitted text, overflow and canvas bounds remain
blocking. Preview/export still use the same PNG and browser-local font stacks.


### 2026-10-25 local live-edit amendment

Local parameter controls now debounce for250ms, render and commit automatically.
The old local Preview edits/Apply step is superseded. Remote/imported proposals
still render as separate candidates with explicit Apply; this grants no remote
auto-apply authority. A local edit immediately invalidates pending proposals,
uses a controller ticket bound to generation/revision and fences late renders.
Pending or invalid drafts retain the last committed Scene but pause downloads;
correct values or Discard local draft to recover. Genuine layout errors remain
export-blocking after local commit. Save project persists the applied Scene.

Undo retains at most20 committed checkpoints. Local commits within750ms coalesce
as a typing burst; remote Apply/import/Undo/revoke end that grouping. Undo advances
revision and cannot revive an old proposal. Local changes cancel obsolete motion
work and invalidate old downloads. No additional renderer, transport or new API.
## Reference sharing amendment (2026-10-25)

Founder explicitly requested app-uploaded reference pixels be readable by the
connected GPT without attaching the image again. This supersedes earlier
descriptor-only sharing **only for a fresh, image-specific opt-in**. Local-only
uploads and old field-only consent are not upgraded. Local parameter edits apply
automatically; remote proposals remain candidate previews with one browser Apply.

`NEXT_PUBLIC_SCENE_REFERENCE=true` and `SCENE_REFERENCE_ENABLED=true` gate the
candidate client and server respectively; both default off. The separately
reviewed `candidate-migrations/scene-reference.sql` adds one private D1 row per
share to the existing database. No new service, scopes, credentials or public
image URL are introduced. Current exact OAuth audience/scopes/PKCE/manual grant,
15-minute nonrenewable lease, generation/epoch, owner credential, freshness,
revision, revocation and request/storage bounds remain required.

The browser validates the local PNG/JPEG, then only after fresh pixel consent
re-encodes a PNG derivative (≤1MiB, ≤2048 longest edge). Original bytes remain
local. Manifest hashes/dimensions and separate crop-reuse permission are bound
atomically when creating the share, before host consent. Pixel upload occurs
only after the existing OAuth lease has been paired. The exact same-origin owner
upload route has a1.5MB envelope; every ordinary Scene/RPC request retains16KiB
and descriptor payload12KiB. SHA, PNG CRC/chunks, dimensions, bounded deflate and
filter checks run before writing. Upload is immutable and same-byte idempotent;
the database write rechecks live owner/lease/epoch after validation.

`read_shared_reference` returns native MCP `content: [{type:"text",…},
{type:"image",data:<base64>,mimeType:"image/png"}]`. Only this exact tool response
gets the larger envelope. It requires current OAuth binding, per-share image
consent, stored bytes, unexpired lease and fresh browser heartbeat. No caller URL
or arbitrary image ID is accepted. Repeated first-image reads are supported;
subsequent editable Scene reuse needs no reference read. A valid image block and
decoded matching SHA establish byte delivery, **not host semantic vision**.
ChatGPT must identify actual image details not supplied in text before that
criterion passes.

Optional, separately unchecked crop permission lets the agent use a virtual
original-dimension source descriptor for integer photo/logo crop geometry. The
service normalizes proposals to deterministic tight-crop IDs before hashing and
admitting them. The browser materializes only those crop pixels with its retained
original, then renders the candidate. Full-source raster substitution is rejected.
Candidate Apply commits editable text/shapes/layout and the previewed crops once;
portable saving embeds only image assets used by the committed Scene. Reopen and
later content/layout edits therefore preserve actual photo/logo pixels without
the original or another image analysis. Image generation is not an identity fix.

Revoke denies reads and deletes the active image row in the same database update;
expiry immediately denies access and a lazy sweep deletes the row. Physical
deletion on a timer is not promised. Cloudflare Free D1 Time Travel can retain
backups for7days, and already delivered ChatGPT conversation content cannot be
retracted. Both browser and OAuth consent pages disclose this retention boundary.
No agent live MCP test is authorized by implementation or staging deployment.

Evidence sources: [MCP native image content](https://modelcontextprotocol.io/specification/2025-03-26/server/tools#image-content),
[OpenAI model-visible tool content](https://developers.openai.com/plugins/reference#tool-results),
[D1 row and Free limits](https://developers.cloudflare.com/d1/platform/limits/),
[D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/).
The1MiB/2048 bounds are our engineering choices, not published ChatGPT limits.
Actual ChatGPT image interpretation, image-size support, staging CPU and current
free-plan headroom require explicit evidence; local controls do not prove them.

Local checks: `npm run test:visual-remix-reference` (actual disposable provider,
native SDK, byte integrity and negative paths), `npm run test:visual-remix-transport`
(delayed upload, cancellation and prior transport regressions), and
`node --experimental-strip-types --test test/scene-reference-browser.test.ts`
from the Worker folder after building the app with both reference/remote flags,
and setting `VISUAL_REMIX_REFERENCE_PATH` and `VISUAL_REMIX_SCENE_PATH` to the
authorized local supplied PNG and historical editable Scene. Without those
explicit private fixtures the test is SKIPPED, never a claimed PASS.
The last check uses the actual supplied PNG and a historical editable fixture;
it does not claim fresh agent reconstruction or real ChatGPT success.

## Direct canvas editing (#140)

The applied PNG remains the exact committed/exported Konva Blob. A lightweight
SVG overlay hit-tests Scene nodes in reverse stacking order and displays rotated
selection/resize bounds. It does not render another typography engine. Drag and
resize show transient bounds; pointer movement never decodes assets or invokes
`renderScene`. A changed gesture stages the controller export/remote-candidate
fence and commits once with its own history ID. Selection alone preserves pending
remote candidates. Pointer cancellation and Escape discard the transient edit.

Fit preserves the 3:4 canvas ratio; 100% presents a scrollable 1080×1440 surface.
Resize changes box geometry, keeping text font size and image/crop descriptors
intact. The existing renderer reflows and validates text after commit. Center X/Y
uses rotated geometry, subject to existing schema bounds. The Layer selector and
advanced numeric controls remain available for obscured or tiny nodes.

Double-click text opens a DOM textarea using the existing font stack. Enter adds
a newline, Ctrl/Command+Enter or Done commits, Escape or Cancel cancels, and blur
commits after composition completes. IME composition guards cover candidate
confirmation, cancellation and focus loss. Controller/project/history changes
invalidate transient UI and its ticket. Remote proposals still require explicit
version-checked Apply; no sharing or permission boundary changes.

`test:visual-remix-canvas` covers geometry and controller history. The separately
run `test:visual-remix-canvas-browser` exercises the built route with pointer,
zoom, synthetic composition, exports and portable data. Synthetic composition
is not proof of native operating-system IME candidate-window behavior.

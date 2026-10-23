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
motion export, remote model integration or deployment is part of this increment.

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

# Visual Remix layered HTML export

Follow-up #127 to Master #85. Export HTML downloads the currently applied Scene
as one offline 1080×1440 HTML document with real text, separate rectangle/ellipse
elements and separate inline raster images. It does not upload anything or
create a Stitch connection. Existing PNG, portable JSON and MP4 remain available.

Finish pending local parameters and fix actual layout errors first. Remote
candidates remain unapplied until explicit Apply; exports use the applied Scene.
An interrupted/revoked or superseded async export cannot download stale state.
One continuous parameter gesture still uses one Undo checkpoint.

HTML includes only visible Scene layers and used approved image data, with stable
data-layer-id attributes for inspection. It excludes reference Blobs, unused
assets, project identity, credentials, publishing captions and provenance.
Whole intended images retain their approved encoded file bytes (including any
image-file metadata); partial images are materialized into tight PNG crops,
never CSS-hidden full-source files. Fractional crop bounds are explicitly
unsupported for this exporter: use an intended integer-pixel crop rather than
silently resampling or flattening. Unknown layer types and size limits reject.

Text is escaped, including entity-looking strings and CR/LF. Styling comes from
the strict Scene schema. No JavaScript, event handlers, external fonts/assets,
forms, frames or network dependency. CSP denies network/script execution; opening
the file offline renders the poster. Editing HTML text/styles/image elements in
a local document demonstrates DOM editability, not target-native editability.

Fonts use the same local stacks as the editor, not embedded font files.
Cross-browser font availability, glyph shaping and line wrapping may differ;
image crop-edge interpolation and shape antialiasing can differ from Canvas.
Compare at original dimensions. Keep the existing PNG for publish-ready raster
parity; this export is not a promise of lossless browser or design-tool import.

## Google Stitch: capability and qualification are separate

The Google-owned code-to-design skill documents self-contained HTML ingestion.
Its uploader sends htmlCode with screenType DOCUMENT, while screenshot uploads
are IMAGE. That proves a supported input route, not independent native layer
editing or stable layer identity:

- https://github.com/google-labs-code/stitch-skills/blob/main/plugins/stitch-design/skills/code-to-design/SKILL.md
- https://github.com/google-labs-code/stitch-skills/blob/main/plugins/stitch-design/skills/upload-to-stitch/scripts/upload_to_stitch.py

A separate synthetic qualification must import this HTML through an already
authorized private Stitch route, then directly select/edit text, move/replace
an image and modify a shape independently. Save/reopen and inspect the resulting
structure/pixels. Upload acceptance, screenshot recreation or prompt regeneration
alone is insufficient. Until that passes, native Stitch editing is UNVERIFIED.

On 2026-10-25, a non-sensitive six-layer fixture was privately imported through
the documented uploader. Stitch returned a COMPLETE DESIGN screen, and its HTML
download matched all 3,006 uploaded bytes (SHA-256
`d8b539078cb423c6693ccd959c4f1d0f63ddc2b4bf41ee7f1c3ac2612c1ca30f`).
The screen UI reported a 1280×1440 frame; the source document is 1080×1440.
This establishes ingestion and retained HTML, not exact target canvas parity
or independently editable native layers. Direct text/image/shape editing remains
unverified until the separate qualification above is completed.

No automatic Google upload/authentication, API-key storage, permanent sharing,
DESIGN.md, bidirectional sync, ZIP/SVG platform or paid dependency is introduced.
Do not upload the original reference or unrelated project data for qualification.
Use the non-sensitive fixture only. New credentials, permissions or mandatory
personal Google login require their own access handoff. No production or Master
closure follows from local export or target qualification.

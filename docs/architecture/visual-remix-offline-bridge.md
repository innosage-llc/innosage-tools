# Offline Scene bridge preparation

`lib/visual-remix-bridge.ts` prepares the browser-side control boundary for #88.
It is not imported by the application or Worker entrypoint. No transport, MCP
endpoint, OAuth registration, credential, storage binding or live capability is
added. The existing video service and its grants are unchanged.

## Small operation contract

| Prospective tool | Local method | Result |
| --- | --- | --- |
| `get_scene` | `getScene()` | Current versioned Scene and used raster descriptors |
| `propose_scene` | `proposeScene(json)` | Actual controller rendering/preview result; never automatic Apply |
| `proposal_status` | `proposalStatus(id)` | Actual controller status, including awaiting browser Apply |
| `cancel_proposal` | `cancelProposal(id)` | Cancellation of an owned request; does not undo an applied result |

The browser retains Apply, Undo, PNG/MP4 generation and local downloads. A preview
is `applied:false`, `awaitingApply:true`, `terminal:false`. A later applied status
can only come from the browser controller. Enqueue is not completion.

The adapter reuses the real controller's project/generation/revision fencing,
payload identity, finite request receipts and asynchronous rendering. Duplicate
payloads remain idempotent; changed payloads using one request ID are rejected.
Reopen/revoke/expiry cannot retarget a late result or cancel a new project's
request that happens to reuse an old ID. Revoking this share cancels its own
pending requests, while leaving the applied local Scene and PNG intact.

## Consent and data boundary

Local consent explicitly names text, layout, captions, provenance, limitations
and raster descriptors, binds the current project and fresh generation, and
expires within fifteen minutes. The adapter copies only its binding/expiry;
caller mutations and extra credential fields cannot become shared metadata.
Sharing is unavailable during project loading. Successful import creates another
fresh generation, so even consent assembled from a transitional snapshot cannot
authorize the replacement Scene after it commits.

This local confirmation **is not OAuth authentication or a bearer capability**.
A future transport must derive independent, verified Scene-purpose authority
before using it. Never accept these local fields as proof supplied by a remote
caller, or reinterpret existing video grants as Scene consent.

Owned serialization selects a parsed Scene and used raster descriptors. It has
no reference-image, source pixel, asset data, filename/path, object URL, export,
credential or controller-output field. Ordinary text may include a source URL.
Text/captions/provenance are user content: the adapter is not a secret detector
for information the user types into explicitly shared fields. Source images and
approved raster bytes remain in the local asset store.

Scene/proposal metadata is capped at 12 KiB UTF-8; a larger valid local Scene can
still export locally. This is a payload limit, **not proof that every escaped
JSON-RPC envelope fits** the existing 16 KiB HTTP limit. A future host must check
its actual serialized envelope and reject excess bytes without raising that cap.

## Evidence and remaining authority

`npm run test:visual-remix-bridge` uses the real controller with a synthetic local
renderer/decoder. It covers consent/purpose mismatch, projection and unused
assets, preview/Apply ownership, duplicates/conflicts/stale revisions, UTF-8
limits, cancellation, expiry, cross-project late work and delayed same-ID imports. It does not prove image
accuracy, browser rendering, real MCP transport or ChatGPT Web compatibility.

The actual image reconstruction uses the explicit image-plus-agent-brief path
documented in [the editor contract](visual-remix-editor.md). The offline adapter
does not analyze an image or introduce a server-side model.

Live integration remains blocked on a reviewed purpose-isolated
consent/audience/proof/storage design and applicable authorization. The existing
video OAuth/metadata contracts are unsuitable for Scene data. No new Worker or
OAuth infrastructure is selected by this increment. Every live synthetic MCP
staging run additionally needs the Hub's separate exact-run Founder approval.
Do not close #88 or Master #85 from this offline evidence.

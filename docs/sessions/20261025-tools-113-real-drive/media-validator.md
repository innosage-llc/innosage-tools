# #113 media validator compatibility

Parent #102 and #113 remain OPEN. This is a minimal transport compatibility
hypothesis, not a native replication fork or proof of real-provider acceptance.

## Observed boundary

Tools PR114 (`0b294d955f47c1cb5553f69669ca7da2646c739a`) was deployed to
`https://3ff0b5a4.innosage-tools.pages.dev/tools/byos`, deployment
`3ff0b5a4-67d9-4415-94cf-149afa967be7`, version 0.1.6. Founder authorized two
independent ordinary Chrome profiles. Automated Chromium login had been rejected
by Google; no security workaround was used.

[First real attempt](https://github.com/innosage-llc/innosage-tools/issues/113#issuecomment-6393640602):
88 application dispatches, actual scoped setup/metadata/upload responses, then
PUT412 and media200 without a browser-readable ETag. The native helper requires
that header. No retained network capture establishes whether the header was
absent on the wire or hidden by CORS; the exact cause of the 412 is also unproven.
The complete acknowledged A body and protected journal survived. B was not synced;
no real A↔B or remote body verification passed. No further live requests were
made during this investigation.

[RxDB #8606](https://github.com/pubkey/rxdb/issues/8606) reports a similar symptom,
but its closure/link to #8413 does not establish our root cause or supply a fix.
RxDB remains pinned to 17.6.0. Original #109/#111 results are unchanged.

## Smallest supported candidate

`real-drive/media-validator.mjs` brackets native v2 media reads with fresh full
metadata. It downloads the explicit current `headRevisionId`, compares decimal
`version` strings and file ETag/revision/size/MIME before and after, checks actual
byte length, then supplies the verified JSON file ETag to the unchanged native
CAS path. It never changes PUT/If-Match or retries a failed write. Missing or
weak validators, unavailable revisions and concurrent change fail closed.

The native metadata-only empty-file bootstrap has one narrow exception: actual
zero downloaded bytes plus matching file identity, version, strong ETag and zero
size on both metadata reads. Zero bytes are a unique body; no content is invented.
An empty→nonempty→empty change is detected by monotonic version drift.

Source contract: [v2 File metadata](https://developers.google.com/workspace/drive/api/reference/rest/v2/files),
[revision-bound media GET](https://developers.google.com/workspace/drive/api/reference/rest/v2/files/get),
[strong If-Match](https://www.rfc-editor.org/rfc/rfc9110.html#section-13.1.1).
Two extra metadata GETs per native media read count against the existing request
budget. No scope, credentials, storage identity, conflict semantics, checkpoint
policy, dependency or architecture change is included.

## Deterministic evidence and its limits

- Seven new `node:test` regressions failed on the original transport and pass
  with the candidate: stable revision, concurrent write, ABA with int64 version,
  unsupported validators, real empty bytes, stale conditional PUT412, revision404.
  Existing four offline tests also pass (11 total).
- Existing `real-drive/mock-browser.mjs` now deliberately omits the media ETag
  observed missing in the browser, and implements only the needed metadata/current
  revision response. Its native RxDB full-body A→B→A, retained conflict bodies,
  Keep local, checkpoint and disconnect assertions pass: 842 **mock** dispatches.
  The unavailable historical revision returns404; no new provider history engine.
- Independent read-only source/security review: PASS. Full metadata avoids
  partial-response validator ambiguity; revision binding avoids attaching a new
  ETag to stale bytes. Real field availability/conditional PUT acceptance remain
  qualification questions, not facts established by this mock.

Fast loop: `npm run test:byos-real-drive:offline`. Existing browser-native offline
loop: `node scripts/prepare-byos.mjs` then
`node spikes/byos-sync/real-drive/mock-browser.mjs`. All Google requests in that
loop are intercepted fixtures. Native repository gates and final reviewed SHA,
PR/CI and deployment receipt will be linked in #113 after integration.

## Remaining real boundary

CLI fixtures own ordering, exact body/journal/checkpoint assertions and CAS
regressions. No new TUI is needed. A real browser is still required for actual
Web OAuth, readable response semantics and IndexedDB; CLI OAuth cannot replace it.
First qualify a single explicit A sync/remote verification on the reviewed
candidate. Stop at the first compatibility failure; only if it succeeds proceed
to B full-body reception and B→A, then the existing focused R3–R5 journeys.
Do not repeat the failed login route or run a broad live campaign.

An immutable replacement staging origin requires the human to register that
exact origin and authorize the candidate. Preserve both old profile tabs and
their original IndexedDB; a new origin has a different store and is **not** proof
of recovery of the old acknowledged edit. Do not silently copy/reset identities
or claim that manually re-entering text is journal recovery. The existing run ID,
body/edit ID and sanitized receipt are retained privately under `.byos-real/`.
Real-provider acceptance remains HOLD until applicable actual journeys pass.

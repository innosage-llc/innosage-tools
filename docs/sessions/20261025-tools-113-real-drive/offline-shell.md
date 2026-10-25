# Minimal offline reopen for #113

## Observed real progress and remaining gap

On deployed fa3ce8610ba46bf0d2bb55f7727467b76edecfe3 (Tools120/Hub413,
staging bad052ad), normal Chrome A/B completed the real full-body/edit-ID
A→Drive→B→Drive→A journey. A's original submitted Markdown SHA256 was
3cfa21d5d60e492ef8412396333133f5cf6a0cb190e28a9bc0cb04145b125f1e;
B returned a96abf359b4f1d7060580e94910f7ca1711e720b0094f7b97ab703bd917aca79.
Both independent stores used the same nonsecret account/folder hashes. Native
UI-assisted evidence, not automated Playwright real-provider PASS or Founder
acceptance. Original failures remain preserved.

The provisional convergence gap was premature sampling: busy=false ends sync,
not the whole Verify. Actual PUT200 submitted seq2's full body; three later
same-file GET200s followed; final copied response equals that JSON. Settled
remote/page IDs match. No cache fault established or speculative fix added.
The public view field is `journal`, not `draft`; diagnostic booleans using the
latter cannot establish journal absence. Remote-verified status and subsequent
new seq1 ACK corroborate retirement; subsequent assertions use `view.journal`.

A then saved acknowledged text with tab networking Offline. One explicit Sync
failed with one NETWORK_ERROR and blocked status, preserving text/journal/editID.
Ordinary offline reload showed ERR_INTERNET_DISCONNECTED. Restoring connectivity
and reloading recovered the exact text/journal/session with zero Google requests.
No-auth Verify showed reauth-required, zero requests, same journal. The runtime
checkpoint handle became null during failed reconnect; that alone is not evidence
of a durable checkpoint change. Existing deterministic checkpoint tests remain
the applicable ordering evidence.

## Small correction

Canonical `/byos-demo/` only: service worker caches static generated HTML plus
its digest-pinned JS pair. Integrity checks happen before activation. Offline
navigation preserves the browser URL/IndexedDB identity, using that version's
HTML and bundle. Never caches Google/GIS/API responses, tokens, user bodies or
workspace-specific navigation keys. No auth/native/CAS/conflict/Changes changes.

First activation claims its page. Updates wait for normal lifecycle; no forced
reload/skipWaiting or old-cache removal beneath existing tabs. A previous complete
shell can remain the offline restart version; readiness distinguishes a pending
update from the currently loaded bundle. Main's unrelated Visual Remix121/122
were preserved by native Master Sync (base e316b46), not edited.

Primary mechanism: [service workers](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers),
[scope and registration](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerContainer/register).
This is static offline access for R3, not a new sync engine, PWA framework,
provider recovery mechanism or permission expansion.

## Verification

Focused shell assertion RED before correction (readiness absent), then GREEN:
offline full reload, full browser process close/reopen with persistent store,
exact acknowledged full body/editID/journal/session, corrupt update rejected
without replacing prior complete cache, only two static keys, no persisted auth,
truthful no-auth retry and zero Google requests. Existing 16 focused unit tests,
local two-profile/duplicate-writer check and native mock694 dispatches PASS.
Independent exact-source review/native gates and actual deployed offline/reconnect
qualification follow; do not carry this local PASS as a real-provider R3 PASS.

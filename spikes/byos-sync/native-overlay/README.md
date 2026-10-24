# Native RxDB overlay — offline spike

Refs https://github.com/innosage-llc/innosage-tools/issues/102

**NOT FOR PRODUCT. MOCK-TESTED; REAL-PROVIDER-NOT-RUN.**

This increment adds the bounded journal/PageStore and its executable store-level
fixtures. It preserves RxDB17.6.0's published Drive replication and default
Master Wins. `pages` replicates; `localDrafts` does not. A draft is keyed by
workspace/database + page + independent writer session. A duplicate browser
session cannot acquire its Web Lock and is visibly read-only. RxDB itself owns
multi-instance storage, reactive reads and sync leadership; there is no app
broadcast bus or third durable database.

From repository root after the normal locked dependency install:

```sh
npm ci --prefix spikes/byos-sync --ignore-scripts --no-audit --no-fund
npm run test:byos-native-overlay
```

Full text assertions inspect journals, chosen views, native pages and actual mock
remote documents. Generated output goes to `.generated/` and is ignored. The
store-only report lists browser/UI/measurement rows as NOT_RUN; it cannot certify
the whole Master. F16 intentionally records the native same-time checkpoint
failure while retaining 30 remote documents. An expected engine failure does not
hide app-layer failures or authorize a native fork. Source and replay design are
in `DESIGN.md` and `fixtures.mjs`.

Remote verification uses published native transaction/document helpers to drain
WAL and read actual remote content under the native lock. sent$ and in-sync are
never sufficient. Cleanup requires the owned unchanged sequence/edit identity.
Network waits run outside the local journal queue so offline editing continues.
Resolution writes use native page revision CAS against the confirmed baseline;
Master advancement retains the local branch instead of implicitly rebasing it.

## Complete matrix and minimal UI

```sh
npm run test:byos-native-overlay:full
npm run spike:byos-native-overlay
```

Full replay includes 100 recorded seeded schedules, real Chromium two-tab/live
Drive journeys, native IndexedDB renderer crashes, fault schedules, both native
checkpoint replays and 10/1,000-page measurements (n=3 per scale). Chromium must
already be installed for the pinned Playwright runtime; the runner never logs
into a provider or auto-installs a browser. All HTTP fixture traffic is loopback;
external ICE servers are disabled for native live signaling. This is a harness
configuration, not evidence of real provider/WebRTC behavior.

The server prints session a/b URLs for one mock workspace. Unsaved text keeps an
unsaved status; acknowledged unresolved edits remain in their own journal.
Local/Cloud panes use complete text, and explicit resolution actions preserve
captured source bodies until native remote verification. See `ACCEPTANCE.md`
for the short Founder journey, `UPSTREAM-HOLD.md` for the separate repair proposal,
and committed `evidence/` for the reviewed snapshot. Regeneration writes only to
ignored `.generated/`; it does not change the historical #84 evidence.

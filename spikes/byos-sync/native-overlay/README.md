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

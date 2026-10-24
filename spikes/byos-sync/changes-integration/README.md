# Tools #111 bounded integration

One unchanged PageStore and UI/controller bind to the same Changes adapter in
Node and Chromium. `factory.mjs` redirects only PageStore's native Drive import;
public verification/transaction helpers remain native. No engine or coordination
framework is added. `binding.json` records both esbuild dependency graphs and
source hashes, including resolved CJS and browser ESM dependencies.

From `spikes/byos-sync`, using the pinned dependencies already installed:

```sh
node changes-integration/run.mjs --freeze
node changes-integration/run.mjs --self-check
node changes-integration/run.mjs I1 replay-1
node changes-integration/run.mjs I2 replay-1
node changes-integration/run.mjs I3_CRASH replay-1
node changes-integration/run.mjs I3_TABS replay-1
```

Use a fresh attempt label; attempts cannot be overwritten. A new freeze records
current bytes and rebuilds bindings. Existing successful receipts use freeze003,
not whatever source a later replay happens to build. The Hub oracle is verified
against `8a18ea549ca412a303d3b0aee84aa7846bc0ee1107cd69328d7252c52f1b407c`.

Each scenario invocation includes setup and teardown inside 1000 total HTTP
requests/180s. Parent watchdog terminates only its detached child process group
at 179s from invocation start. Node fetch admits exact task-owned loopback
origins before dispatch. Chromium reserves two requests per cross-origin mock
dispatch to cover its possible CORS preflight; actual mock+UI server request
counts are recorded separately. No run may expand its bound on exhaustion.
Profiles remain in ignored `.generated/profiles/<group-attempt>`; no database,
metadata, journal or evidence deletion is performed. The crash is a real CDP
renderer crash with retained native IndexedDB, not fake IndexedDB reopening.

Current results and affected-path reuse are in `report.json`. Full bodies,
journals, physical rows, metadata, checkpoints, adapter events, owner and HTTP
timelines are in retained phase/event archives. `publication/provenance.json`
binds deterministic redacted copies to original hashes; originals stay locally
intact. The only substitution replaces the absolute spike directory with
`<byos>`, including error stacks. Receipt hashes that name originals remain
original hashes; the provenance map supplies the published-copy hash.

I1 tests the original parent-folder query in `spaces=drive`, without a corpora
or driveId override. `supportsAllDrives`/`includeItemsFromAllDrives` do not imply
`corpora=allDrives`. An explicit incomplete result is injected to test safe
handling; this does not establish that Google produces it for this query.
Inventory is finite; scheduled changes are retained. Changes tokens are opaque
and do not expire under the scoped contract. Full current bodies are read;
this is no arbitrary-concurrency snapshot proof. Native empty-tail checkpoint
replay remains conservative. S4_NO_EVENT is preserved without an automatic veto.

All current runs use explicit sync, `live:false`, transactionTimeout50ms and
retryTime1000ms. I1/I2 use fake IndexedDB with `multiInstance:false`; I3 uses
Chromium151.0.7922.34, real native IndexedDB and `multiInstance:true`. These
overrides are fixture configuration, not product performance qualification.
Requested role is gpt-6.1-sol/high; host/provider model/effort, usage and cost
remain UNKNOWN. Native gates, independent review, PR and Founder outcome
acceptance are separate root-owned steps. No provider/full-V4/production claim.

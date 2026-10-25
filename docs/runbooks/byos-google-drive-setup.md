# BYOS research demo: Google Drive setup

Scope: Tools #113, parent #102. Existing Changes adapter, RxDB 17.6.0 native
replication/transactions and PageStore local protection. This is an explicit-sync
research demo, not production. #111 remains accepted bounded mock evidence.

## Current delivery and authorization

The final #113 acceptance comment supplies the **immutable staging URL, deployed
source/version and deployment ID**. For repeatable OAuth testing, prefer the existing stable staging alias
`https://staging.innosage-tools.pages.dev` once registered by the account owner.
Before and after each run, verify release.json source/version/build/config and
served assets against the selected immutable deployment receipt. A mismatch or
concurrent deployment makes that run INCONCLUSIVE. Retain immutable URLs as
release evidence; do not move an already authorized active run merely to change
origins. An existing immutable deployment cannot be overwritten for a new build. `/tools/byos` links to the editor at
`/tools/byos-demo/index.html`. Client ID is entered at runtime; registering OAuth
requires no rebuild. No client secret belongs in this browser app.

Until dedicated-account authorization is provided, real R1–R5 are
`NOT_RUN_AUTH`. Source, offline tests and staging UI are separate evidence.
Real tests never silently widen `drive.file` or substitute a CLI token.

## Shortest Founder setup

1. Use a **dedicated disposable Google test account**, with no personal Drive
   content. In [Google Cloud project selector](https://console.cloud.google.com/projectselector2/home/dashboard),
   select the approved test project (or explicitly approve creating one). Do not
   enable billing or paid services. Granting credentials or new persistent access
   remains a separate human approval; no account creation/login is automated.
2. Enable **Google Drive API** in that project:
   [Drive API library](https://console.cloud.google.com/apis/library/drive.googleapis.com).
3. In [Google Auth Platform Branding](https://console.cloud.google.com/auth/branding),
   set app name `InnoSage BYOS Test`, support email and developer contact to the
   designated test-account owner. In [Audience](https://console.cloud.google.com/auth/audience),
   choose External, **Testing**, and add only the disposable account as test user.
   In [Data Access](https://console.cloud.google.com/auth/scopes), request only
   `https://www.googleapis.com/auth/drive.file`. No full Drive, Shared Drive,
   impersonation or service account.
4. In [Clients](https://console.cloud.google.com/auth/clients), create an OAuth
   **Web application** client named `InnoSage BYOS staging`. Authorized JavaScript
   origin = the selected fixed staging **origin** from the delivery packet,
   with no path/query/trailing slash. Example shape:
   `https://staging.innosage-tools.pages.dev`. An explicitly selected immutable
   candidate is also supported, but requires registering that different origin.
   This GIS token-popup integration needs **no Authorized redirect URI** and no
   client secret in the app. Do not register the `/tools/...` path as an origin.
5. Open the exact demo. Paste the **public Client ID** in its field. Check the
   dedicated-account acknowledgment. Click **Authorize test account**: the first
   click loads GIS, then click again to open Google's account/consent popup.
   Select only the disposable account and approve `drive.file`. Human handles
   login, MFA, consent and any Google Console-only step. Never paste bearer or
   refresh tokens/client secrets into chat, Issues, URL fields or terminal args.

Google's token model uses memory-only access tokens and explicit reauthorization;
reload/profile reopen therefore requires authorization again. Once Sync has attempted a connection, changing authorization requires a reload; Disconnect forgets credentials immediately without waiting for native initial-sync cancellation. It does not require
or implement a refresh-token backend. Local Markdown/journals and nonsecret
workspace/client/account-hash binding remain in IndexedDB/localStorage. The same
workspace cannot reconnect to another account/client/folder and upload old edits.

## Five-minute core journey

- **A → Drive → B → A:** open the workspace link displayed by A in a second
  **independent browser profile**, same OAuth client and disposable account. Initialize/sync A first, then connect B; concurrent first-time folder creation is unsupported and detected ambiguity stops safely.
  Save a short Markdown body in A, click Sync then Verify remote. In B click Sync
  and compare the full body; edit/save/verify B, then Sync A. A new profile has its
  own IndexedDB and writer session. Two tabs in one profile are not this test.
- **Offline/reopen:** save locally without authorization/network; close and reopen
  the same profile/workspace. Compare the full body and protected recovery draft.
  Authorize again, Sync and Verify remote. Do not clear site data or rotate identity.
- **Conflict:** both profiles start from the same page. A saves a local edit while
  B saves and verifies a different edit. Sync A. Both original bodies must remain
  visible. Use cloud explicitly discards only that session's owned draft; Keep
  local or Merge manually retains the journal until successful Verify remote.

Sync/Verify may write native transaction/WAL control files. They are not read-only
probes. The folder is `InnoSage_BYOS_<workspace UUID>` under My Drive root, marked
by this app. No arbitrary folder chooser. Unsupported/ambiguous/missing bound
folder or account drift stops before native initialization. Do not manually edit
or delete native control files. The duplicate-tab default is read-only while the
same profile writer is open; separate profiles are the two-client acceptance.

## Repeatable agent-native command

Pinned local tooling is recorded in
`spikes/byos-sync/real-drive/toolchain.json`: gcloud 590.0.1, gws 0.22.5, RxDB17.6.0,
Playwright1.62.1. Task-local archives/binaries/configuration live in ignored
`.byos-real/toolchain/`; no global install, credential copy or automatic login.
`gws` is a community Google Workspace CLI, not an officially supported Google
product. We inspected public `drive.files.list` and `drive.changes.list` schemas;
that is not evidence of browser authorization or service behavior.

After explicit approval for the dedicated CLI credentials, a human can run the
pinned `gcloud auth login` using task-local `CLOUDSDK_CONFIG`, then the scoped
`gcloud services enable drive.googleapis.com --project=<approved-project>`.
Do not run broad `gws auth setup` defaults. Separately approve any gws persistent
auth; request only `drive.file` using the pinned CLI's documented auth flags.
CLI inspection is optional diagnostic support and may not see browser-created
files under a different OAuth application. Browser consent is the authority for
product tests; no CLI token is injected into the browser.

```sh
npm ci
npm ci --prefix spikes/byos-sync --ignore-scripts --no-audit --no-fund
npm run test:byos-real-drive:offline
# No configured OAuth: machine-readable NOT_RUN_AUTH, exit 2; no browser/provider calls.
npm run test:byos-real-drive
# After dedicated-account/client approval; these variables are public configuration only:
BYOS_DEMO_URL='https://<exact-deployment>.innosage-tools.pages.dev/tools/byos-demo/index.html' \
BYOS_PUBLIC_CLIENT_ID='<public-web-client-id>' \
npm run test:byos-real-drive -- --interactive
```

The runner opens two independent persistent profiles, waits for **human** browser
consent and then drives ordinary controls. After offline/profile reopen it waits
for human reauthorization again. No trace, storageState, token export or private
WAL mutation. Profiles and full synthetic-body receipts are private/ignored under
`.byos-real/<run-id>`; preserve them for retry rather than resetting state.
The runner admits at most 3,000 Google API dispatch attempts within a 20-minute
window from startup (including human waits); this is a dispatch deadline, not a
claim that all browser/consent teardown completes within 20 minutes. Each human
consent wait is separately bounded to 10 minutes; each Sync has 1,000 requests/180 seconds and each fetch 20 seconds.
A bound reached is INCONCLUSIVE, not impossible. No automatic cleanup/Drive deletion.
Quota cost is UNKNOWN unless actually observed; counts are client dispatches,
not billing counters or CORS-preflight totals.

The uncertain-write case lets one genuine application PUT succeed, drops its
response at the client, temporarily blocks further requests, checks retained
intent, then restores requests and verifies recovery. The 401 case is explicitly
**client-injected**, not evidence that real revocation/expiry occurred. R1 actual
pagination and v2 ETag/Date CORS coverage must be inspected; the runner conservatively
returns CONDITIONAL until these missing service observations and independent review
are resolved. No unconditional real PASS can be inferred from a zero-length log.

## Sources and limits

### Deterministic compatibility loop and normal-browser fallback

Use `npm run test:byos-real-drive:offline` for controlled read/write ordering,
version drift, validator and failure assertions. For the existing native RxDB +
IndexedDB fixture run `node scripts/prepare-byos.mjs` and
`node spikes/byos-sync/real-drive/mock-browser.mjs`. This is CLI-driven offline
Chromium with intercepted Google calls, not real Google qualification.

The real transport binds v2 media bytes to an explicit revision from one File
metadata snapshot, returning that snapshot's ORIGINAL strong file ETag to native
CAS. Empty bootstrap requires actual zero bytes matching zero-size metadata.
Later changes are handled by native conditional PUT/412; unsupported metadata,
wrong size/revision or failed downloads fail closed, with no fallback or retry.
See the [compatibility evidence](../sessions/20261025-tools-113-real-drive/media-validator.md).

If Google rejects an automation-controlled login, stop that flow. A human may use
two dedicated **ordinary Chrome profiles** and the same workspace link, perform
login/consent, then use the normal app controls. Do not disable browser security,
hide automation, copy tokens or substitute CLI authorization. Label these results
native UI-assisted/manual, not an automated Playwright run. Preserve the original
tabs and local stores; do not retry by rotating identity or clearing site data.

Prefer reusing the registered stable staging origin for future builds. This
retains origin-scoped local stores, but still requires compatibility and truthful
release checks; it does not guarantee token lifetime or waive reauthorization.
Keep all historical immutable-origin stores intact. Each replacement immutable
staging origin, if deliberately chosen instead, needs its own authorized JavaScript
origin and human in-memory authorization. It also has a separate IndexedDB;
opening it does not migrate or prove recovery of edits on the prior candidate.
Keep the old tabs/stores intact. Start with one A sync/remote verification, stop
on compatibility failure, and proceed to B and the remaining journeys only after
that boundary succeeds. Reuse offline evidence for ordering and injected faults;
retain honest real-provider coverage gaps.

- [GIS token model](https://developers.google.com/identity/oauth2/web/guides/use-token-model)
- [Drive least-privilege scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)
- [files.list](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/list),
  [changes.list](https://developers.google.com/workspace/drive/api/reference/rest/v3/changes/list)
- Native helpers also use Drive v2 metadata and media updates with ETag/Date/CAS.
  Real CORS exposure and exact `drive.file` visibility are qualification requirements.
- No unattended sync, Shared Drives, production readiness, historical repair or
  Full Check claim. Original #102/#107/#109/#111 failures remain unchanged.

### Snapshot consistency and conditional writes

Read metadata E1/R1, download exactly R1, return E1 unchanged. A later update may
make that snapshot stale; the next native If-Match:E1 handles it with412. No
AFTER freshness reread, read retry or later-validator substitution. Headless
zero-size snapshots must download actual empty bytes. Same-origin local stores
remain intact across code reload, while memory-only access tokens need normal
reauthorization. See [actual evidence and corrected read contract](../sessions/20261025-tools-113-real-drive/snapshot-read.md).

### Offline editor reopen

Use the canonical `/byos-demo/?workspace=...` entry on the same registered origin.
The `/tools/byos-demo/` form redirects there without changing workspace, session
or origin-scoped data. Wait for **Offline editor ready** once online, then the
editor can reopen offline with its existing IndexedDB journal. Google sign-in
and explicit remote sync still require connectivity; no token is persisted.

Only the generated static HTML and exact integrity-pinned bundle enter the demo
service worker cache. Google/GIS/API responses, user bodies and workspace URLs
do not. Existing open tabs retain their loaded code; a service-worker update
waits rather than reloading an editor or forcing activation. An offline restart
can use the previous complete shell while an update waits; record the loaded
bundle identity separately from the moving staging release. Prior complete
static caches remain intact. This is a bounded demo policy, not a general PWA
cache lifecycle or background synchronization system.

`npm run test:byos-offline-shell` verifies the static cache, corrupt-update
rejection, offline reload and persistent-browser process reopen locally without
Google traffic. Real-provider reconnect remains a separate staging criterion.

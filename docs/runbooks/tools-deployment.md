# Tools staging → production

Tools uses Next.js static export (`out`) and the existing Cloudflare Pages
project `innosage-tools`. Do not move it to Firebase or create a parallel release
platform. The npm operator interface and successful deployment tags follow Draft;
the thin product-owned adapter replaces the old branch-inferred local deploy.
No private agentic-core checkout is required by this public repository.

## Targets and authorization

| Operator target | Infisical context | Pages branch | Pages environment | URL |
| --- | --- | --- | --- | --- |
| staging | staging | staging | preview | Printed immutable deployment URL + `/tools/recorder` |
| production | prod | main | production | `https://innosage.co/tools/recorder` |

Local branch does not select the target. Pages must still report production branch
`main`; the adapter checks this before uploading. The static app has no runtime
service bindings. `public/_redirects` makes `/tools` routes and prefixed Next.js
assets work on direct Pages URLs, while the existing production proxy remains
unchanged. Staging needs no DNS mutation, new Pages project or proxy.

Read-only provider inspection on 2026-10-09 confirmed this mapping, production
and preview deployment history, and empty preview/production env-vars. The
inspection also returned `source: null`: this is a direct-upload project, not a
Git-connected project with an independent production-on-push trigger. The adapter
rejects a future Git connection unless its automatic production deployments are
explicitly disabled. No provider setting change was needed for this delivery. Prior
production deployment ID was `09f2a67e-e313-4f73-832e-4b576160bbc2`; capture the
live prior ID at each subsequent release rather than assuming this stays current.
Historical deployments marked dirty cannot prove exact Git-source identity.

Engineering review and native `scripts/auto-merge-ci.sh` authorize integration,
not production. Pushes/PRs to main run checks only. Founder staging acceptance
and separate production permission are required; running the production command
is the operator's action under that permission, not an approval mechanism itself.

## Local staging

Prerequisites: Node 22+, locked npm dependencies, git/gh, Infisical login with the
existing Tools project context. No credential values should be passed in commands.
The selected context supplies `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
If present, `CLOUDFLARE_PAGES_PROJECT` must equal `innosage-tools`. Injection covers
both build and upload; project selection is resolved after injection.

```bash
npm ci
npm run deploy:staging
npm run deploy:verify:staging
```

Start from clean reviewed source. The adapter builds, checks SEO, and retains an
identified export under `.deploy/releases/<FULL_SHA>/out/`. `release.json` includes
source revision, package version, build SHA-256, configuration SHA-256 and build
time; no secrets. The tree hash excludes this manifest to avoid a circular hash.
The adapter reuses the retained artifact on staging retries without rebuilding.

After upload, provider metadata must match the exact SHA/preview branch, a clean
commit and successful deployment. The verifier checks release identity, `/tools`,
`/tools/recorder` and their referenced JS/CSS/fonts. It rejects asset 404s and HTML
fallback instead of treating an HTML 200 as a working application.

`.deploy/latest-staging.json` records the URL, environment, deployment ID, version,
hashes, time, checks, tag and prior production ID. Retain this receipt together
with the artifact. Only after verification succeeds is the success tag pushed:

```text
deploy/staging/<SOURCE_BRANCH>/v<VERSION>-<SHORT_SHA>
deploy/production/main/v<VERSION>
```

Staging tags include SHA so ordinary staging work need not bump every time. Prepare
the release version once before final staging acceptance (`npm version patch
--no-git-tag-version`, review synchronized package/lockfile changes, PR and native
gate). Do not bump again after acceptance merely to promote. Tags are audit
pointers, not a release lock system. A version tag pointing to another revision
requires a new reviewed version; it must not be overwritten. Repeating the same
exact revision can reuse its tag.

## CI staging

GitHub Actions `Tools checks and staging deploy` supports manual staging dispatch
only. The native checks job also runs on manual dispatch; staging depends on its
success. It uses existing GitHub Cloudflare secrets with the same adapter:

```bash
gh workflow run deploy-tools.yml --ref <REVIEWED_REVISION_OR_BRANCH>
```

The job uploads `.deploy/` as `tools-staging-candidate-<SHA>` (hidden files included)
so the exact receipt/export can be restored to a clean checkout of that SHA.
The direct `deploy:execute:*` scripts are for an already injected secret context;
they do not select or create secrets themselves. CI does not expose a production
dispatch option. Do not run old main-push deployment workflows from old revisions.

## Staging acceptance versus recorder acceptance

HTTP/resource/manifest verification proves deployment wiring, not recording
correctness. For Epic #47 / child #48, use non-private synthetic audio, record
browser/OS version and prove audio-only record → Stop → save → reopen, correct
container/codec/duration and forward/backward seek for direct disk and fallback.
Do not claim #48 is complete from deployment tests. Keep Epic #47 open until its
Founder acceptance and separately authorized release are complete.

## Promote the accepted artifact

After Founder staging acceptance and separate production approval, use a clean
checkout of the accepted full SHA with its retained `.deploy/` candidate:

```bash
npm run deploy:production
```

The command does NOT select latest main, bump version or rebuild. It requires a
verified staging receipt matching current source/version/config and the retained
artifact hash. Missing/changed artifacts or source/config drift are rejected:
restore the accepted export or stage and accept the changed candidate under Hub's
delivery contract. Never just relabel latest main as the accepted candidate.

Before upload, the live previous production ID is captured in
`.deploy/rollback-before-latest.json`. After publishing the same export to main,
verify both the immutable Pages URL and canonical `https://innosage.co` routes.
The receipt and success tag are written only after verification. Tag-push failure
is not deployment failure/rollback: inspect provider state and retry the same
candidate safely. A failed verification may leave a deployed candidate; never
report success or blindly retry a changed build.

## Rollback

Keep the previous successful production deployment ID, version/source receipt
where available and canonical smoke evidence. Pages can restore a successful
production deployment; preview deployments are NOT production rollback targets.
Do not attempt to promote a preview using the rollback API.

Under the applicable production/rollback authorization, select that exact previous
production deployment in Cloudflare Pages → Deployments → Rollback. The equivalent
API is `POST /accounts/<ACCOUNT_ID>/pages/projects/innosage-tools/deployments/<PREVIOUS_PRODUCTION_ID>/rollback`
using privately injected operator credentials, never tokens in arguments/logs.
Do not delete deployments or change DNS/proxy to roll back.

Verify restored canonical `/tools/recorder`, its prefixed JS/CSS assets and known
version/receipt. Legacy rollback targets may lack `release.json`; use their saved
provider deployment identity plus canonical/browser smoke, and explicitly record
that limitation. A mocked test of rollback capture does not prove a live rollback;
no production rollback is part of staging delivery.

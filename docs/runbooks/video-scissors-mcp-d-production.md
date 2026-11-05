# Video Scissors MCP-D — isolated production release

Production MCP endpoint: https://video-scissors-mcp-d.innosage-draft.workers.dev/mcp
Same-origin editor: https://video-scissors-mcp-d.innosage-draft.workers.dev/tools/video-scissors
Public local-only editor: https://innosage.co/tools/video-scissors

## Release boundaries

- The public Pages editor works without ChatGPT, and links to the separate MCP-enabled Worker editor. It cannot remotely control the public Pages tab because its MCP transport and OAuth session are strictly same-origin. Reselect the video in the Worker-hosted tab. Nothing is transferred between tabs.
- Production Worker `video-scissors-mcp-d` must be distinct from D staging (`video-scissors-mcp-d-staging`), other A/B Workers, and the Pages project. Provision an independent production OAuth KV namespace `video-scissors-mcp-d-production-oauth` and a fresh production `D_ROUTING_HMAC_KEY`. SQLite Durable Object bindings are per-Worker; never copy a staging DO or its data.
- Tracked `wrangler.d-production.template.jsonc` is fail-closed (`EXPERIMENT_ENABLED=false`) with placeholder KV ID and no secret. Generate an ignored local `.env.*` config with the *exact* authorized new KV ID; never commit KV IDs, HMAC values, OAuth tokens, user media or browser proofs.
- Media decoding, extraction and PNG downloads stay in the user's browser; only allowlisted project metadata, short-lived OAuth state, and bounded editing commands enter the Worker. The production MCP client receives no image bytes.
- Do not expand worker scopes, connect production Pages directly to a cross-origin API, modify DNS, create D1 or alter public marketing analytics.

## Operator sequence (production approval and reviewed main required)

1. Verify `git status --short` empty, `git rev-parse HEAD` exact merged PR, and the retained *verified* staging Pages artifact matches `out/`/release hash. Do not rebuild production with a different source or move tags.
2. Using existing `infisical run --env=prod` context, inspect `wrangler deployments status --name video-scissors-mcp-d --json` and KV namespace list. Abort if the Worker name already exists unexpectedly or the exact dedicated production KV namespace belongs to another task.
3. Create the exact dedicated production KV namespace once via Wrangler, retain only its ID in an ignored operator config derived from the reviewed template (substitute the 32-hex placeholder). Confirm `EXPERIMENT_ENABLED=false`, name `video-scissors-mcp-d`, `main=src/index-d.ts`, one production `OAUTH_KV`, one SQLite `PROJECT_STATE` binding, no custom routes/D1.
4. Dry-run `wrangler deploy --config <ignored config> --dry-run --keep-vars`, then deploy the disabled Worker. Verify `/tools/video-scissors` returns 200 and `/remote/capabilities` and `/mcp` return 503. Capture the disabled deployment/version ID as the emergency rollback target.
5. Generate a fresh random 32-byte HMAC key in process memory and pipe it directly into `wrangler secret put D_ROUTING_HMAC_KEY --config <ignored config>` under production Infisical. Do not print, log, echo, save to files or use the staging key. Secret writes can deploy a new version; repeat disabled-state checks afterward.
6. Create a second ignored config identical to disabled except `EXPERIMENT_ENABLED=true`; dry-run it, deploy with `--keep-vars`, verify the single new Worker name and bindings, capture enabled version ID and provider receipt.
7. Verify `GET /remote/capabilities` is 200 with `enabled:true` and `wakeup:websocket`, unauthenticated `/mcp` is 401 with protected-resource challenge, `.well-known` OAuth discovery advertises S256, scopes `video:read`/`video:edit`, and dynamic client registration works. Test the same-origin browser Editor with synthetic H.264 and 2160×3842 HEVC frame extraction, an accurate PNG, Cut/Undo regression and a strict network payload audit. Distinguish scripted OAuth from real ChatGPT Web.
8. Promote the exact accepted static Pages artifact (which adds the public link) after all tests. Verify public `/tools`, `/tools/video-scissors`, immutable production `release.json`, click-through to the Worker editor and no unintended media upload.

## Production rollback and closeout

- For a broken MCP deployment, run `wrangler rollback <disabled-version-id> --name video-scissors-mcp-d --yes` under `infisical run --env=prod`, then verify capabilities/MCP are 503 while the static UI remains accessible. Do not roll back the unrelated Pages product or D staging.
- For a broken public Pages link, use the existing Pages rollback target retained in `.deploy/rollback-before-latest.json` under the normal production rollback authorization; do not delete resources or repoint DNS.
- Worker activation persists until explicitly rolled back. Per-project 30-minute consent/lease is not an automatic Worker shutdown. Operator owns ongoing production monitoring, error logs, auth safety and rollback.
- After release record issue #152, exact PR/main SHA, namespace name (not its ID), disabled/enabled Worker versions, staged/production Pages receipts, browser evidence and anything not verified. Do not close #152 on a fabricated ChatGPT-host pass.

## User flow

Open https://innosage.co/tools, select Video Scissors, then choose **Open ChatGPT-enabled editor**. On the Worker page choose the local MP4, click **Connect experimental ChatGPT control**, copy the one-time pairing proof, and add the production `/mcp` URL as a custom OAuth MCP server in ChatGPT. Authorize both video scopes using that proof. Use `getproject` first to read the source generation/version, then call `extractframe` with a fresh operation ID and timeSeconds, poll `status` to completed, and download PNG from the *Worker-hosted* browser page. No media is sent to ChatGPT.

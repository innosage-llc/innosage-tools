# Visual Remix host verification and recovery

The editable application is `/tools/visual-remix` in the external browser. This MCP server has no inline ChatGPT UI resource. A standalone SVG in an Image viewer is not an application Scene preview. Source pixels may be delivered through `read_shared_reference` after fresh per-image consent in the app. JSON briefs contain no image bytes; a duplicate ChatGPT attachment is not required for the consented image-sharing workflow. Native image delivery and host understanding are separate evidence.

## First and repeat use

1. Save local work, open the intended Scene/reference and review both sharing confirmations. Connect once, keep the browser awake, and enter the private one-use five-minute proof only in the official host consent form. New sessions require explicit consent to a fixed 30-minute lease; older 15-minute leases retain their original deadline. No refresh or heartbeat extends either lease. Expiry stops remote access while preserving the original image, applied Scene, local parameters and history. Use Reauthorize and continue, review fresh consent, Connect once and manually authorize the host to resume. Unknown revocation must be reconciled before a new share.
2. Browser sharing authorized means the browser consent binding exists. It does **not** prove token exchange or successful host tool access. Require a successful `get_scene`, then submit a new `propose_scene` using that exact project/generation/revision and a new requestId.
3. Require an actual candidate preview in the external editor and inspect content AND geometry. `queued`, `rendering` and `preview` are pending. Apply manually and check `proposal_status.applied`; export PNG/Scene/captions in the editor. No agent Apply/export is exposed.
4. On repeat, re-read the Scene before proposing. Reopen saved Scene to reuse without attaching/reanalyzing the original. Reconnect manually if the lease expired or project identity changed; old grants never acquire the new share. Finish with Disconnect and require confirmation.

## Failure evidence

Record sanitized tool name, status/error, request ID, service version, source revision and actual deployed Worker version. Responses expose `X-Visual-Remix-Request-Id`, `-Version`, `-Revision` and an allowlisted `-Tool` where present; missing evidence stays UNKNOWN. Browser errors retain only validated header values, never arbitrary response bodies, credentials, proof, private IDs or Scene content. Set optional nonsecret `SCENE_BUILD_REVISION` to the exact merged source when preparing the staging package; malformed/unset values report unknown. Response metadata is not persistent logging and cannot recover past requests.

Ordinary invalid/expired OAuth remains an official HTTP401 + WWW-Authenticate challenge. A lease lost after resource validation additionally returns the documented tool-result auth hint. That hint alone is not proof the real host reopened consent or accepted the proposal.

On authorization failure, stop and report that no preview/edit was delivered. Preserve the reconstruction; do not present SVG fallback as completion. Disconnect, create a fresh share and use the host's manual reconnect flow only within existing authority. Proof expiry, owner401, budget429 and uncertain revocation remain distinct; uncertain revocation is never reported as success. No automatic new grant, retrying create, scope expansion or TTL extension.

The Founder removed purely artificial Scene lifetime test quotas on2026-10-24: consent attempts and protocol HTTP requests continue counting but no longer stop at20/2000. No counters are reset. The legacy entrypoint retains its separate experiment behavior. SQL20stored shares and16requests/share remain reviewed storage/abuse bounds (they bound retained payloads), and the20DCR registration guard remains a persistent-client/abuse guard; removing these requires a minimally scoped security/storage proposal first. `SCENE_STORAGE_LIMIT`/429 is explicit and creates no new share. Free-plan/provider quota errors remain a stop/report boundary: no paid plan, new resource, overage, load test or unbounded retries is authorized.

Each agent-driven live synthetic MCP staging run still needs the canonical exact-candidate per-run Founder approval (fixture, maximum calls/retries, current usage or UNKNOWN, costs/limits, cleanup). Staging deployment permission is insufficient. The Founder may instead own the real ChatGPT run. Local/provider/browser regressions do not establish real-host acceptance. No production or Master closure follows from this checklist.

The lease-race tool-result challenge follows [OpenAI authentication guidance](https://developers.openai.com/plugins/build/auth#triggering-authentication-ui); ordinary resource-server validation and HTTP401 discovery remain unchanged.


### Founder partial verification follow-up (2026-10-25)

The first proposal rejection followed by UNKNOWN_REQUEST and later 26-element
preview is partial host evidence, not first-call success. Historical cause is
unknown. A fresh read must happen immediately before submission, after preparing
the Scene. Keep the editor visible in a separate window; returning foreground
refreshes the existing heartbeat without creating a share or extending expiry.
A known admission rejection is returned with `isError` and `admitted:false`:
`BROWSER_UNAVAILABLE` requires foreground heartbeat/fresh read;
`STALE_REVISION` requires fresh read and rebuilt proposal. Do not poll rejected
requests. Uncertain submissions must reconcile the same request ID and current
Scene before any bounded retry; no new ID or Connect loop to bypass uncertainty.

Historical manual-crop fallback (optional, not the required current workflow): load the reference, expand Approve local
raster assets, drag a tight photo/logo rectangle (or enter pixel coordinates),
Preview crop, inspect actual pixels, then Approve crop and preview placement.
Apply the placement, repeat for the other asset, and only then obtain a fresh
brief and connect. Ask the agent to retain/reposition these image IDs and remove
placeholder initials/approximate logo shapes while rebuilding editable text and
layout. Never call a placeholder design publish-ready. Save/reopen without the
reference, verify those exact identity pixels remain, change text AND layout and
export again. No crop bytes are uploaded or embedded into code/issue comments.
Do not generate a replacement real face/brand mark for fidelity acceptance.

Overlap export regression: separated author name/handle and headline/suffix may
have intersecting editable boxes but must not fail when their rendered glyphs
are separated. A genuine glyph collision or overflow must still block export.
Test long CN/EN reflow by adjusting geometry, not globally shrinking typography.
Retain earlier five-minute first-use failure; no new timing is inferred here.

## Founder iteration UX acceptance (2026-10-25)

Founder now reports that the core image flow works. This is user-reported recovery, not evidence of the historical root cause or a new timing benchmark. UX acceptance remains pending.

1. In the preview area, select a text layer, change its text and x/y or font size. Local edits apply automatically. Use adjacent Undo and Redo, then Download PNG. A held numeric arrow/spinner gesture is one history step; a new edit after Undo clears Redo. Advanced appearance/captions and connection policy stay available in collapsed details.
2. Ask the connected agent for a content and layout proposal using a fresh Scene read. Inspect the candidate, click Apply candidate, Undo, then Redo. Compare the applied image and export. Remote proposals never apply automatically; pending or invalid drafts and actual layout errors still block stale/unsafe PNG exports.
3. Save a project, then verify expiry in a local controlled-clock fixture (do not alter a live grant or wait/reconnect in a loop). Original reference, applied Scene, parameters, local editing and history must remain. Reauthorize and continue opens fresh unchecked sharing confirmations; no request is sent until explicit Connect and manual host consent. Continue with a fresh Scene read; prior credentials must not access the new session or image.
4. On staging, verify the same interaction after an actual lease expiry if needed. Keep the existing session's displayed deadline; an already-issued 15-minute session does not become 30 minutes. Finish with confirmed Disconnect. Agent-driven live MCP traffic still needs separate per-run approval; Founder may own the ChatGPT run.

Retain expiry/revocation/image isolation, stale proposal, interrupted create/render/revoke and repeat-use regressions. Record exact staging source/version and passed/failed/not-run checks. Stop for Founder final staging acceptance; no production deployment or Master closure.

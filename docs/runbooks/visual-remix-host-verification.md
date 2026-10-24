# Visual Remix host verification and recovery

The editable application is `/tools/visual-remix` in the external browser. This MCP server has no inline ChatGPT UI resource. A standalone SVG in an Image viewer is not an application Scene preview. Source pixels must be explicitly attached to the vision agent; Scene sharing sends descriptors and text/layout only.

## First and repeat use

1. Save local work, open the intended Scene/reference and review both sharing confirmations. Connect once, keep the browser awake, and enter the private one-use five-minute proof only in the official host consent form. A share lasts at most15minutes; no refresh extends it.
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

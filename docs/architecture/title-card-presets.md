# Title-card presets — #79 local architecture decision

Status: local implementation decision; real-host and release evidence pending.
Parent: https://github.com/innosage-llc/innosage-tools/issues/79 . The Founder
explicitly selected canonical V1 after the original V2 invocation. The separate
reviewed Hub compatibility commit is preserved and is not a product dependency.

Select A, the existing D1 polling path. A/B share `src/mcp.ts` and `src/mailbox.ts`;
`src/oauth.ts` receives an optional B bridge. Enable the new tool/resource only
when that bridge is absent. Keep B and D's tool surfaces unchanged. Hub #358 is
now a closed, amended tech spike; its accepted ADR retains D disabled, and actual
host/recovery/independent-grant qualification remains unproven. Tools #74 closed
as research with no safe optimization. Neither is activation authority for D.

Use one `lib/video-scissors-covers.ts` definition for exactly six styles. The
gallery shows illustrative sample text. The browser alone derives bounded Unicode
text from File.name and paints a PNG using local Canvas fonts. Existing FFmpeg
WASM receives that PNG plus the original MP4 and current original-relative clip
plan, encoding a 1.5-second silent intro and footage in one H.264/AAC output.
No drawtext/font download, media backend, upload, analytics or added scope.

Extend the controller's current stable-output/one-level Undo snapshot with preset
identity. Always re-render from original media; replacement never chains output
MP4s. Commit output and preset only on current successful completion. Apply uses
the same operation ID, source generation/version, busy and cancellation fences.
Reject intro+clip duration above300s. Existing mailbox atomic admission, ownership,
expiry/revoke, idempotency and report boundaries remain authoritative.

Add read-only showcoverpresets and scoped applycoverpreset on A. A ui://
resource linked with _meta.ui.resourceUri supplies six selectable sample cards
and explicit Apply. Use the MCP Apps iframe handshake and host tools/call only
when supported; selection alone is nonmutating. Display queued/running separately
from browser-completed status; reconnect/stale/errors never imply success. Text
fallback remains useful but cannot satisfy real ChatGPT Web acceptance.

Current references: https://developers.openai.com/plugins/build/chatgpt-ui and
https://apps.extensions.modelcontextprotocol.io/api/documents/overview.html .
Extended Forms does not replace the required visual gallery. Draft Meeting Recipe
can reuse preset identity, illustrative preview, explicit choice, scoped mutation
and verifiable completion; its existing document authority/privacy remain separate.
No Draft code change is needed for this design conclusion.

Pages and the experimental Worker are distinct release candidates. No deployment
identity or actual ChatGPT behavior is established by local source/tests. A live
synthetic MCP staging run still requires exact per-run fixture/count/budget,
cleanup and usage disclosure/approval. Founder staging acceptance and production
promotion remain separate gates. The architecture child draft is local only:
remote filing/submission resumes after actual existing CLI API and SSH access
were verified on 2026-10-22; the earlier sandbox-only auth diagnosis was incorrect.

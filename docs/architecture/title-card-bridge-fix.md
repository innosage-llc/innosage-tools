# #79 failed staging verification: initialization fix

Founder verification of v0.1.5/source0a429aefa812695836713e98a84e630c6c56c5da
FAILED. The six cards render, but the recording's existing error rejects the
missing object at params.appCapabilities before any recorded click. Midnight
black stays selected; Clean white(~1.0s), Lavender(~1.6s), Ocean gradient(~2.0s)
do not select; Apply stays disabled. Reconnect was not attempted. Private video
and frames are not published; sanitized observations and team-lead ownership:
https://github.com/innosage-llc/innosage-tools/issues/79#issuecomment-6339403558 .

The emitted request used ordinary MCP's capabilities:{} rather than the Apps
appCapabilities:{} required by the stable2026-01-26 contract:
https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx#app-capabilities-in-uiinitialize .
The production fix changes only that parameter name. Host capability validation,
scope/auth fences, media rendering, styles and operation/reconnect logic remain
unchanged. This is not a new fallback or SDK/framework migration.

Gemini3.8FlashHIGH CLI1.4.4 performed the one-line UI edit through the approved
accept-edits/sandbox file-tools route. CLI result SUCCESS/exit0; private streams
under /tmp/tools79-bridge-ui. Result omitted denied_actions; no denial observed.
Prompt SHA256 bef79452ab875a7b364bce977af722947f86c177cc4423455584980e15b9e439;
resulting CoverPickerView.ts SHA256
6fd36354f03d6bad5cb93c4a0e560bfd887374dd533b855607bd370064a637bd.

The old iframe fixture accepted arbitrary initialize params, so its earlier PASS
missed this real-host contract defect. The revised existing browser test rejects
the missing appCapabilities field with the recording's error, checks it appears
before click, and replays the three observed label clicks without changing the
disabled radio. The positive path validates actual wire params, selects all six
radios without mutation, explicitly applies a preset and checks queued/completed,
uncertain response retention, same-ID reconnect and absent host capability.
The Worker gate also executes startup from the actual authenticated resources/read
HTML and inspects its posted initialization message. No new dependency is added.

Focused isolated Chrome regression PASS is not actual ChatGPT success. During this
fix, a task-created ChatGPT root tab was confirmed after a create timeout, but its
read/bind timed out; native Chrome access then explicitly stopped because Computer
Use is not allowed on the current browser URL. No alternate profile, session,
automation interface, credentials or permission workaround. Real ChatGPT re-test
remains blocked/unverified; do not claim Founder acceptance or production readiness.

Fresh worktree: /Users/weijingliu/Documents/Codex/2026-10-22/task-4/innosage-tools-79-bridge-fix .
Base: freshly fetched/ls-remote verified0a429aefa812695836713e98a84e630c6c56c5da.
Explicit worktree creation takes precedence over the start script's single-main-
checkout assumption; main stays checked out in the original preserved checkout.
Use the existing autonomous-ops submit and native merge gate for this fix. Keep
the already prepared release version0.1.5: it has not been accepted/promoted, so
identify the corrected staging candidate by its new source/deployment hashes.

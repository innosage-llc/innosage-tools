# Simplified workspace UI

The existing tree is the page sidebar. Selection still uses the protected navigation/flush path; one Markdown editor displays the selected stable page identity. Titles rename pages. Expand Page properties for parent/order; all hierarchy and recovery controls remain available. Sync setup & diagnostics contains the original bounded experiment, foreground trial and full recovery/handoff metadata. The main view keeps authorization, unsaved/local saving, cloud generation status, conflict, failure and safe-close information visible.

Automatic saving remains immediate while the approved experiment is active. It is not a three-second debounce. Five-second cloud deadlines remain measured from each page's last input; local saving does not reset them. Cloud use requires an explicit account/folder connection and experiment start; loading the UI does not start cloud traffic. Local editing now also works before connection, using the same protected local save path. Manual Save/Sync/Verify remain available.

Overview labels derive from existing buffer/operation/drain state. They do not call save/sync, mint receipts, reset budgets or replace the existing ready check. Only the existing drain ready state with no dirty/local/cloud work permits a safe-close label. A page generation verified before required reconciliation is complete is not yet safe-close.

The prior v0.1.10 real measurements are historical evidence for the unchanged engine: safe close74.23–82.03s and B36.66–52.14s, one sample per cadence. The UI does not resolve those target misses or qualify all issue142 criteria. UI-only evidence is not new real Drive performance evidence.


## Account connection repair (v0.1.12)

A fresh browser previously threw before opening IndexedDB because its local #113 binding was absent. The URL carries a workspace UUID, not account authorization. Missing or malformed connection metadata now permits local editing and immediate protected local persistence, while cloud controls remain unavailable until the user connects. Invalid metadata and existing notes are preserved.

Connect Google Drive uses the existing narrow `drive.file` token model under a user gesture, with access tokens kept only in memory. Select an existing compatible app-owned workspace, or open a new UUID for another account and explicitly create its dedicated folder and native metadata. Account, client, workspace, root/docs/signaling identities stay pinned; setup is serialized with a workspace Web Lock. Unknown setup outcomes retain their reserved identity and stop instead of blindly creating another folder. Managed native writes require a live pinned operation and matching native record identity. Existing legacy #113 bindings retain their original path and folder-creation prohibition.

A local note in an unconnected UUID does not automatically move to a different account or workspace. New workspace navigation leaves those notes in their original namespace. Explicit setup uploads no page content; ordinary Sync uploads local pages. The advanced 26-page synthetic baseline is opt-in, separately bounded, and uses native Sync plus independent Verify before reloading into the unchanged prepared five-second experiment. It does not weaken creation-journal recovery checks or change cloud deadlines.

### Actual OAuth configuration observed November 4

Read-only inspection of the existing default client in Google Auth Platform confirmed the matching public client ID, External audience, Testing publishing status, and two test users (zero other users). The UI explicitly says only test users can access it while Testing. Publish app is disabled until Branding configuration is completed. No app publishing, audience/test-user changes, new grants, folders, or real Drive writes were performed for this repair. Therefore arbitrary-account production eligibility is **blocked by provider configuration**, not proven by the new connection code. An eligible separately configured public client can be supplied in Connection settings; no secret belongs there.

Local tests use intercepted synthetic OAuth and Drive responses. They prove native flow integration and account isolation under those fixtures, not real Google consent, provider eligibility, or new Drive performance. The prior real performance HOLD remains.

# Founder acceptance — offline native overlay spike

The Master remains OPEN. Engineering evidence is mock-only. The recommendation is HOLD / NOT SAFE FOR PRODUCT. F04 unattended updates are
NOT_PROVEN and F16 checkpoint discovery fails; this is not a NATIVE UX SPIKE PASS.

1. From the repository root, install the normal locked dependencies and run
   `npm run test:byos-native-overlay:full`. Inspect
   `spikes/byos-sync/native-overlay/.generated/SCORECARD.md`, `report.json` and
   `raw-evidence.json.gz`. Expect F04 BLOCKED, F16 FAIL/HOLD, the other bounded rows PASS, and F17 measured.
   The full command exits nonzero to preserve the unmet required criterion.
   The command includes 100 bounded seeded schedules and real Chromium journeys.
2. Run `npm run spike:byos-native-overlay`. Open the two loopback URLs printed
   for sessions a/b. Save in A, type without saving in B, then save again in A.
   B keeps its complete text and warning. Save B; reload its URL and inspect
   protected independent drafts. No Google account is used.
3. Run `cd spikes/byos-sync && node native-overlay/ui-browser.mjs` for the
   executable cross-device Local/Cloud, Keep local/manual merge and intervening
   remote update journey. It launches fresh isolated local browser contexts,
   leaves a conflict screenshot in `.generated/conflict-ui.png`, and asserts
   the latest native Master wins while the local resolution remains durable.

Report a failure with fixture ID, source digest, seed (if applicable), command
and expected/actual full synthetic body. Do not provide credentials or private
user content. Full replay runtime is recorded in generated evidence; the manual
UI check is short, while the entire automated matrix takes several minutes.

The F04 runner explicitly injects a published native reSync wake for E/other-page
reception and awaits actual native received$ before app assertions. Run the same command
with `--no-wake` to replay the unattended path. Its retained timeout keeps the
aggregate F04 BLOCKED. The injected component does not
prove unattended WebRTC notification delivery. The retained no-wake diagnostic
and REAL-PROVIDER-NOT-RUN label are part of the acceptance boundary.

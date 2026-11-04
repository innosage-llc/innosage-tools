# Simplified workspace UI

The existing tree is the page sidebar. Selection still uses the protected navigation/flush path; one Markdown editor displays the selected stable page identity. Titles rename pages. Expand Page properties for parent/order; all hierarchy and recovery controls remain available. Sync setup & diagnostics contains the original bounded experiment, foreground trial and full recovery/handoff metadata. The main view keeps authorization, unsaved/local saving, cloud generation status, conflict, failure and safe-close information visible.

Automatic saving remains immediate while the approved experiment is active. It is not a three-second debounce. Five-second cloud deadlines remain measured from each page's last input; local saving does not reset them. The original explicit account binding and experiment start are required; loading the UI does not start cloud traffic. Manual Save/Sync/Verify remain available.

Overview labels derive from existing buffer/operation/drain state. They do not call save/sync, mint receipts, reset budgets or replace the existing ready check. Only the existing drain ready state with no dirty/local/cloud work permits a safe-close label. A page generation verified before required reconciliation is complete is not yet safe-close.

The prior v0.1.10 real measurements are historical evidence for the unchanged engine: safe close74.23–82.03s and B36.66–52.14s, one sample per cadence. The UI does not resolve those target misses or qualify all issue142 criteria. UI-only evidence is not new real Drive performance evidence.

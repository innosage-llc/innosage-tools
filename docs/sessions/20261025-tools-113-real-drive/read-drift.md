# Third real attempt and stable-origin audit

Diagnostic candidate3c27a03/fec96e60: Founder authorized A/B, visibly confirmed in
two independent normal Chrome profiles on the same workspace. Exactly one A
Verify remote after acknowledged synthetic Markdown save. Actual nested errors:
RC_PULL -> MEDIA_VERSION_CHANGED at observations42 and69. A was then set offline
using normal DevTools; stopped busy=false, blocked,113 observations:
GET20098,POST2006,PUT2007,PUT4121,GET_NETWORK_ERROR1 (last induced by offline).
Full local body matches protected journal, edit identity retained; no remote body
verification or checkpoint, no B sync. Original prior attempts are unchanged.

This error proves a checked metadata field changed across a correlated read;
it does not identify which field, nor prove a Google defect. Within individual
latest metadata responses HTTP/JSON ETags were strong and equal; that does not
prove equality between the before/after samples. Native pull/push can contend for
the same transaction control file. Native acquisition412 is a legitimate retry.

Next increment records only allowlisted changed-field booleans, version ordering
and transaction/wal/other role on the existing error. No values, extra requests,
read retries, weakened comparisons, native fork or conflict-policy changes.
17 focused offline tests PASS; actual native two-acquisition fixture yields one
owner and one retry. First run of that fixture omitted JSON MIME and failed
NOT_A_JSON_FILE; fixture corrected, original output retained. This synthetic
schedule is not claimed as the real failure's cause. Independent review follows.
Do not blindly retry the read bridge: native fillFileIfEtagMatches retains an
original PUT200 while rereading current content/ETag, so a delayed reread crossing
lease replacement needs ownership analysis before any retry-based remedy.

Founder questioned repeated OAuth origins. They resulted from choosing immutable
deployment addresses, not an OAuth requirement. Cloudflare branch aliases are
stable: https://developers.cloudflare.com/pages/configuration/preview-deployments/
The existing https://staging.innosage-tools.pages.dev passed exact source/version/
build/config release checks against3c27a03 and its normal routes/assets. OAuth
registration for this alias is UNKNOWN. Prefer it for future browser qualification
with before/after SHA and asset checks, no concurrent deployment during a run,
and retain immutable URLs as evidence. Existing immutable URLs cannot be updated
to a new build; their acknowledged stores remain separate and preserved.
No new origin/grant is requested during this already authorized active attempt.

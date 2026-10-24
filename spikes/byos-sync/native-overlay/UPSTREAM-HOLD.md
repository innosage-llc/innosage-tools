# Native Drive discovery HOLD — separate upstream repair proposal

RxDB17.6.0 is unchanged. Replay:

```sh
cd spikes/byos-sync
node native-overlay/run.mjs --fixture=F16
node native-overlay/checkpoint.mjs
```

1. Seed 30 complete documents with identical mock `modifiedTime`; push all 30
   through stock Drive replication. A cold native replica receives only 16/30.
   The remaining 14 are still remote/local durable; this is discovery failure,
   not evidence of deletion. `batchSize=10`, fixed overfetch6, inclusive timestamp
   query and filtering already-seen names eventually return an empty batch.
2. Hide the older of two new remote edits; allow the newer edit to advance the
   cursor. Restore visibility. The older edit remains undiscovered because its
   timestamp is below the advanced cursor. A local overlay cannot repair that.

Minimum separate upstream work: add an adversarial regression first, then use a
provider changes cursor (with its actual retention/visibility contract) or a
fully paginated stable compound cursor with tie-boundary handling. Pagination
alone repairs the same-time overfetch case but does not prove recovery of an
older temporarily invisible file; that needs an explicitly defined rescan/change
feed policy. Preserve native WAL/CAS semantics and re-run both fixtures against
real-provider behavior under separately granted permission. Do not infer Google
consistency guarantees from this mock.

No native fork, downstream patch, hidden fallback or production adoption is
included in #102. The explicit engineering recommendation is HOLD FOR CHECKPOINT
/ NOT SAFE FOR PRODUCT while these replays fail.

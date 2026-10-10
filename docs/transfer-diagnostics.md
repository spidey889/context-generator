# Transfer diagnostics

Extension 1.4.12 attaches one optional JSONB record to `transfers.diagnostics`.
Older attempts retain NULL; their missing observations cannot be recovered.
The existing `failure_reason` and `last_stage` remain compatible.

## First-principles design

| Item | Evidence and decision |
| --- | --- |
| Claimed constraints | One row per attempt and metadata-only collection are product contracts. A separate failure table is a convention. |
| Primitives | Content/worker paths previously collapsed different editor/message errors into `paste_failed`. The stage locates the stop. Captured source size differs from delivered summary size. |
| Discarded assumptions | Verified summary work does not prove capture completeness or delivery. Large capture does not establish a paste cause. Arbitrary error text is not required to distinguish known branches. |
| Rebuild | Record closed error codes at failing branches, operations and bounded observations; pass them through the existing outbox/relay/Edge/RPC. Preserve both prepared and fresh recovery results. |
| Binding residuals | Uninstrumented errors remain `unknown_error`. Lost acknowledgement cannot prove insertion. Client diagnostics are unauthenticated. Historic missing observations remain unknown. |
| Kill test | Reproduce missing editor, restored draft, lost text, focus/remount, acknowledgement loss and recovery; verify distinct observations through restart and real SQL without content or counter changes. |

## Observations

`extension/transfer-diagnostics.js` defines the authoritative closed allowlist.
Tests compare the Edge copy byte-for-byte and the SQL schema against this contract.
Future contract changes require new migrations; applied history stays unchanged.

- **Context:** picker/toolbar entry, Chromium/Firefox family, visibility, online
  flag, elapsed time and remaining deadline. Online is not proof of reachability.
- **Capture:** saved-chat/Speed selection, JSON attempt/fallback category, actual
  capture method, candidate/useful/captured turns, source characters/UTF-8 bytes,
  expanded blocks, retries, sweep advances/stale/quiet checks and exit reason.
- **Summary:** output characters/bytes, local/remote/cache/recovery mode, observed
  HTTP status, request/fetch/parse/service timing, provider passes and fallback.
  Recovered service errors remain separately in `summary_error_code`.
- **Delivery:** prepared reuse/rejection, fresh recovery, tab creation/focus/settle
  timing, message attempts, injections and acknowledgement result. The complete
  first destination record survives in `prepared_diagnostics`; top-level paste
  observations describe the final attempt. Fresh recovery clears the first
  destination's editor/paste fields before observing the new tab, so missing
  observations cannot inherit an earlier draft or editor state.
- **Editor:** kind, observed presence/connection, draft flag/text length, insertion
  method, retry/verification/stability limits, attempts, remounts, populated/stable
  checks and the last editor error even after recovery.

`error_code` identifies the final observed failure, `error_origin` its reporting
component, and `last_operation` its checkpoint. Specific examples include
`editor_missing`, `editor_has_draft`, `paste_not_populated`, `paste_not_retained`,
`paste_focus_changed`, `destination_activation_failed`, `message_reply_missing`,
`message_reply_invalid`, `message_transport_failed` and `message_timeout`.
Unknown exceptions stay `unknown_error`; route/size do not justify reclassification.

Source `events`, worker `delivery_events` and destination `paste_events` use
separate elapsed clocks. Do not concatenate them as an exact global chronology.
Each retains at most 32 entries. Retry storms preserve the first/latest entries,
set `events_truncated`, and retain counters. Producer snapshots retain at most
12 KiB compact ASCII metadata; timeline interiors are trimmed if needed. Relay
and Edge cap requests at 24 KiB UTF-8; SQL checks types, enums, depth, timelines
and a 16 KiB normalized JSONB bound independently.

Absent fields mean **not observed**, not false/zero. No chat/summary text, URL,
selector, account, stack, arbitrary exception/provider text or extra browser
identifier is admitted. Text length is a count. These observations narrow causes;
they do not independently prove native UI behavior or identify a person.

## Persistence and rollout

Progress merges monotonically by pipeline stage. Older progress cannot overwrite
newer observations. First terminal diagnostics freeze with the outcome through
outbox compaction/restart. A NULL terminal record can be filled once by the same
status/stage/reason, never a conflicting terminal report. Late authentic receipts
still upgrade summary/model verification independently, without replaying counters.

Deploy the migration and compatible Edge/Vercel validators before releasing
1.4.12. Defaults on the new sixteenth `p_diagnostics` retain legacy 10–15 argument
RPC calls without ambiguous overloads. RLS/service-role-only access stays private.
Older clients and queued reports without diagnostics remain accepted.

```sql
select attempted_at at time zone 'Asia/Kolkata' as attempted_ist,
       user_no, username, source_platform, destination_platform,
       failure_reason, last_stage,
       diagnostics->>'error_code' as observed_error,
       diagnostics->>'last_operation' as last_operation, diagnostics
from public.transfers
where status = 'failed'
order by attempted_at desc;
```

For unknown errors, reproduce the last operation under recorded conditions. Find
a measurable boundary that separates hypotheses, add a closed observation/code
and regression, and ship it. Never backfill speculative historic causes. A tab or
worker shutdown/storage/network loss can still leave an attempt without terminal
observations; diagnostics do not restore or resume interrupted transfers.

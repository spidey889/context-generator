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
  Updated diagnostics (`diagnostics_revision = 2`) retain `capture_detail`
  (auth/hook unavailable, busy, HTTP/network/JSON failure, incomplete history,
  branch/count/text/canvas/attachment validation, size or timeout), the exact
  `capture_request_stage` and observed `capture_http_status` (100–599).
  All five adapters report structured errors. `capture_error_code`,
  `capture_failure_site` and `capture_error_type` survive successful DOM recovery;
  they describe the JSON attempt, while final failure fields describe the outcome.
- **Summary:** output characters/bytes, local/remote/cache/recovery mode, observed
  HTTP status, request/fetch/parse/service timing, provider passes and fallback.
  Recovered service errors remain separately in `summary_error_code`.
  Backend responses retain the last failed provider's closed
  `summary_failure_detail`, `summary_failed_provider` and observed
  `summary_provider_status`, including HTTP failure, timeout, invalid JSON,
  empty/rejected output or exhausted funded budget. This evidence survives
  provider/direct-carry recovery. It describes the last failed route; it is not
  a complete provider history. `summary_provider_attempts` counts attempted model
  routes when supplied. Local fallback preserves `summary_failure_site` and
  `summary_error_type` separately.
- **Delivery:** prepared reuse/rejection, fresh recovery, tab creation/focus/settle
  timing, message attempts, injections and acknowledgement result. The complete
  first destination record survives in `prepared_diagnostics`; top-level paste
  observations describe the final attempt. Fresh recovery clears the first
  destination's editor/paste fields before observing the new tab, so missing
  observations cannot inherit an earlier draft or editor state.
  Claude transfers also record `claude_page`, a fixed redacted page label such as
  `claude.ai/`, `claude.ai/new`, `claude.ai/chat/:id` or `claude.ai/login`.
  Unknown paths become `claude.ai/other`; subdomains and external sites receive
  fixed labels, never their actual host/path. The worker observes the URL used
  for the prepared-tab check (pending navigation takes precedence) and native
  activation when available; destination observations take precedence at paste.
  A rejected prepared page survives separately in `prepared_diagnostics`.
  `destination_platform_match` and `destination_route_allowed` record the two
  initial guard checks. `destination_message_count` records detected conversation
  messages only when the paste loop actually runs; absence stays unknown.
- **Editor:** kind, observed presence/connection, draft flag/text length, insertion
  method, retry/verification/stability limits, attempts, remounts, populated/stable
  checks and the last editor error even after recovery.

`error_code` identifies the final observed failure, `error_origin` its reporting
component, and `last_operation` its checkpoint. Specific examples include
`editor_missing`, `editor_has_draft`, `paste_not_populated`, `paste_not_retained`,
`paste_focus_changed`, `destination_activation_failed`, `message_reply_missing`,
`message_reply_invalid`, `message_transport_failed` and `message_timeout`.
Unexpected errors in an observed operation use that operation's broad failure
code (such as `capture_json_failed`), `failure_site` and `error_type`. This locates
the failure without claiming a network/auth cause. Where available, `error_file`,
`error_line`, and `error_column` identify the first packaged extension frame.
Only allowlisted filenames and integers are kept from the local stack; the
stack, extension ID and URL are discarded. Wrappers preserve inner evidence.
`document_ready_state` and `destination_tab_status` separate page hydration
observations from editor observations. An error without a known operation/cause
remains unknown; route/size never justify inventing a cause.

Source `events`, worker `delivery_events` and destination `paste_events` use
separate elapsed clocks. Do not concatenate them as an exact global chronology.
Each retains at most 32 entries. Retry storms preserve the first/latest entries,
set `events_truncated`, and retain counters. Producer snapshots retain at most
12 KiB compact ASCII metadata; timeline interiors are trimmed if needed. Relay
and Edge cap requests at 24 KiB UTF-8; SQL checks types, enums, depth, timelines
and a 16 KiB normalized JSONB bound independently.

Absent fields mean **not observed**, not false/zero. No chat/summary text, raw URL,
selector, account, stack, arbitrary exception/provider text or extra browser
identifier is admitted. Text length is a count. These observations narrow causes;
they do not independently prove native UI behavior or identify a person.
The Claude page labels are a closed enum, not arbitrary URL storage: queries,
fragments, chat/project IDs and unrecognized path text cannot enter the payload.

## Persistence and rollout

`capture_method` is reported before capture completes and changes to `sweep`
when DOM scrolling starts. JSON fallback immediately queues the existing safe
failure code, detail, request stage and observed HTTP status. Scraping sends
elapsed time and current counters at most once per 30 seconds from its loop;
failure keeps the elapsed capture time and JSON evidence. No new column or
visible panel is required: these observations remain in `diagnostics`. Final
`character_count` still requires successful capture, and missing historic or
unobserved causes must never be invented. The durable outbox can combine quick
progress updates; the final report retains their observations.

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

For a single attempt, inspect the final code/site/type and safe file/line,
capture detail/request stage/status, summary provider/detail/status and
`prepared_diagnostics`. For example, `capture_session + http_error + 401`
proves the session request was rejected; `editor_missing + editor_wait +
editor_seen=false` means no editor was found within the measured wait.
Online/status/visibility alone do not explain the underlying cause. Anonymous
users' local receipts are not required for the normal diagnostic path.
Historic missing evidence cannot be reconstructed.

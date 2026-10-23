# Transfer diagnostics

Extension 1.4.12 introduced one optional JSONB record to `transfers.diagnostics`.
Older attempts retain NULL; their missing observations cannot be recovered.
The existing `failure_reason` and `last_stage` remain compatible.

Migration `20261013092328` removes the separate `file_size_failure_reason` column.
The database instead stores `failure_reason = "file_size_limit"` when the first
failed outcome reports `conversation_too_large` with the exact
`diagnostics.capture_detail = "attachment_size_limit"`. Existing extension,
relay and Edge payloads keep their current format; the user message stays
“This chat is too long to transfer. Next time, try summarizing it earlier.”
The marker covers qualifying ChatGPT pasted files or DeepSeek text files exceeding
the combined 2.1 MB allowance before downloads. Other size limits keep
`conversation_too_large`. Only historic failed size rows with that exact marker
are reclassified. Recovered causes remain in diagnostics without a failure reason
on successful outcomes; a late diagnostic fill preserves the first terminal reason.
The migration preserves counters, permissions, receipt trust and RPC arguments.
Older backups still restore their captured schema and recompute its generated
column; new backups restore the reason in the existing field.

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

### Server-side provider failures

`public.transfers.diagnostics.provider_failures` is the single home for backend failure observations alongside the existing capture, summary and paste diagnosis. It holds up to 64 errors per transfer, including failures recovered by retry or fallback. There is no separate failure table or new column. The private relay authenticates writes; public clients cannot supply server failure entries. Appends preserve the first terminal outcome, existing diagnosis and counters, including late or duplicate delivery.

Each entry identifies its production/preview/development environment, fixed provider/model, route and HTTP retry, primary/backup key slot, reason and phase: `waiting_headers`, `reading_body`, `waiting_answer`, `answer_stream`, `parsing_response`, `validating_output` or `http_error`. Timeouts distinguish the first-answer watchdog from completion expiry. Counts include input characters, serialized request bytes, output-token allowance, effective time budgets, observed header/answer timing, stream frames and answer/separate-reasoning characters. Actual tokens and finish reason are present only when observed; absent values are unknown. A timeout does not by itself prove queueing, quota exhaustion, poor model quality or a token limit.

The server-generated `request_id` groups failures; `attempt_id` links the supplied transfer. The backend forwards its already-validated transfer context so the existing attempt can be recorded if its started event is still queued. Identity must match; no summary verification is granted. Callers without transfer context cannot save an attached diagnosis and produce a fixed warning instead. Writes overlap fallback, are awaited before shutdown, and get one retry with the same event UUID inside five seconds. An outage or process termination can still lose observations; missing evidence remains unknown. Entries share their transfer's retention and encrypted backup. The former extra table and its separate cleanup job are removed by a forward migration that refuses to discard unmatched historical records.

```sql
select user_no, attempted_at, status, failure_reason, diagnostics
from public.transfers
where diagnostics ? 'provider_failures'
order by attempted_at desc
limit 20;
```

### Client observations

`extension/transfer-diagnostics.js` defines the authoritative closed allowlist.
Tests compare the Edge copy byte-for-byte and the SQL schema against this contract.
Future contract changes require new migrations; applied history stays unchanged.

- **Context:** picker/toolbar entry, Chromium/Firefox family, visibility, online
  flag, elapsed time and remaining deadline. Online is not proof of reachability.
- **Capture:** saved-chat/Speed selection, JSON attempt/fallback category, actual
  capture method, candidate/useful/captured turns, source characters/UTF-8 bytes,
  expanded blocks, retries, sweep advances/stale/quiet checks and exit reason.
  Updated diagnostics (`diagnostics_revision = 3`) retain `capture_detail`
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

### JSON capture observations in 1.4.18

DeepSeek v20 and later hooks add file-download failure details to each existing `json_attempts` entry. `failure_phase` distinguishes a rejected fetch before a response, rejected headers, interrupted body, decoding or parsing. `failure_error_type` is a fixed native error name, never its message. `failure_http_status` belongs to the actual failing request; omit it if no response arrived. The older `http_status` can describe an earlier successful history request and must not be used to infer that a file download succeeded.

The [historical v19 investigation](deepseek-file-failure-investigation.md) confirms that `network_error` with zero file bytes cannot identify the underlying cause. Before reproducing with updated clients, verify the hosted validator accepts the new fields; a source merge alone does not complete their rollout.

`failure_file_index` is a one-based position among unique supported files, with declared `failure_file_bytes`, observed `failure_read_bytes` and per-request `failure_request_ms`. `failure_response_type`, `failure_content_type`, `failure_online` and `failure_abort` use closed labels only. First-failure observations are captured before cancelling siblings and cannot be replaced by their aborts. No file name/ID, signed address, headers, credentials, body or exception prose is included. Browsers may conceal whether a rejected fetch was caused by CORS, redirect policy, DNS or another network failure; these logs preserve what was observed without inventing that cause. Retry, download and scrolling behavior are unchanged. Apply migration `20261023123334_deepseek_file_diagnostics`, then deploy compatible Edge/Vercel validators before updating/reloading the extension. This adds no table or column; existing deployed clients do not emit these fields yet.

The million-character rollout additionally requires `20261023172555_raise_million_character_limits` after that file-diagnostics migration. It raises the provider-failure `input_chars` validator to 1,000,000 and `failure_file_bytes` to 4,100,000. Deploy the matching `transfer-telemetry` Edge function before the larger-chat backend/extension; otherwise new diagnostics can be rejected by the older hosted validators. These are existing-validator updates, with no new tables or columns.

`diagnostics_revision = 3` adds optional `json_attempts` (at most two flat records):
the current source's accepted picker read or fresh read, then the existing one
temporary-error retry if used. Discarded or stale picker reads never create a
transfer report. The same records survive every destination, DOM recovery,
summary/paste errors, prepared-tab recovery and durable outbox restart.
`diagnostics.version` stays 1; old clients and queued records remain valid.

| Observation | Meaning |
| --- | --- |
| `outcome`, `mode`, `adapter_version` | `succeeded`/`partial`/`failed`/`cancelled`; `prefetch`/`fresh`/`retry`; actual hook version when observed |
| `failure_check`, `failure_stage` | First closed guard label before wrappers/cancelled sibling downloads can erase it |
| `failure_value`, `failure_limit`, `failure_value_source` | Exact comparison, with `content_length`, `reader_bytes`, `declared_files`, `string_length` or `utf8_bytes` |
| `raw_bytes`, `raw_limit_bytes` | Bytes actually received by owned readers, including a rejected excess chunk; original native budget |
| `raw_response_bytes`, `raw_response_limit_bytes`, `raw_response_stage` | Response with the highest observed budget fraction, paired with that response's effective allowance and stage |
| `raw_header_bytes`, `raw_header_limit_bytes`, `raw_header_stage` | Highest advertised budget fraction; absence means no observed numeric Content-Length |
| `history_bytes`, `session_bytes`, `descriptor_bytes`, `file_body_bytes` | Breakdown of received bytes. File bodies already belong to `raw_bytes` |
| `files_supported`, `files_declared_bytes`, `files_downloaded_bytes`, `files_limit_bytes` | Unique supported selected-user downloads in DeepSeek/ChatGPT; declared sum and actual received body bytes. Only these adapters have the separate 4,100,000-byte download budget |
| `files_ignored`, `files_ignored_pdf`, `files_ignored_image`, `files_ignored_other` | Descriptor occurrences skipped by the selected-branch file loops; coarse labels only. No recursive search through native metadata |
| `transcript_chars`, `transcript_bytes`, `transcript_char_limit`, `transcript_byte_limit` | Final JS String.length units and UTF-8 bytes against 1,000,000 and 4,000,000. Bytes stay absent when the earlier character check rejects |
| `history_items`, `selected_turns`, `requests`, `pages`, `auth_refreshes` | Native items (Gemini pairs, Grok/ChatGPT nodes, DeepSeek/Claude messages), captured messages, owned requests, Gemini pages, ChatGPT session refreshes. ChatGPT groups consecutive assistant blocks as one reply for this count while preserving each payload block |
| `hook_ms`, `auth_ms`, `download_ms`, `parse_ms`, `serialize_ms`, `total_ms`, `deadline_ms`, `http_status` | Observed durations and native/bridge deadline/status. Concurrent file work and auth/download intervals can overlap; do not sum them into a global timeline |

The size labels distinguish `raw_header_limit`, `raw_total_stream_limit`,
`raw_response_stream_limit`, `raw_remaining_files_limit`, `supported_files_limit`,
`transcript_char_limit` and `transcript_byte_limit`. ChatGPT keeps its existing
32,000,000-byte aggregate/history allowance and 6,000,000-byte auxiliary-response
allowance; the other four adapters also allow 32,000,000 bytes. These transport budgets
are separate from the final transcript, supported-file and summary-request limits.
The new labels do not change ChatGPT's existing incomplete classification for
raw-history/file-body excess. Unsupported PDF/image bodies are not fetched by
these file loops; any bytes already embedded in history still count as raw.
Claude's supported pasted cards are already inline: their declared bytes/counts
are observed, with zero extra file download bytes and no invented file budget.

Only numeric fields and closed labels are accepted. Missing measurements stay
absent. Values above the integer telemetry ceiling saturate at 2,147,483,647 with
`numeric_saturated: lower_bound`; this does not change capture limits. Envelope
limits remain 12/16/24 KiB. Adding an array name alone is insufficient: the JS
contract/byte-identical Edge copy and SQL validator independently validate every
attempt key, type, enum and the two-record bound.

MAIN uses generated `json-capture-metrics-main.js`; isolated bridges use the
canonical `transfer-diagnostics.js` and `json-capture-metrics.js`. Distinct filenames
avoid the missing-helper setup reproduced in Brave with reused filenames across
worlds. Rebuild with `node scripts/build-json-capture-metrics.js` after changing
either input; tests enforce bundle parity and both manifest/on-demand paths.

Rollout: apply `20261014075318_json_capture_attempt_diagnostics.sql`, then
`20261014080744_json_capture_transport_check_labels.sql`, deploy `transfer-telemetry`
with the matching shared allowlist, and deploy the relay's imported contract
before distributing the extension. No table, column or RPC argument was added.
Version remains **1.4.18** at the owner's request.

For the guarded live browser round trip, run the ChatGPT history-failure smoke
with `CAP_CONTEXT_JSON_SMOKE=chatgpt`, `CAP_CONTEXT_CHATGPT_FAILURE_SMOKE=history-oversize`,
`CAP_CONTEXT_TELEMETRY_SMOKE=1` and `CAP_CONTEXT_LIVE_TELEMETRY_SMOKE=1`.
The installed worker calls the production relay directly and mirrors only its
telemetry reports/status locally for assertions. This scenario submits no summary,
provider request or fabricated receipt. It intentionally writes synthetic failed
transfer records to production; ordinary smoke runs remain local.

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

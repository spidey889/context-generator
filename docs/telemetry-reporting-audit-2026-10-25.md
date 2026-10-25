# Transfer reporting audit — October 25, 2026

Reporting is best effort; the existing system cannot prove that every initiated
transfer reached Supabase. This audit found and repaired specific silent-loss
paths without introducing a new database schema or changing transfer outcomes.

## Scope and evidence

Traced the source's intent/progress/terminal messages through worker persistence,
retry/restart, `/api/telemetry`, the private Edge handler, receipt verification,
`record_transfer_event`, provider-failure appends and user counters. Reviewed
queue capacity/expiry, identity conflicts, rejection classification, source
reload/tab closure, draft recovery, model attribution and privacy boundaries.

The hosted project was inspected read-only. Edge `transfer-telemetry` version 24
matches all six corresponding repository files after newline normalization.
Current receipt/model/diagnostic contracts remain compatible. Public tables have
RLS enabled and intentional service-only access; the two no-policy INFO notices
are expected. No production rows, functions, schema or settings were changed.

## Confirmed defects and repairs

| Failure | Previous behavior | Repair |
| --- | --- | --- |
| Local queue write rejects | Final event could disappear before an active snapshot was saved; the source did not resend it. | Preserve an explicitly pending copy in the existing active store and replay it at startup/retry. |
| Receipt saved only in session | A valid summary receipt survived, but no outbox revision was recreated without later source activity. | Replay the pending receipt independently, preserving original identity/version and observed summary completion. Never infer paste completion. |
| Optional session reads fail | Restoration failure prevented otherwise healthy local queue delivery. | Let the durable local queue drain and retain fixed storage-failure warnings. |
| Unexpected HTTP 200/202 or redirect | Any HTTP success could be treated as a committed report and removed. | Require the Edge/relay's explicit HTTP 204 acknowledgement; refuse redirects and omit worker cookies. Provider logging retries and warns within its existing deadline. |
| Rejected message acknowledgement | Invalid source events received `{ok:true}` although nothing was queued. | Return a negative acknowledgement for invalid/conflicting events and failure of both stores. |
| Bounded fallback/provider capacity | New session fallback copies needed loss accounting; provider logging silently ignored observations after its cap. | Prefer pending outcomes/receipts, diagnose fallback expiry/overflow and emit one fixed provider-capacity warning. |

The fallback marker is cleared after an outbox commit, not after network delivery.
A crash between commit and marker cleanup may replay a revision; existing
idempotent database writes prevent duplicate outcomes/counters. Recovered copies
retain first-terminal-wins, signed proof/model/version pairing, metadata-only
validation and the existing retention/capacity limits.

## Hosted observations

- 83 retained transfers and 26 current users; 22 transfers have verified summary
  work. Every retained successful transfer has a model.
- Two old version-1.4.20 attempts remain `started`: capture on October 19 UTC and
  paste on October 20 UTC. Their actual final outcomes cannot be recovered from
  available telemetry. The earlier source-reload repair is present in current
  code; it does not reconstruct old outcomes.
- Three retained transfer installs have no current user row, with cleared labels.
  Current users' joined transfer labels have no mismatches.
- Four lifetime counters exceed what the remaining transfer rows explain:
  current users total 85 summaries, versus 30 countable retained attempts. The
  owner confirmed repeated manual transfer/user table cleanups during this audit.
  These differences therefore cannot establish an ingestion/counting defect.
  No historical counts, identities or outcomes were rebuilt or reset.
- The daily reset job is active at `30 18 * * *` UTC, midnight IST. Its retained
  history contains 97 successful runs and no failed runs.
- Hosted migration names differ from local replay: `file_size_in_failure_reason`
  is local-only; `allow_clipboard_destination` is hosted-only. Several older
  migrations also have different timestamps. Hosted size diagnosis still retains
  the generated `file_size_failure_reason = 'file size'` column and the original
  detail in diagnostics. No size evidence is missing because of that layout;
  moving the label/removing the column is a separate schema decision. Do not
  blindly push or repair migration history.
- Recorder RPC requests in the inspected recent log window returned HTTP 204.
  Request logs count retries/progress and cannot count unique source attempts
  or prove that an absent browser request ever reached ingress.

## Remaining limits

| Boundary | What can still be missed |
| --- | --- |
| Before worker persistence | Source messaging is fire-and-forget. A destroyed extension context, worker/browser crash or rejected/never-settling storage operation can lose an event before a durable copy exists. |
| Both stores unavailable | Neither queue nor active-store fallback can save a report. No network acknowledgement or invented outcome can recover that missing observation. |
| Session fallback | Normally six minutes, extended by the owning operation's existing deadline; session storage survives worker restart, not a full browser restart. Expired/evicted pending copies are diagnosed locally when cleanup can run. |
| Local outbox | 500 compacted attempts and seven-day retention. Capacity/expiry can discard reports with bounded local diagnostics. Clearing browser/extension storage or uninstalling can erase them. |
| Backend provider observations | Five-second delivery window, one retry and 16 pending observations per request; SQL retains at most 64 per transfer. Outage/process termination can still lose logs. Warnings are not a permanent central delivery ledger. |
| Intentional compaction | Quick progress snapshots and bounded timelines are combined; every intermediate observation is not a separate permanent event. |
| Existing evidence | `started` means no terminal report received. Authenticated summary work does not prove complete capture or successful paste. Manual table deletion prevents historical reconciliation. |

These limits are disclosed rather than presented as a guarantee of complete
reporting. Eliminating them would require a separately approved durability and
central monitoring design, not a guessed backfill or a new failure label.

## Verification and release boundary

New regressions reproduce the previous failures and cover fallback restart,
receipt replay without source completion, privacy, negative acknowledgements,
capacity/expiry accounting, no endless replay and the exact HTTP acknowledgement.
Existing checks cover sticky outcomes, late proof/model upgrades, source reload,
tab closure, retry/backoff, legacy receipts and duplicate counters.

Run the focused telemetry/provider/diagnostic tests, the regular suite, real local
migration replay and `CAP_CONTEXT_TELEMETRY_SMOKE=1 npm run test:extension-smoke`.
The latter exercises installed Brave → actual relay → actual Edge handler → real
local SQL, checking one verified count and a drained outbox without production
data or provider calls. Required GitHub Offline checks run on the final commit.

This branch is not a production release. Backend changes need a deployed relay;
worker changes need an updated/reloaded extension. No Supabase migration or Edge
deployment is required for these reporting fixes.

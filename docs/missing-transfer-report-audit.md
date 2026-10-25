# Missing final transfer report audit

## Historical evidence

- Attempt: `8a19dede-5348-4b43-b52a-e64fd0299584`, anonymous install/user 22, DeepSeek → Grok, extension 1.4.20.
- Started October 20, 2026 at 06:45:01 IST (`01:15:01.133Z`). Last received report: `01:15:03.751217Z`.
- JSON capture succeeded: 10 turns, 7,579 characters, no supported files. Capture took 22 ms.
- The local carry was ready in 1 ms. No remote summary provider was involved.
- Last source observation: `paste_start`, 284 ms into the attempt. Stored status remains `started` / `paste_started`; no paste acknowledgement or final error was retained.
- The retained Supabase logs from `01:14–01:25Z` contain two telemetry-function responses and two recorder-RPC responses, all HTTP 204. PostgreSQL entries in that window have normal LOG severity and SQL state `00000`.
- This install has no later transfer in the retained table. These records do not establish whether it reloaded, navigated, closed the browser, lost the worker or encountered another client issue. They do not prove paste success or failure.

## Reproduced current defect

The source sends the final outcome only after the background delivery reply and source completion/activation work. The worker retains progress and handles source **tab closure**, but previously had no handler for replacing the source **document** while keeping the tab open.

A reload destroys the old source callback. Its tab ID survives, so the worker's existence check still passes. A pending transfer can continue and the server can retain only its last `started` report. A regression seeded at `paste_started` reproduced this missing terminal report before the fix.

This is a confirmed reporting/cancellation gap worth fixing. It is a possible explanation for the historical record, not a recovered cause for that user's browser.

## Change and boundaries

- Observe Chrome's native source-tab `loading` event, cancel its owned work immediately and retain the interruption through the existing durable telemetry queue.
- Record `failed` / `client_interrupted` with `conversation_changed`, preserving the last observed stage, model and identity. This is an interrupted transfer, not evidence that a paste failed or succeeded.
- Ignore destination loading and unrelated tab updates. Preserve completed reports, existing unknown-on-expiry behavior and attempts started after the event.
- Keep tab-closure cancellation, first-terminal-wins, queue retry/receipts, draft protection, no-Send behavior and all existing transfer deadlines.
- No table/column/validator changes, hosted writes or historical backfill.
- Worker/browser crashes, cleared session state and storage failures can still prevent an unpersisted result from being recovered. This change does not implement automatic transfer resumption or infer a historical outcome.

## Verification

- The source-reload telemetry regression failed before the fix and passed after it.
- Focused tests cover retained progress, terminal protection, different source/destination ownership, post-event attempts and existing tab-close/expiry behavior.
- An isolated Brave test starts a real transfer, holds its summary response open, reloads the source document and verifies the worker's accepted interruption report, aborted network read and untouched old destination. A second real transfer from the new document succeeds without replacing the first outcome.
- The browser test uses synthetic data and a local backend; it does not spend provider quota or write production transfers. CI runs this scenario through `CAP_CONTEXT_SOURCE_RELOAD_SMOKE=1`.

## Permission-preserving follow-up — October 25

Source-tab closure retains `user_cancelled` / `source_tab_closed`; source document
loading retains `client_interrupted` / `conversation_changed` and
`source_changed: true`. Chrome's loading event covers reload/navigation; it does
not identify which user gesture caused it. Only active transfer ownership is
considered, not unrelated browsing.

The existing native Tabs events require no new manifest permission. The manifest
and host access remain unchanged; there is no new visible UI or permission
request. See [Chrome's Tabs API permissions](https://developer.chrome.com/docs/extensions/reference/api/tabs#permissions).

An optional active-store restoration rejection previously suppressed these
reports even when this worker retained a valid snapshot and local delivery was
healthy. The follow-up uses that still-live, identity-matched snapshot, with
expiry/terminal/newer-attempt protections. Regressions reproduced both missing
reports before the fix and now verify delivery plus expiry protection.

The existing Brave scenario now also starts a third, uncached summary and closes
the actual source tab. It checks the distinct closure diagnosis and aborted
summary. Both refresh and closure reports pass through the actual relay/Edge
handler into the local migrated database, while the transfer between them still
succeeds. No synthetic production rows are created. Whole-browser crashes or
unavailable persistence cannot guarantee a final report.

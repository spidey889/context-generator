# User notices

To send a notice, upsert `public.user_notices` in the existing Cap Context Supabase project (`iqkzynzxbmemhtiupwwu`), using private operator database access:

```sql
insert into public.user_notices (user_no, message)
values (49, 'Your transfer should work now. Give it another try :)')
on conflict (user_no) do update set message = excluded.message
returning user_no;
```

Use the existing `users.user_no` number and exact message. The primary/foreign key allows one current message per existing user; an unknown number fails instead of allocating a user. Keep messages nonblank and within 1,000 JavaScript UTF-16 units (an emoji can count as two). Other users' rows stay unchanged. Messages are plain text, including literal markup; never put credentials or chat contents in them.

When the owner gives a number and message, validate them, execute the upsert through `supabase db query --linked --project-ref iqkzynzxbmemhtiupwwu` and verify the stored row and targeted `/api/user-notices` response. Use a SQL file with `--file` for complex text and escape SQL quotes correctly; never interpolate unescaped message text into a shell command. A normal send needs no code edits, tests, commits, merges or deployments. Do not claim the user saw it merely because the database/API contains it: there are no delivery receipts.

The storage move preserves the exact live messages for #1 and #49. Existing hashes and the original #49 local seen flag remain recognized, so migration does not resend them.

## Delivery

The worker POSTs only the existing installation UUID to `/api/user-notices`. An exact Vercel rewrite dispatches to the separate notice module through the existing telemetry API entry, keeping within the project's twelve-function limit. The existing private telemetry relay resolves `users.user_no`, then reads only that number's `user_notices.message`; the client cannot choose a user number. RLS has no client policies, and anon/authenticated have no table grants. Edge's service role has SELECT only; operator access writes messages. The read neither creates users nor changes counters or transfer diagnostics. Vercel returns only the matched notice. Existing relay configuration is reused; the database key stays in Edge.

A visible supported chat with a ready composer checks through the worker. The worker shares a five-minute cache across tabs and restarts; failed requests retry after one minute. Composer/visibility changes and a lifecycle-owned one-minute timer give an already open page another opportunity. Hidden tabs, sign-in pages, active transfers, the picker, handoff and copy/recovery notices wait. A refused display stays pending. Firefox diagnostics opt-out prevents installation-linked notice checks.

The notice uses the fallback-copy confirmation's existing glass material, 80px top/20px right position, right-side entrance, exit animation, reduced-motion behavior and ten-second lifetime. It says “Cap Context” above the exact message and offers only Dismiss. It does not focus the page, touch the composer, send a chat or include text in transfer diagnostics.

The stable notice ID hashes the user number and exact message. Changing the text makes a new notice; reusing identical text keeps the same ID and does not show it again. Delivery is serialized across tabs, with IDs retained in local extension storage across page/browser/worker restarts. The cache is tied to the installation UUID so an identity change cannot reuse another user's message. A reservation is persisted before display to avoid repeats if the acknowledgement is lost; explicit refusal or a definitely absent recipient releases it. A crash between reservation and display can therefore lose a notice rather than repeat it. Clearing extension storage resets local delivery history. There is no server delivery/read receipt.

Removing a row stops future successful fetches from returning it. An already fetched, unseen message can still display while offline; removing a row does not recall it. This is a small current-message system, not an inbox or a guaranteed delivery queue.

## Storage rollout (one time)

1. Back up/restore-check the existing database, apply `20261101170000_user_notices.sql`, and copy the exact current live messages into the table. Keep historical migration-number differences separate; never use `--include-all` to replay unrelated SQL.
2. Deploy `transfer-telemetry` with the new optional `include_message: true` lookup. Number-only requests remain supported so the old Vercel backend works during rollout or rollback.
3. Deploy the updated Vercel notice module once. Its extension-facing response and stable hash are unchanged; existing notice-compatible extensions need no update. Remove the old JSON source rather than retaining two sources of truth.

Backups include `user_notices`; older snapshots without the table remain restorable.

## Verification

The focused tests in `test/user-notices.test.js` cover authenticated database targeting and replacement, once-only delivery and later messages, uncertain acknowledgements, privacy/failure handling, and legacy/installation history. Database replay covers the actual table's bounds, foreign key, upsert, grants/RLS, unchanged counters and backup restoration. The existing background/content tests cover sender boundaries, visible-page gating, exact text, Dismiss and expiry.

`node scripts/run-user-notices-smoke.js` runs the actual unpacked extension in a new isolated Brave window. Synthetic lookups and a backend-only message change exercise automatic delivery, the real fallback Copy confirmation, matching notice styles/transitions, literal text, Dismiss, ten-second expiry, no-repeat after reload and another user's exclusion. It runs in regular browser CI. Optional `CAP_CONTEXT_NOTICE_SCREENSHOT_DIR` saves comparison screenshots outside the repository.

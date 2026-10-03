# Cap Context database audit — October 3, 2026 (IST)

Scope: hosted `cap-context-telemetry` (`iqkzynzxbmemhtiupwwu`), current source,
recorded migrations, ingestion and recovery. The application schema is small and
clean after migration twenty-four. Tests were initially deferred under the owner's
instruction; the requested final merge check subsequently verified them below.
`LOGIC.md` is the current production contract; this
document records the audit evidence and remaining policy limits.

## Findings and changes, in priority order

| Finding | Result |
| --- | --- |
| Four transfer timestamps exceeded the current debugging/reporting needs | Migration twenty-three removes updated_at, completed_at, summary_received_at and terminal_received_at. First-failure IST attribution uses the identical transaction timestamp directly, without storing it. |
| First-install name allocation could wait across midnight after sampling the counter date | Fixed: reserve allocation before sampling the IST day; existing users still lock their row first. |
| Backup checks ignored the captured cron configuration | Fixed in recovery tooling: restore and compare captured IDs, schedule, command, active state, connection target and owner in a local catalog. Older snapshots without cron metadata remain supported. |
| Optional recovery upgrades could insert an older missing migration out of order | Fixed: require an explicit upper boundary and refuse backdated gaps before applying future migrations. Default restoration uses captured history only. |
| Separate transfer status check repeated the outcome constraint | Removed only the weaker duplicate. NOT NULL status plus the outcome constraint still rejects every other status and invalid stage/reason combination. |
| Empty-chat failures invoked counter code and took locks despite contributing nothing | Counter-trigger conditions now exclude unverified `no_conversation`; the transfer diagnostic remains stored. Verified work remains countable independently of paste. |
| Edge exported a stage-selection helper unused by production | Removed the helper and its two obsolete assertions; SQL still owns monotonic progress. No runtime behavior or wire contract changed. |
| Unique Naruto name pool has forty entries | Automatic allocation fails and the whole RPC rolls back when all forty canonical names are occupied; extend the pool before exhaustion. Migration twenty-four allows only user No. 1 to use the owner's exact `naruto` alias, leaving forty canonical slots while that alias is used. |
| Unsigned failures and install IDs are client-supplied | Kept current anonymous reporting. They can be fabricated; signed receipts authenticate completed summary work, not users/paste/failures. Rate limits bound volume, not identity. |

## Final application inventory

| Object | Purpose |
| --- | --- |
| `transfers` — 13 columns | One mutable metadata row per attempt; attempt primary key, route, outcome/stage/reason, size/version, attempted_at, trusted received_at reset boundary and authenticated summary state/time. No conversation content. |
| `users` — 7 columns | Installation key, visible number/name, lifetime summaries, daily summaries/failures and internal IST date. |
| `record_transfer_event(...)` | The stable retry/upsert RPC; immutable attempt ownership, monotonic progress, first terminal outcome and first proof remain sticky. |
| `preserve_transfer_event_invariants()` | Guard direct writes as well as RPC updates; capture first terminal/proof receipt times. |
| `record_user_summary()` | Count only first verification/failure transitions, preserve the reset boundary, attribute IST days and catch up late resets. |
| `assign_user_identity()` | Serialize new-install numbering/name allocation; transactional max+1 prevents rollback gaps. |
| `naruto_user_names()` | Forty predefined names shared by allocation and the membership constraint, with a separate exact `naruto` exception only for user No. 1. |
| Four triggers | Transfer guard, insert/update counter transitions, and user identity allocation; no unused trigger remains. |
| Four transfer indexes | Attempt PK, recent date, install/date history and status diagnostics. All have observed usage; no redundant identity/install-only index remains. |
| Three users indexes | Number PK, unique installation and unique name; each serves a distinct invariant/access path. |
| `users_user_no_seq` | Retained identity-column machinery and historical backup state; it does not control visible max+1 numbering. |
| One active cron job | Job 1 at `30 18 * * *` on the GMT scheduler, clearing daily counters at 00:00 IST; historical runs are retained. |
| Twenty-four migrations | Hosted and local histories align; earlier recorded migrations are unchanged. The never-applied activity view remains outside the active folder. |

There are no public views, obsolete analytics tables, duplicate RPC overloads,
staging users tables, incoming foreign keys or application Realtime publication
entries. A users foreign key would be incorrect: empty, unsigned and pre-reset
attempts can legitimately exist without a counted user row.

## Intentionally retained protections and compatibility

- RLS is enabled; `anon`/`authenticated` cannot read/write application tables or
  execute application functions. Service-role table privileges are limited to
  SELECT/INSERT/UPDATE, with sequence usage and necessary function execution.
  All five functions are security invokers with empty search paths.
- The public RPC name/signature/defaults are stable. Current Edge sends all
  thirteen arguments, while ten/eleven-argument maintenance callers still work.
  Renaming internal historical SQL labels would add migration churn without
  removing runtime complexity.
- V1 unknown-day proofs, V2 signed dates, unsigned diagnostics and absent older
  client timestamps remain meaningful compatibility. Distinct timing fields
  prevent confusing offline delivery with occurrence or verification time.
- The original reset cutoff stays `2026-10-02 10:17:02.952495+00`; removing it
  could restore intentionally cleared test counts through delayed old reports.
- Checks/guard/RPC validation protect different boundaries. Closed stage/route/
  failure values, nonnegative counters, no-number names and proof/outcome
  consistency remain enforced. Future pool changes must preserve existing names
  and revalidate the membership constraint.
- Managed Auth, Storage, Realtime, Vault schemas and standard platform extensions
  are retained. Removing them is not application cleanup. Application postgres
  defaults are private; managed-owner defaults remain a platform boundary.

## Verification evidence and limits

The migration-twenty-two before/after inspection confirmed identical complete row hashes for all
592 transfers and the one users row. User numbering/sequence, the original
cutoff, other function bodies, table/function security and cron configuration
are unchanged. Counters reconcile exactly with retained post-reset transfers.
No invalid application indexes or active duplicate jobs were found.

The actual reset job succeeded at **00:00 IST, October 3**, updating one user.
Performance advisors are clear. Security advisors contain only the intentional
[RLS-with-no-policy INFO notices](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)
for service-only tables. JavaScript syntax and Git diff checks passed; independent
static review found no blocker. Encrypted pre/post exports outside Git passed
DPAPI byte-roundtrip checks.

The initial audit updated regression coverage without running tests, restores or
browser/HTTP probes. The subsequent final merge check ran the checks below.
Recovery scheduling uses a local catalog shim; captured-job restoration is not
proof of a managed-project restore. The forty-name capacity and anonymous failure
trust boundary remain explicit product limits, not hidden schema defects.

## Final merge check — October 3

- Fixed two runtime review findings: optional telemetry storage errors could
  block/discard summaries, and Edge calendar validation accepted September 31
  while Vercel rejected it. Four storage fault regressions reproduced against
  the previous commit and pass after the fix; date parity coverage now rejects
  invalid attempted, completed and signed-completion timestamps.
- Final source passed 433 deterministic tests and a fresh installed Brave smoke
  run through the actual local relay/Edge handlers and all 22 SQL migrations,
  with one verified count and a drained outbox. Three long capture tests and
  296 SQL checks also passed, including preservation, counters, permissions,
  IST reset behavior and backup cron recovery.
- Actual encrypted pre-cleanup and current exports restored locally with exact
  data and captured cron preservation: 591 transfers/one user at migration 20,
  and 592 transfers/one user at migration 22. Decrypted bytes stayed in memory.
- No hosted table changes, production probes, live-provider evaluation or
  multi-session midnight reproduction were performed for this merge check.
  The Edge validator source fix has not been separately deployed.
- At that point merge approval was withheld: fetched `origin/master` at `04001f8` had nine
  unique commits and produces 17 file conflicts against this branch. Resolution
  must retain master's transfer deadlines, approved picker trails/website link
  and simulated-clock regressions alongside this branch's inline placement and
  database/telemetry work. The combined result needs its own verification.
  No merge was performed. Branch pushes do not match the regression workflow's
  `master`/`codex/**` filters; a PR targeting `master` runs that code gate.

## Timestamp simplification — October 3 follow-up

Migration twenty-three removes exactly `updated_at`, `completed_at`,
`summary_received_at` and `terminal_received_at`, plus their three obsolete table
checks. Retained values and all 592 rows are preserved. `received_at` and the
original reset cutoff still exclude old test attempts; `summary_verified` and
the first signed `summary_confirmed_at` remain sticky and count work once.

The failure counter now uses `transaction_timestamp()` on the first failure
transition. This equals the removed terminal receipt's `now()` value. The
current IST day is still sampled with `clock_timestamp()` after the existing
user/allocation locks, preventing a wait across midnight from attributing an old
failure to today. Daily reset/catch-up behavior and empty-chat exclusion remain.

The RPC keeps all thirteen arguments/defaults, accepting and ignoring the legacy
`p_completed_at`; Edge/Vercel/worker payloads remain compatible. No client update
or Edge deployment is required. Existing attempts update only for meaningful
progress, first outcome or first verification. Historical failure/progress/end
timing is deliberately unavailable in the smaller table, with removed values
preserved in the encrypted pre-change export.

Verification passed: 433 deterministic tests, 348 SQL checks across all 23
migrations (52 new cutover checks), installed Brave through actual local
relay/Edge handlers into SQL, and exact encrypted pre/post backup restoration.
The actual pre-change export also upgraded through only migration twenty-three,
preserving every retained value and user. Hosted rolled-back checks passed legacy
completion metadata, duplicate outcomes/proofs, failed-paste verification,
v1/delayed summary days, empty chats, frozen reset cutoff, ownership rejection and
catch-up reset. Retained transfer hashes, full users hash, sequence, table
identity/RLS/grants and cron settings remain identical. No unrelated table was
modified. Controlled local clocks cover both sides of IST midnight and a wait
across it; an actual multi-session midnight wait was not reproduced.

## Combined branch verification — October 3

Merged master `04001f8` into `supabase-flash` and resolved all seventeen conflicts.
The combined code keeps the latest picker visuals/link, enforced transfer deadlines,
simulated-clock tests and documentation cleanup, along with the database branch's
five-platform inline placement and signed, durable, private telemetry. All 23
migration files and database/API ingestion implementations are unchanged from the
verified database branch. No hosted data/schema, reset cutoff or cron was changed.
The owner's earlier explicit data reset is separate from this integration.

Verification passed: 318 deterministic tests, the ordered sixteen-turn simulated
scroll regression, 348 SQL migration/invariant checks, and isolated installed-Brave
transfer through the actual local relay/Edge handlers into SQL with one verified
count and a drained outbox. New checks cover expired summary/transfer/activation,
request abortion, untouched destination drafts, website-link keyboard wrapping,
lightning motion/toggle/reduced motion and 390/320px picker fit. Retained cancelled
attempt metadata permits late server receipts without rewriting paste outcomes.
The lower test count follows master's intentional consolidation; SQL coverage is
preserved. Deadline errors now retain their code across activation/warmup and a
storage wait cannot begin an already-expired summary request.

This verifies the combined source and controlled runtime, not a new production
deployment, live-provider evaluation or fresh native-account capture. The Edge
validator correction still needs its normal deployment. Existing forty-name and
anonymous-failure trust limits remain unchanged.

# Cap Context database audit — October 3, 2026 (IST)

Scope: hosted `cap-context-telemetry` (`iqkzynzxbmemhtiupwwu`), current source,
recorded migrations, ingestion and recovery. The application schema is small and
clean after migration twenty-two. Tests were initially deferred under the owner's
instruction; the requested final merge check subsequently verified them below.
`LOGIC.md` is the current production contract; this
document records the audit evidence and remaining policy limits.

## Findings and changes, in priority order

| Finding | Result |
| --- | --- |
| First-install name allocation could wait across midnight after sampling the counter date | Fixed: reserve allocation before sampling the IST day; existing users still lock their row first. |
| Backup checks ignored the captured cron configuration | Fixed in recovery tooling: restore and compare captured IDs, schedule, command, active state, connection target and owner in a local catalog. Older snapshots without cron metadata remain supported. |
| Optional recovery upgrades could insert an older missing migration out of order | Fixed: require an explicit upper boundary and refuse backdated gaps before applying future migrations. Default restoration uses captured history only. |
| Separate transfer status check repeated the outcome constraint | Removed only the weaker duplicate. NOT NULL status plus the outcome constraint still rejects every other status and invalid stage/reason combination. |
| Empty-chat failures invoked counter code and took locks despite contributing nothing | Counter-trigger conditions now exclude unverified `no_conversation`; the transfer diagnostic remains stored. Verified work remains countable independently of paste. |
| Edge exported a stage-selection helper unused by production | Removed the helper and its two obsolete assertions; SQL still owns monotonic progress. No runtime behavior or wire contract changed. |
| Unique Naruto name pool has forty entries | Kept the requested policy. The forty-first counted install cannot be allocated and its whole RPC rolls back; extend the pool before reaching capacity. |
| Unsigned failures and install IDs are client-supplied | Kept current anonymous reporting. They can be fabricated; signed receipts authenticate completed summary work, not users/paste/failures. Rate limits bound volume, not identity. |

## Final application inventory

| Object | Purpose |
| --- | --- |
| `transfers` — 17 columns | One mutable metadata row per attempt; attempt primary key, route, outcome/stage/reason, size/version, distinct client/database/signed timing. No conversation content. |
| `users` — 7 columns | Installation key, visible number/name, lifetime summaries, daily summaries/failures and internal IST date. |
| `record_transfer_event(...)` | The stable retry/upsert RPC; immutable attempt ownership, monotonic progress, first terminal outcome and first proof remain sticky. |
| `preserve_transfer_event_invariants()` | Guard direct writes as well as RPC updates; capture first terminal/proof receipt times. |
| `record_user_summary()` | Count only first verification/failure transitions, preserve the reset boundary, attribute IST days and catch up late resets. |
| `assign_user_identity()` | Serialize new-install numbering/name allocation; transactional max+1 prevents rollback gaps. |
| `naruto_user_names()` | Single predefined name pool shared by allocation and the membership constraint. |
| Four triggers | Transfer guard, insert/update counter transitions, and user identity allocation; no unused trigger remains. |
| Four transfer indexes | Attempt PK, recent date, install/date history and status diagnostics. All have observed usage; no redundant identity/install-only index remains. |
| Three users indexes | Number PK, unique installation and unique name; each serves a distinct invariant/access path. |
| `users_user_no_seq` | Retained identity-column machinery and historical backup state; it does not control visible max+1 numbering. |
| One active cron job | Job 1 at `30 18 * * *` on the GMT scheduler, clearing daily counters at 00:00 IST; historical runs are retained. |
| Twenty-two additive migrations | Hosted and local histories align; recorded migrations are unchanged. The never-applied activity view remains outside the active folder. |

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

Read-only before/after inspection confirms identical complete row hashes for all
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
- Merge approval is withheld: fetched `origin/master` at `04001f8` has nine
  unique commits and produces 17 file conflicts against this branch. Resolution
  must retain master's transfer deadlines, approved picker trails/website link
  and simulated-clock regressions alongside this branch's inline placement and
  database/telemetry work. The combined result needs its own verification.
  No merge was performed. Branch pushes do not match the regression workflow's
  `master`/`codex/**` filters; a PR targeting `master` runs that code gate.

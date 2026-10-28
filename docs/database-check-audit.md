# Database check audit: original checks 1-100

Reviewed against `41fd38b` in execution order in
`scripts/check-verified-telemetry-db.js`. These are the first 100 counted
assertions, ending at the forced composite-index query plan, before the first
backup restore or migration-specific helper. Numbers below refer to that
original order, so later removals do not shift the audit references.

Removed 21 assertions and their unused fixture work; retained 79. This is a
test-only cleanup. SQL migrations, hosted data, backup formats and production
behavior are unchanged. All 52 migrations still replay.

| Original checks | Decision | Reason or retained protection |
| --- | --- | --- |
| 1 | Remove | Reproduced the deliberately broken pre-fix terminal state. A historical defect is not behavior to preserve; failure/success immutability remains tested after the fix and after table cleanup. |
| 2-3 | Keep | Original transfer/user identity and pre-cutover counter baseline survive the historical migration. |
| 4-5 | Remove | Null values in retired `completed_at` and `terminal_received_at` columns. The full-row migration/backup snapshots still preserve historical data. |
| 6-7 | Keep | Existing verified work must not become legacy work or acquire a fabricated signed confirmation time. |
| 8 | Remove | Null value in retired `summary_received_at`; column removal and legacy payload acceptance have dedicated coverage. |
| 9 | Keep | Both unsigned current and old-client reports cannot create verified summary counters. |
| 10-12 | Keep | Genuine proof counts once; a duplicate proof changes neither counters nor the stored outcome. |
| 13-16 | Keep | Conflicting terminal reports preserve status, stage, failure reason and character count. |
| 17-18 | Remove | The same conflict matrix for retired completion/receipt columns. Later cleanup tests exercise ignored legacy timestamps and retained-row immutability. |
| 19-20 | Keep | A failed paste can independently acquire verified summary work, counted once. |
| 21-22 | Keep | A success cannot be overwritten by failure or counted twice. |
| 23-24 | Keep | Progress cannot regress; failure keeps its actual terminal stage. |
| 25-28 | Keep | RPC replays cannot change installation, attempt time, source or destination. |
| 29-37 | Keep | Negative size, inconsistent status/stage/reason and invalid proof/time combinations fail. |
| 38-39 | Keep | Malformed inserts cannot bypass constraints by conflicting with an existing row. |
| 40 | Remove | Mutation protection for the generated `id`, which the table cutover intentionally removes. The attempt primary key remains protected. |
| 41-46 | Keep | Direct service-role writes cannot change owner, attempt, version, receipt identity or terminal status/stage. |
| 47 | Remove | Direct mutation of retired `completed_at`. Dedicated cleanup coverage proves legacy timestamp payloads are ignored. |
| 48-49 | Keep | Direct writes cannot revoke proof or rewrite its signed confirmation time. |
| 50-51 | Keep | Delayed and unknown-day proofs affect lifetime and daily counters correctly. |
| 52-53 | Remove | Calculations in deleted daily-usage and reporting views. Stored counters and signed-day behavior remain covered here and in the IST verifier. |
| 54-55 | Remove | Constraints on retired receipt columns. Their deliberate removal and legacy RPC compatibility are checked by the cleanup verifier. |
| 56-59 | Remove | The removed outcome view's 24-hour classification and its fixture-only state/counter assertions. Current terminal stickiness and unsigned accounting remain covered. |
| 60 | Keep | The historical scheduled job exists before backup and upgrade checks. |
| 61-64 | Remove | Superseded UTC schedule/reset behavior and the deleted reporting view's reset distinction. Real IST scheduled SQL, delayed ingestion, inactive-day reset and midnight boundaries are checked later. |
| 65-66 | Keep | Stored daily counters cannot be negative or exceed lifetime totals. |
| 67-69 | Keep | An upgraded worker can confirm an old attempt without rewriting its first extension version. |
| 70-79 | Keep | Anonymous-role denial of private tables/views, future objects, sequence, RPC and direct proof writes. |
| 80-89 | Keep | The same independent privilege boundary for the authenticated role. |
| 90-95 | Keep | The service role cannot delete/truncate history or gain implicit access to future objects. |
| 96 | Keep | Explicit service-role access to the historical usage view remains available for captured-schema recovery. |
| 97-98 | Keep | No public policies and RLS enabled on both historical application tables. |
| 99 | Remove | Absence of an old single-column index adds no query-path proof beyond the retained forced composite-index plan. Table/index preservation is also checked at later cutovers. |
| 100 | Keep | The retained composite index supports filtering by install and ordering by attempt time. |

The retained counterparts are in `check-minimal-users-db.js`,
`check-users-ist-db.js`, `check-transfers-db.js`,
`check-minimal-transfers-db.js`, the view-removal cutovers in the main verifier,
and `check-telemetry-backup.js`. Historical migration replay and bounded backup
upgrades are retained; an old check is not redundant merely because it is old.

Verified baseline: 1,645 counted assertions across 52 migrations. After this
audit: 1,624, all passing locally with the same input normalization. The Windows
checkout needs an LF-only disposable test input
for the existing checkpoint migration's exact function-body comparison; the
normal CI checkout verifies the unmodified migration chain directly.

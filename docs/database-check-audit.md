# Database check audits

## Original checks 1-100

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

## Original checks 101-300

Continued from `5fe09cf`, using the original numbering from `41fd38b`.
The first pass left 79 assertions, so this batch corresponds to execution
positions 80-279 in the 1,624-check baseline. Instrumented the existing local
verifier to confirm the boundary before editing; backup helpers' internal
uncounted assertions are not part of these numbers.

Removed 37 of these 200 assertions; retained 163. Removing the duplicate empty
chat fixtures also eliminates two later generated backfill assertions for those
same installations. The allocation verifier still creates dedicated started,
local and empty legacy fixtures and checks zero counters and complete linking.
No later verifier was edited for that incidental reduction.

| Original checks | Area | Removed | Retained protection |
| --- | --- | --- | --- |
| 101-106 | Mixed-format backup upgrade | 0 | Row preservation, migration bounds/counts and captured-job behavior. |
| 107-147 | Users reset | 7 | Reset boundary, rollback-safe numbering, signed/unsigned counting, real pool exhaustion, restore definitions/jobs and private access. |
| 148-166 | Users formatting | 4 | Transactional refusal, rows/counters/sequence/history/counter-body/job preservation, valid names, allocation and grants/RLS. |
| 167-190 | IST cutover | 8 | Real trigger reconciliation, midnight receipts, duplicate/unknown-day work, ingestion rollover and scheduled resets. |
| 191-201 | Empty-chat counter cutover | 1 | Historical cleanup, preserved real failures, repeated reports and insert/update behavior. |
| 202-213 | Three reporting-view removals | 0 | Dependency refusal, actual removal, data/sequence/counter/job preservation and service access. |
| 214-277 | Transfer-table cutover | 12 | Complete rows/schema/ACLs/policies/functions, primary key, backup upgrade/custom jobs, bounded replay, terminal/proof behavior and old RPC arities. |
| 278-290 | Counter/constraint cleanup | 4 | Data/security/cutoff preservation, lock ordering, actual invalid-status refusal and empty/real/repeated/proof/rollover outcomes. |
| 291-300 | Start of timestamp cleanup | 1 | Dependency rollback, retained state/schema, frozen cutoff, lock ordering and remaining field checks. |

### Removal decisions

| Original checks | Why removed | Stronger or current coverage retained |
| --- | --- | --- |
| 113-114 | Static uniqueness plus shape/size of the superseded 129-name pool. | Full real allocation checks every distinct name and visible number; the next migration tests replacement by the smaller pool. |
| 125 | Aggregate in a deleted reporting view. | Signed/delayed/unknown-day stored counters remain checked. |
| 126-128 | Superseded UTC reset and ingestion behavior. | Actual IST scheduled SQL and both rollover paths remain in the IST and timestamp-cleanup helpers. |
| 140 | Pool row count repeated before the next transaction-refusal check. | Full-pool distinct allocation, overflow rejection and the next migration's rollback row count remain. |
| 158-159 | Fixed pool cardinality and absence of a temporary implementation table. | Valid retained/replaced names, complete public users schema, real allocation and migration refusal remain. |
| 161 | Renamed counter read through a deleted reporting view. | The same real write's stored lifetime/daily/failure counters are asserted immediately before it. |
| 163 | Another old UTC scheduled-reset sample. | IST scheduled resets retain the supported behavior. |
| 173-174 | Substring searches for time-function spelling. | Actual trigger outcomes and explicit post-lock midnight cases remain. |
| 178-180 | Constant PostgreSQL date conversions in three session timezones. | These did not invoke application SQL. Real IST boundary receipts and clock-substituted production trigger cases remain. |
| 184-185, 190, 196 | Deleted view aggregates and view-specific configuration. | Stored counters, private table access and all three safe view-removal migrations remain checked. |
| 218 | Fixed old column count. | Complete column metadata before/after the cutover is already compared. |
| 223 | Extracted cutoff repeated after exact full counter-body equality. | Full definition equality already includes that cutoff. |
| 229-230 | Unique-index and trigger implementation counts. | Exact primary-key columns establish uniqueness; actual progress/accounting and exact schema/security preservation remain. |
| 240 | SHA-256 output shape regex. | Real custom/disabled job restoration and the backup helper's contents/hash validation remain; hex formatting alone adds no application coverage. |
| 247, 250, 262 | Parsing, freezing and direct mutation of retired receipt timestamps. | Later removal/legacy timestamp acceptance tests and current terminal/proof immutability remain. Check 251 still asserts verified proof and signed confirmation, without the retired receipt-field conjunct. |
| 253 | Repeated counter assertion for a duplicate proof at an intermediate cutover. | Duplicate row immutability remains here; duplicate signed-accounting checks remain in the timestamp-cleanup and current receipt verifiers. |
| 265-267 | Repeated empty insert/update fixtures after a counter-preserving table rename. | Earlier empty-chat cutover, full row preservation during rename, and later timestamp-cleanup empty outcomes remain. |
| 281-284 | Obsolete constraint name, trigger count and trigger-definition substrings. | Actual invalid status and all relevant empty/real/repeated/proof/rollover transitions remain directly below. |
| 297 | Literal transaction-time expression search. | The helper executes the production counter at controlled before/after-midnight receipt and wall-clock times. |

Kept the complete anonymous/authenticated/service-role permission matrices,
all backup restores and all 52 migrations. Checks after original 300 are not
part of this pass; the rest of the timestamp-reference loop is left intact.
Only verifier scripts and this audit changed.

Validation: baseline 1,624; after cleanup 1,585, all passing through the same
LF-normalized local SQL input described above. This pass is committed on the
local `codex/db-next200-audit` worktree branch and is not pushed or merged.

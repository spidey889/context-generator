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

## Original checks 301-700

Continued locally from `75082f4`. Traced this batch with the original
`41fd38b` verifier sources, including assertions emitted by the diagnostics
sample helper. Later JSON-checkpoint helpers have bulk counters outside this
batch and do not affect its boundary. Two repeated backfill assertions were
already eliminated by the preceding fixture cleanup, leaving 398 assertions
from this original 400-check range in the 1,585-check baseline.

This pass reduces those 398 assertions to 259: 139 fewer counted checks.
Most of the reduction combines positive assertions while retaining all their
values, rather than discarding behavior. No privacy rejection sample, signed
receipt scenario, application counter boundary, backup restore, or role/access
matrix was removed. The user-name allowlist guards were explicitly retained
during review because valid generated names alone would not prove that invalid
names still cannot be written.

| Original checks | Area | Before this pass | After | Retained protection |
| --- | --- | --- | --- | --- |
| 301-338 | Remaining timestamp cleanup | 38 | 37 | Legacy timestamps, frozen proof/outcomes, backups, permissions and actual before/after-midnight trigger execution. |
| 339-373 | Served-model cutover | 35 | 31 | Transactional dependency refusal, full preserved state, model placement, immutable attribution, malformed models and all old RPC arities. |
| 374-390 | Reusable display names | 17 | 14 | More than two pools of real allocations, sequential numbers, valid names, complete pool use, signed/old-client counting, allowlist guards and private access. |
| 391-395 | Space Bunny label | 5 | 4 | Exact all-row relabeling, queued/direct canonicalization and immutable verified model. |
| 396-412 | Reported versus verified model | 17 | 15 | Unverified reports, receipt upgrade/priority, sticky proof, counters and invalid combinations. |
| 413-425 | User-label synchronization | 13 | 13 | Backfill, rename, spoof correction, counter stability and deletion/truncation synchronization. |
| 426-469 | Allocation and backfill | 42 | 30 | Every installation and counter, existing users, rollback, repeated reports, pool overflow, labels and both restricted roles. |
| 470-590 | Initial diagnostics | 121 | 42 | Every accepted field in one complete record; all malformed/prepared negative cases, persistence, immutability and legacy calls. |
| 591-616 | Local transfer counting | 26 | 25 | Cutoffs, repeat migration, duplicates, late proof, local/server accounting, rollover and grants. |
| 617-642 | Claude-page diagnostics | 26 | 16 | Exact full enum schema, boundary acceptance, root/prepared private-page rejection, numeric and boolean guards. |
| 643-695 | Typed failure diagnostics | 53 | 27 | All enum boundaries in two complete records; every root/prepared privacy rejection, numeric limits, unknown keys and access rules. |
| 696-700 | Start of draft recovery | 5 | 5 | Migration/relabel preservation and authentic handled outcomes with independent summary accounting. |

### Consolidations and removals

| Original checks | Decision and retained counterpart |
| --- | --- |
| 302 | Remove the names/count of constraints on retired columns; exact column cleanup, dependency rollback and real legacy-payload writes remain. |
| 341, 344, 346-347 | Remove temporary staging-table absence, a fixed intermediate column count and RPC overload count. Full schema/data/security snapshots, dependency failure and actual calls at every historical arity remain. |
| 375, 379, 384 | Remove the old unique-name constraint spelling, a repetition assertion implied by valid names across more than two complete pools, and a general identity-uniqueness assertion. Exact allocation numbers and all-row identity/label behavior remain. Name allowlist constraints (385) stay. |
| 395 | Remove the old label's global zero count: exact relabeled snapshots plus the new-write/direct-update checks already establish it. |
| 411-412 | Remove another counter read after rejected atomic statements and a repeated overload count. Receipt/unsigned counter checks, direct proof rejection and actual legacy API calls remain. |
| 434-446 | Replace per-install zero-counter assertions with one SQL result containing every missing installation and all three counters. The comparison still requires the entire expected identity set; none are sampled. Two original installations were already absent from the previous cleanup, so this consolidation saves ten assertions in this pass. |
| 461, 467 | Remove the aggregate uniqueness restatement and a read immediately after explicit deletion. Sequential numbering, failed-allocation rollback, label linking and recreation with zero replayed counters remain. |
| 476-555 | Replace 80 one-field positive samples with one record containing all 80 fields and their same values. The validator visits every key, exact schema parity remains, and every malformed/negative sample stays separate. |
| 613 | Remove `assert.ok(reset)` before executing `reset.command`: missing jobs already fail that execution, and actual reset counters remain asserted. |
| 621-630 | Drop interior positive enum examples while keeping first/last page values and equality of the complete SQL/JavaScript enum schema. All eight root/prepared private-page rejection cases remain. |
| Positive cases within 646-685 | Combine 28 first/last enum-value acceptance samples into two complete root-and-prepared records. All seven fields and both boundary values are still included. Each negative root/prepared sample remains separate, along with HTTP bounds, fractional numbers, private stacks and access checks. |

Validation: all 1,446 database assertions pass across the same 52 migrations,
using the existing LF-normalized local input. JavaScript syntax and diff checks
also pass. Only test verifiers and this audit change; production files and SQL
migrations are unchanged. This remains a local commit on the same worktree
branch, with no push or merge.

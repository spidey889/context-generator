# Local database check audit

Reviewed on 2026-10-24 on `supabase-checks`, starting from `92251b3`. Scope: `npm run test:db`, its migration-boundary verifiers and synthetic backup recovery. Hosted Supabase was not read or changed. Historical migration SQL and the backup verifier itself remain unchanged.

## Changes and coverage

The suite reports **1,227 checks instead of 1,238**. Thirteen overlapping assertions were removed and two preservation assertions added to broader fixtures, for eleven fewer reported checks. These are individual assertions, unlike the named Node tests in the regular suite.

| Repeated work removed | Coverage retained in |
| --- | --- |
| Second default restore of the old transfer table: four assertions | The minimal-users restore already checks old-table rows, original function/view definitions, reset boundary and no pending migrations. It now also captures and checks cron jobs. The rename upgrade separately hashes all original columns before its explicit cleanup. |
| Standalone generated file-label restore: one assertion | The file-size migration upgrade first restores and hashes the original generated label, then checks its permitted removal and reason reclassification. Both old spellings still run their migration and RPC checks. |
| Another default restore just after the file-size migration: one assertion | One complete-current-schema restore retains those file-size rows together with provider diagnostics, after all 48 migrations. |
| Recorder → Edge → historical provider-table retry integration: six assertions | The final provider-diagnostics fixture exercises recorder → actual Edge handler → SQL with a lost acknowledgement. The old table still tests its own service/public grants, RPC idempotency, pruning and three-table backup recovery. |
| Intermediate provider-diagnostics restore: one assertion, moved | The same row-hash preservation assertion now runs at the complete 48-migration schema instead of before the final validator migrations. |

Backup restores drop from **11 to 8**: mixed CLI/MCP history with bounded upgrades; old-schema reset/functions/views/cron; transfer-table rename upgrade; custom disabled/extra cron jobs; timestamp-removal upgrade; generated-label/remapped-reason upgrade; historical provider-failures table; and full current-schema recovery. Each restore still creates a separate database and replays its captured migrations. No completed database state is shared or cached.

## Fixture efficiency

- Exercise one current and one legacy unsigned report instead of 50 repetitions. Keep the same no-verification assertion and both RPC arities. One conflicting duplicate receipt proves sticky proof/count behavior; repeated identical deliveries remain covered elsewhere.
- Fill the complete 129-name historical pool in one SQL insert. Every inserted row still runs the actual allocation trigger, constraints and next-number logic. The exhaustion and later smaller-pool refusal checks remain.
- Keep all 83 sequential RPCs that fill more than two current name pools, but switch into the restricted service role once for that block. Signed upgrades, duplicate counting, legacy arity and public-role rejection remain distinct checks.
- Keep all privacy/validator matrices, real migration boundaries, data/security preservation, counter/reset/IST edges, rollback checks and final receipt/Edge/SQL integration. Stateful operations remain sequential.

## Validation and timing

The updated full database suite passed all **1,227 checks across all 48 migrations**. Regular, slow and browser suites are outside this change; they were not rerun. The local cron shim checks scheduled SQL, not hosted scheduling or concurrent sessions.

Profiling the main replay database shows SQL queries reduced from 1,457 to 1,264 and exec/control calls from 1,037 to 748, excluding SQL inside separate backup databases. Restore count is measured separately above. Profiling artifacts stay ignored under `.test-artifacts/db-audit/`.

Two alternating pairs on Node 24.22.1 / PGlite 0.5.8 measured:

| Pair | Original suite | Updated suite |
| --- | ---: | ---: |
| 1 (original first) | 12.20 s | 8.06 s |
| 2 (updated first) | 10.28 s | 7.94 s |
| Mean | 11.24 s | 8.00 s |

That is about **29% faster locally**. Every run passed its expected count. Original source ran from an ignored copy of the same commit; updated files stayed in place throughout. Earlier cold/profiling runs varied from 27 to 56 seconds, so this paired result is not a CI or full-gate speed guarantee.

# Telemetry database operations

Only target **cap-context-telemetry** (`iqkzynzxbmemhtiupwwu`). The thirteen active migrations are forward-only and preserve existing rows, UUIDs, user numbers and lifetime counters. The first ten files match the originally recorded production SQL; never edit them. The archived activity-view migration was never applied and must stay outside the active migration folder.

## Persistence and reporting

- transfer_events stores metadata, never chat or summary text. attempt_id is unique. The first terminal status/stage/time is sticky. Core attempt/install/time/route identity is immutable. extension_version is the first observed client version; legitimate RPC reports from an upgraded worker remain accepted.
- completed_at is a client clock for diagnosis. terminal_received_at and summary_received_at are database receipt times. summary_confirmed_at is a signed server completion time. Historical missing times stay NULL; receipt time must not be presented as occurrence time.
- summary_verified is promoted only after Edge verifies a server receipt. A claimed successful paste without a receipt does not increment counters. A verified summary with a failed paste counts once. Ten/eleven-argument RPC callers remain accepted through optional defaults.
- users.total_summaries preserves the old lifetime total plus verified additions. legacy_total_summaries labels the frozen unverified baseline. Installs are not distinct people. today_summaries retains its UTC midnight reset contract; only timestamped completions occurring today increment it. Delayed yesterday delivery and v1 proofs do not inflate today.
- Prefer service-only user_summary_usage and verified_summary_daily_usage for reports. They separate legacy totals, verified totals, unknown occurrence days and dynamic UTC daily counts. transfer_event_outcomes labels stale started events unknown after 24 hours without rewriting them as failures. It includes installs that never produced a verified summary; user_summary_usage only includes the existing users table population.

Raw metadata is deliberately retained at the current small volume. There is no automatic event deletion, invented historical verification or stale-row failure backfill. Any future retention change must preserve counter provenance and reporting. The worker queue is best-effort, bounded to 500 attempts/seven days, with diagnosed drops and permanent rejection quarantine; diagnostics do not retain replayable rejected payloads.

## Access and deployment order

RLS is enabled on both tables with no client policies. anon and authenticated cannot access tables, views, sequences or RPC. service_role receives explicit SELECT/INSERT/UPDATE and necessary sequence/RPC permissions, without DELETE/TRUNCATE. Functions are security invoker with empty search paths; reporting views use security invoker. New objects created by the application postgres role default private. Hosted postgres cannot change platform-owned supabase_admin defaults: application migrations must run as postgres, never impersonate the managed owner.

Vercel and Edge require the same private TELEMETRY_RELAY_SECRET and TELEMETRY_SIGNING_KEY (at least 32 UTF-8 bytes). A publishable key alone cannot invoke the Edge writer. Existing unsigned extension reports remain diagnostics through the Vercel relay. The summary response includes both legacy v1 and timestamped v2 receipts. Current keys must remain stable while seven-day retry queues can contain receipts; future key rotation needs verification-key overlap or a drained queue, not an immediate destructive replacement.

Deploy in this order: backup/restore check → migration dry run → additive migrations → matching backend/Edge secrets → Edge → Vercel → extension. During an Edge/backend relay-secret mismatch, requests return a retryable configuration failure; durable queue entries survive it. Never ship proof-producing code to an old validator/schema. Roll back code with the updated compatible validator/schema retained, rather than dropping new columns or rewriting migration history.

```powershell
supabase migration list --project-ref iqkzynzxbmemhtiupwwu
supabase db push --project-ref iqkzynzxbmemhtiupwwu --dry-run --skip-vault
supabase db push --project-ref iqkzynzxbmemhtiupwwu --skip-vault
```

The dry run must list only intentionally new migrations. Do not use --include-all to bypass unexplained drift or manually mark unexecuted SQL applied. Check CLI help if flags change. CLI 2.118.0 authenticated successfully for the October 2 deployment; the older September login limitation no longer describes this machine.

The standalone install index was removed after hosted EXPLAIN confirmed the retained (install_id, attempted_at) index supports recent per-install history. Primary UUID IDs, unique attempt IDs and other useful time/status indexes remain. Additional indexes/materialized counters are unnecessary at current volume; measure a real query first.

## Backup and verification

scripts/backup-telemetry.ps1 exports both application tables, the user-number sequence, recorded migration SQL, public function definitions and cron jobs in one consistent query. It encrypts the artifact with Windows DPAPI outside Git and verifies the saved bytes decrypt correctly. DPAPI recovery needs the same Windows credential/profile context; retain that context or re-encrypt under your off-device backup policy. This is an application recovery export, not a full managed-project/Auth/Storage/PITR backup. The hosted backup list currently exposes no available physical restore points or PITR.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/backup-telemetry.ps1
# Decrypt only into a temporary location outside this repository:
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/backup-telemetry.ps1 -DecryptPath "$env:LOCALAPPDATA\CapContext\telemetry-backups\snapshot.dpapi.json" -OutputPath "$env:TEMP\telemetry-restore.json"
$env:PGLITE_MODULE_PATH = '<temporary install>/node_modules/@electric-sql/pglite'
node scripts/check-telemetry-backup.js "$env:TEMP\telemetry-restore.json"
Remove-Item -LiteralPath "$env:TEMP\telemetry-restore.json"
```

CI installs pinned PGlite 0.5.8 temporarily, then runs scripts/check-verified-telemetry-db.js: real migration replay, malformed writes, legacy callers, first-terminal invariants, proof counting, delayed daily attribution, privileges/defaults, sequence preservation and retained index plans. The cron catalog shim tests the actual scheduled SQL; hosted scheduling and concurrent sessions are checked separately after deployment.

CAP_CONTEXT_TELEMETRY_SMOKE=1 npm run test:extension-smoke adds installed Brave worker → actual Vercel handler → actual Edge handler → real local SQL, including proof/counter/outbox assertions. Both normal and database smoke route telemetry locally, never to production. scripts/check-live-telemetry.mjs is an explicit production probe with synthetic fixtures and a private manifest; inspect its events/counters and remove only those exact fixtures afterwards using an owner session. Production service credentials intentionally cannot delete data.

Post-deployment checks: migration history parity; original row/ID/counter preservation; unsigned success uncounted; verified duplicates counted once across simultaneous requests; failed paste independent from summary completion; v1 unknown-day/v2 UTC day; identity rejection; direct Edge denial; grants/RLS/advisors; cron schedule and recent successful runs. Check both HTTP and stored state: a 204 alone cannot establish correct counters.

The managed PostgreSQL 17.6 installation needs the platform's 17.11 security patch rollout. Review [upgrade eligibility and downtime](https://supabase.com/docs/guides/platform/upgrading) in the project settings; an application SQL migration cannot install that managed engine patch. No blind pause/restore is part of this deployment. See [Supabase backups](https://supabase.com/docs/guides/platform/backups) for managed recovery options.

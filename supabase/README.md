# Telemetry database migrations

Production target: **cap-context-telemetry** (`iqkzynzxbmemhtiupwwu`). Never use these migrations against another project.

## Recorded history

`migrations/` contains the ten migrations recorded on this project as of 2026-09-29. Their versions, names, order and SQL match `supabase_migrations.schema_migrations`. The missing initial table migration was restored from that record; the users-table migration was restored to its originally deployed SQL, with its later permission fix retained in the next migration.

The Supabase migration tool assigned `20260929070051` to the already-applied `user_cancelled` fix and `20260929071047` to the already-applied authenticated-role grant revoke. Keep those filenames; restoring the former July cancellation filename would create a second pending copy of the same fix. This reconciliation changed local files only, without rewriting live history or reapplying SQL.

`archive/20260718172212_add_user_transfer_activity_view.sql` was never recorded on production and references the retired `analytics_users` table. It is retained only as historical source, outside the active migration folder. Do not replay it.

## Before a future database push

Inspect the exact project and migration list before applying new database work:

```powershell
npx supabase migration list --project-ref iqkzynzxbmemhtiupwwu
npx supabase db push --project-ref iqkzynzxbmemhtiupwwu --dry-run --skip-vault
```

The dry run should list only intentionally added new migrations; after this reconciliation there are none. `--skip-vault` keeps the dry run scoped to migrations. Do not use `--include-all` to bypass an unexplained history mismatch. Do not manually edit the migration-history table or mark unexecuted SQL as applied; first compare recorded versions and statements with the files. Recheck CLI help if its flags change.

### Reconciliation verification (2026-09-29)

- Compared every active filename, version, name and SQL statement with the authenticated plugin's live migration-history query: all ten matched, with no pending local or missing remote migrations.
- Replayed all ten files on a fresh local PostgreSQL engine, then checked all thirteen accepted failure reasons, unknown-reason rejection, service-role RPC access, client table denial, monotonic stages and success retry counting. PGlite used a local `pg_cron` catalog shim; this did not test scheduled execution or the hosted Supabase gateway.
- The existing telemetry suite passed 12/12. CLI 2.118.0's remote dry run could not run without its separate access-token login; exact history parity was verified through the plugin instead. Future CLI access still requires `supabase login`.

## Live telemetry contract

`transfer-telemetry` version 6 accepts `user_cancelled`, matching the extension, Vercel validator and database constraint. The database permits the twelve previous failure reasons plus cancellation. Deploying that validator required widening the database constraint first so existing retry queues could drain.

`anon` and `authenticated` have no table privileges on `transfer_events` or `users`. `service_role` retains its existing table grants and EXECUTE on `record_transfer_event`; RLS and policies were not changed. The function uses the existing publishable-key check and service-role RPC credentials.

To undo only the grant revoke, as an explicitly approved new migration:

```sql
BEGIN;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
ON TABLE public.transfer_events TO authenticated;
COMMIT;
```

For a function rollback, redeploy the previous function source while keeping the widened failure-reason constraint. Queued cancellation reports and stored rows remain compatible with that constraint.

## Pending security migration: verified summary counters

`20261002000000_count_only_verified_summaries.sql` is new and has **not** been applied to the production project above. The ten recorded migrations remain unchanged. This migration preserves historical counter values and starts requiring server confirmation for future increments; it cannot establish the provenance of old values.

The public `status` and `last_stage` fields describe a **client-reported paste outcome**. They must not be used as verified summary totals. `summary_verified` describes completed server summarization and is computed only in the edge handler from a signed receipt. The `users` counters increment on its first false-to-true transition, even if a paste failed. Installation IDs remain anonymous, caller-generated IDs, not authenticated people. Someone can still automate real summary requests or submit false diagnostic outcomes; this fix prevents unsigned claims alone from incrementing verified summary/user counters.

### Rollout order

1. Review and apply only the new migration to **cap-context-telemetry** (`iqkzynzxbmemhtiupwwu`) after comparing migration history and the dry-run output. Never replay old migrations, the archive, or use `--include-all` to hide mismatches. The migration switches counting off for unsigned events immediately; the previous edge function remains compatible via the RPC's default `p_summary_verified=false`.
2. Configure the same high-entropy, private `TELEMETRY_SIGNING_KEY` in **Vercel's server environment** and **Supabase Edge Function secrets**. Use at least 32 random bytes (64 hex characters is suitable). Generate and enter it securely; never put it in the extension, repository, logs, or chat. A publishable Supabase key is not a signing secret. Missing/short keys fail closed for counting and do not prevent summaries or legacy diagnostic delivery.
3. Deploy `transfer-telemetry` with `handler.mjs`, `validation.mjs`, and `../_shared/summary-proof.mjs`, then deploy the Vercel summary code. The shared proof file must also be included in the Vercel function bundle; the literal dynamic import in `api/summarize.js` is the dependency.
4. Package/release the updated extension background code with a new store version. Older extensions still transfer and drain diagnostic retries, but do not supply the summary context needed for confirmations. Cached/shared requests count the backend summary once; repeated cached pastes and entirely offline carries remain unverified client outcomes.
5. Validate one real summary and its signed stage event, confirm `summary_verified=true` and one counter increment, replay that event and confirm no additional increment, then submit an unsigned success and confirm no verified increment. No live validation or deployment was performed during development.

Receipts bind the attempt, installation, original timestamp, route and extension version. They omit conversation/summary content and do not expire, so durable offline retries remain usable while the signing key is unchanged. The attempt UUID deduplicates confirmations. Rotating the signing key invalidates outstanding old receipts; coordinate rotation with the retry backlog. These receipts prove server summary completion, not a human identity or a verified browser paste.

### Local migration check

The normal Node suites test the API, signature handling, actual edge request handler, and extension receipt/cache behavior. An additional isolated PostgreSQL check is available without touching production:

```sh
npm install --prefix /tmp/cap-context-db-check --cache /tmp/cap-context-npm-cache --no-audit --no-fund --package-lock=false @electric-sql/pglite@0.3.14
PGLITE_MODULE_PATH=/tmp/cap-context-db-check/node_modules/@electric-sql/pglite node scripts/check-verified-telemetry-db.js
```

It replays all eleven migrations and checks forged successes, valid confirmations, duplicates, late confirmation after failure, identity mismatch, legacy defaults, and anon/authenticated denial. It supplies Supabase's default service-role table grants and a local `pg_cron` catalog shim; hosted gateway behavior and scheduled execution are not covered.

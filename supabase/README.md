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

begin;

-- Supabase grants public-schema objects automatically on older projects.
-- Application migrations run as postgres: make future exposure opt-in.
-- EXECUTE to PUBLIC is PostgreSQL's global function default. A schema-only
-- REVOKE cannot override it, so remove that global default for this owner too.
alter default privileges for role postgres revoke execute on functions from public;
alter default privileges for role postgres in schema public
  revoke all on tables from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke all on sequences from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke all on functions from public, anon, authenticated, service_role;

-- The hosted postgres role cannot change supabase_admin's managed defaults.
-- Do not impersonate that platform role or modify managed schemas. CI and
-- application migrations must run as postgres and grant access explicitly.
revoke all on table public.transfer_events, public.users from public, anon, authenticated, service_role;
grant select, insert, update on table public.transfer_events, public.users to service_role;
revoke all on sequence public.users_user_no_seq from public, anon, authenticated, service_role;
grant usage on sequence public.users_user_no_seq to service_role;

-- Hosted EXPLAIN already chooses the composite index for recent per-install
-- history. Its leading install_id also serves equality lookups; keep UUID IDs.
drop index public.transfer_events_install_id_idx;

notify pgrst, 'reload schema';
commit;

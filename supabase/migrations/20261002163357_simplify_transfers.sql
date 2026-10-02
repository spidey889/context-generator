-- One mutable row per attempt, not an append-only event log. Keep the deployed
-- record_transfer_event RPC and payload contract so older installs still work.
begin;
set local lock_timeout = '10s';
lock table public.transfer_events in access exclusive mode;

do $functions$
declare
  rpc_sql text := pg_get_functiondef('public.record_transfer_event(uuid,text,timestamptz,text,text,integer,text,text,text,text,boolean,timestamptz,timestamptz)'::regprocedure);
  guard_sql text := pg_get_functiondef('public.preserve_transfer_event_invariants()'::regprocedure);
begin
  if position('public.transfer_events' in rpc_sql)=0
    or position('row(new.id, new.attempt_id' in guard_sql)=0
    or position('row(old.id, old.attempt_id' in guard_sql)=0 then
    raise exception 'Unexpected transfer persistence definitions';
  end if;
  -- attempt_id is already immutable/unique. The second generated UUID has no
  -- application consumer or relationship; its original values remain in backup.
  execute replace(replace(guard_sql,
    'row(new.id, new.attempt_id', 'row(new.attempt_id'),
    'row(old.id, old.attempt_id', 'row(old.attempt_id');
  execute replace(rpc_sql, 'transfer_events', 'transfers');
end;
$functions$;

-- Restrictive DDL: an unexpected FK/view dependency aborts the transaction.
-- Promote the existing unique attempt key rather than inventing a new identity.
alter table public.transfer_events drop constraint transfer_events_pkey;
alter table public.transfer_events drop column id restrict;
alter table public.transfer_events drop constraint transfer_events_attempt_id_key;
alter table public.transfer_events rename to transfers;
alter table public.transfers add constraint transfers_pkey primary key (attempt_id);

-- Keep catalog labels aligned with the renamed table. The table itself is not
-- rebuilt, preserving all remaining row values, RLS, grants and trigger links.
do $labels$
declare item record;
begin
  for item in select conname from pg_constraint
    where conrelid='public.transfers'::regclass and conname like 'transfer_events_%' loop
    execute format('alter table public.transfers rename constraint %I to %I',
      item.conname, replace(item.conname, 'transfer_events_', 'transfers_'));
  end loop;
end;
$labels$;
alter index public.transfer_events_attempted_at_idx rename to transfers_attempted_at_idx;
alter index public.transfer_events_install_id_attempted_at_idx rename to transfers_install_id_attempted_at_idx;
alter index public.transfer_events_status_idx rename to transfers_status_idx;
alter trigger transfer_events_preserve_invariants on public.transfers rename to transfers_preserve_invariants;
alter trigger transfer_events_insert_record_user_summary on public.transfers rename to transfers_insert_record_user_summary;
alter trigger transfer_events_update_record_user_summary on public.transfers rename to transfers_update_record_user_summary;

comment on table public.transfers is 'One metadata-only row per transfer attempt. attempt_id is the primary/retry key; progress advances and the first terminal outcome is sticky. No transcript, summary text or URL.';
comment on column public.transfers.attempt_id is 'Single immutable transfer identity shared by extension, signed receipt and retries; replaces the unused generated row UUID.';
comment on column public.transfers.install_id is 'Stable installation key linking user counters; installations are not distinct people.';
comment on column public.transfers.attempted_at is 'Client attempt start time, used in immutable receipt identity and diagnostic timing; never authoritative for daily counters.';
comment on column public.transfers.received_at is 'First database receipt time; preserved users-reset cutoff boundary and client/server delivery diagnostics.';
comment on column public.transfers.updated_at is 'Last meaningful progress/outcome/verification update. Duplicate retries do not refresh it; stale started rows are not proof of failure.';
comment on column public.transfers.status is 'Current started/succeeded/failed state. First terminal state is immutable; empty-chat failures remain diagnostics but do not count against users.';
comment on column public.transfers.last_stage is 'Furthest reported pipeline stage while started; frozen at the first terminal outcome to show where a transfer failed.';
comment on column public.transfers.failure_reason is 'Closed safe failure code, present only for failed attempts; no arbitrary error content.';
comment on column public.transfers.character_count is 'Captured input size when known; useful for size-related failure diagnosis without storing conversation text.';
comment on column public.transfers.summary_verified is 'Authenticated summary work counted once independently of paste success; true with NULL summary_confirmed_at supports older unknown-day receipts.';
notify pgrst, 'reload schema';
commit;

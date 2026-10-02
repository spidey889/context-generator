-- Keep the small current schema; preserve all rows, reset history and RPCs.
begin;
set local lock_timeout = '10s';
lock table public.transfers in access exclusive mode;

-- The outcome constraint already permits exactly started/succeeded/failed and
-- also checks the matching stage/reason. status is NOT NULL, so this standalone
-- enum check adds no protection. Keep the single stronger invariant.
alter table public.transfers drop constraint transfers_status_check;

-- Define the complete counter function rather than rewriting its source text.
-- Only the original deployment cutoff is carried forward from the old body;
-- replaying a migration must never invent a new user-history reset boundary.
do $migration$
declare
  reset_cutoff text := substring(
    pg_get_functiondef('public.record_user_summary()'::regprocedure)
    from $cutoff$new\.received_at < '([^']+)'::timestamptz$cutoff$);
begin
  if reset_cutoff is null then
    raise exception 'Cannot preserve the original users-reset cutoff';
  end if;
  execute format($definition$
create or replace function public.record_user_summary()
returns trigger language plpgsql security invoker set search_path = '' as $function$
declare
  today date;
  summary_delta integer := 0;
  failure_delta integer := 0;
  successful_today integer := 0;
  failed_today integer := 0;
begin
  if new.received_at < %L::timestamptz then return new; end if;
  if new.summary_verified and (tg_op = 'INSERT' or not old.summary_verified) then
    summary_delta := 1;
  end if;
  if new.status = 'failed' and new.failure_reason is distinct from 'no_conversation'
    and (tg_op = 'INSERT' or old.status <> 'failed') then
    failure_delta := 1;
  end if;
  if summary_delta = 0 and failure_delta = 0 then return new; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.install_id, 0));
  perform 1 from public.users u where u.install_id = new.install_id for update;
  if not found then
    -- The identity trigger acquires this same reentrant allocation lock. Take
    -- it before sampling the day: a first install can otherwise wait across
    -- midnight and insert yesterday's counters after the reset job has passed.
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('cap-context-users-allocation', 0));
  end if;
  today := (clock_timestamp() at time zone 'Asia/Kolkata')::date;
  if summary_delta = 1 then
    successful_today := case when (new.summary_confirmed_at at time zone 'Asia/Kolkata')::date = today then 1 else 0 end;
  end if;
  if failure_delta = 1 then
    -- The first database terminal receipt determines the failure day; client
    -- completion clocks and empty-chat diagnostics never affect user failures.
    failed_today := case when (new.terminal_received_at at time zone 'Asia/Kolkata')::date = today then 1 else 0 end;
  end if;
  update public.users as u set
    lifetime_summaries = u.lifetime_summaries + summary_delta,
    today_summaries = case when u.today_date = today then u.today_summaries else 0 end + successful_today,
    today_failed_attempts = case when u.today_date = today then u.today_failed_attempts else 0 end + failed_today,
    today_date = today
  where u.install_id = new.install_id;
  if not found then
    insert into public.users (install_id, lifetime_summaries, today_summaries, today_failed_attempts, today_date)
    values (new.install_id, summary_delta, successful_today, failed_today, today);
  end if;
  return new;
end;
$function$;
$definition$, reset_cutoff);
end;
$migration$;

-- Avoid invoking the counter function at all for unverified empty-chat
-- diagnostics. Verified summary work remains countable independently of paste.
drop trigger transfers_insert_record_user_summary on public.transfers restrict;
create trigger transfers_insert_record_user_summary
after insert on public.transfers for each row
when (new.summary_verified or (new.status = 'failed' and new.failure_reason <> 'no_conversation'))
execute function public.record_user_summary();

drop trigger transfers_update_record_user_summary on public.transfers restrict;
create trigger transfers_update_record_user_summary
after update on public.transfers for each row
when ((new.summary_verified and not old.summary_verified)
  or (new.status = 'failed' and old.status <> 'failed' and new.failure_reason <> 'no_conversation'))
execute function public.record_user_summary();

notify pgrst, 'reload schema';
commit;

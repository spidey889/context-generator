-- Count new successful local carries in the existing users counters. Keep
-- signed-summary verification, old counts, the users-reset cutoff and IST reset.
begin;
set local lock_timeout = '10s';
lock table public.transfers in share row exclusive mode;

do $migration$
declare
  current_definition text := pg_get_functiondef('public.record_user_summary()'::regprocedure);
  reset_cutoff text := substring(current_definition from $cutoff$new\.received_at < '([^']+)'::timestamptz$cutoff$);
  -- Freeze the deployment boundary. Replaying this migration must preserve it.
  local_cutoff text := coalesce(substring(current_definition from $cutoff$local_counting_cutoff constant timestamptz := '([^']+)'$cutoff$), clock_timestamp()::text);
begin
  if reset_cutoff is null then raise exception 'Cannot preserve the original users-reset cutoff'; end if;
  execute format($definition$
create or replace function public.record_user_summary()
returns trigger language plpgsql security invoker set search_path = '' as $function$
declare
  local_counting_cutoff constant timestamptz := %L::timestamptz;
  today date;
  summary_delta integer := 0;
  failure_delta integer := 0;
  successful_today integer := 0;
  failed_today integer := 0;
  already_counted boolean := false;
begin
  if new.received_at < %L::timestamptz then return new; end if;
  -- Local success is reported by the client; it never grants a verified receipt.
  -- First-arrival cutoff excludes historical attempts, including delayed retries.
  if tg_op = 'UPDATE' then
    already_counted := old.summary_verified or (old.received_at >= local_counting_cutoff
      and old.status = 'succeeded' and old.model is not distinct from 'local-direct');
  end if;
  if not already_counted and (new.summary_verified or (new.received_at >= local_counting_cutoff
    and new.status = 'succeeded' and new.model is not distinct from 'local-direct')) then
    summary_delta := 1;
  end if;
  if new.status = 'failed' and new.failure_reason is distinct from 'no_conversation'
    and (tg_op = 'INSERT' or old.status <> 'failed') then failure_delta := 1; end if;
  if summary_delta = 0 and failure_delta = 0 then return new; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.install_id, 0));
  perform 1 from public.users u where u.install_id = new.install_id for update;
  if not found then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('cap-context-users-allocation', 0));
  end if;
  today := (clock_timestamp() at time zone 'Asia/Kolkata')::date;
  if summary_delta = 1 then
    -- Remote work retains signed-day attribution. Unsigned local delivery uses
    -- transaction start, like failures, so a midnight lock wait cannot move days.
    successful_today := case when ((case when new.summary_verified then new.summary_confirmed_at
      else transaction_timestamp() end) at time zone 'Asia/Kolkata')::date = today then 1 else 0 end;
  end if;
  if failure_delta = 1 then
    failed_today := case when (transaction_timestamp() at time zone 'Asia/Kolkata')::date = today then 1 else 0 end;
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
$definition$, local_cutoff, reset_cutoff);
end;
$migration$;

create or replace trigger transfers_insert_record_user_summary after insert on public.transfers
for each row when (new.summary_verified
  or (new.status = 'succeeded' and new.model = 'local-direct')
  or (new.status = 'failed' and new.failure_reason <> 'no_conversation'))
execute function public.record_user_summary();
create or replace trigger transfers_update_record_user_summary after update on public.transfers
for each row when ((new.summary_verified and not old.summary_verified)
  or (new.status = 'succeeded' and new.model = 'local-direct'
    and (old.status <> 'succeeded' or old.model is distinct from 'local-direct'))
  or (new.status = 'failed' and old.status <> 'failed' and new.failure_reason <> 'no_conversation'))
execute function public.record_user_summary();
comment on column public.users.lifetime_summaries is 'Verified backend summaries plus successful local-direct transfers first received after the local-counting deployment; one count per attempt, without historical backfill.';
comment on column public.users.today_summaries is 'IST-day verified backend summaries by signed completion time, plus new successful local-direct transfers by first counted delivery transaction time.';
commit;

-- Change calendar-day interpretation, never timestamps or the users reset epoch.
begin;
set local lock_timeout = '10s';
lock table public.transfer_events in share row exclusive mode;
lock table public.users in access exclusive mode;

do $ist$
declare
  counter_sql text := pg_get_functiondef('public.record_user_summary()'::regprocedure);
  usage_sql text := pg_get_viewdef('public.user_summary_usage'::regclass, true);
  cutoff text;
begin
  -- Preserve the original owner-authorized reset cutoff, including on restore.
  -- Abort on an unexpected definition rather than inventing a new reset date.
  cutoff := (regexp_match(counter_sql, $pattern$new.received_at < '([^']+)'::timestamptz$pattern$))[1];
  if cutoff is null or position('''UTC''' in counter_sql) = 0 then
    raise exception 'Expected UTC users counter with original reset cutoff';
  end if;
  counter_sql := replace(counter_sql, '''UTC''', '''Asia/Kolkata''');
  -- A long transaction/wait must not carry yesterday into a new calendar day.
  -- Lock the user row before sampling time, serializing with the reset UPDATE.
  counter_sql := replace(counter_sql,
    'today constant date := (now() at time zone ''Asia/Kolkata'')::date;', 'today date;');
  counter_sql := replace(counter_sql,
    'if new.summary_verified and',
    'perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.install_id, 0));
      perform 1 from public.users u where u.install_id = new.install_id for update;
      today := (clock_timestamp() at time zone ''Asia/Kolkata'')::date;
      if new.summary_verified and');
  -- The original per-install lock is redundant now that it precedes attribution.
  counter_sql := replace(counter_sql,
    'if summary_delta = 0 and failure_delta = 0 then return new; end if;
      perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.install_id, 0));',
    'if summary_delta = 0 and failure_delta = 0 then return new; end if;');
  if position('today date;' in counter_sql) = 0 or position('for update;' in counter_sql) = 0 then
    raise exception 'Unexpected users counter layout';
  end if;
  execute counter_sql;
  execute 'create or replace view public.user_summary_usage with (security_invoker=true) as ' ||
    replace(replace(usage_sql, '''UTC''', '''Asia/Kolkata'''), 'now()', 'statement_timestamp()');

  -- Rebuild only today's two counters from post-reset authoritative events.
  -- Keep lifetime totals, names, numbers, IDs and all event rows unchanged.
  execute format($reconcile$
    with day as (select (clock_timestamp() at time zone 'Asia/Kolkata')::date as today),
    counts as (
      select u.install_id, d.today,
        count(e.attempt_id) filter (where e.summary_verified
          and (e.summary_confirmed_at at time zone 'Asia/Kolkata')::date = d.today) as summaries,
        count(e.attempt_id) filter (where e.status = 'failed'
          and (e.terminal_received_at at time zone 'Asia/Kolkata')::date = d.today) as failures
      from public.users u cross join day d left join public.transfer_events e
        on e.install_id = u.install_id and e.received_at >= %L::timestamptz
      group by u.install_id, d.today
    )
    update public.users u set today_summaries=c.summaries,
      today_failed_attempts=c.failures, today_date=c.today
    from counts c where c.install_id=u.install_id;
  $reconcile$, cutoff);
end;
$ist$;

alter table public.users alter column today_date
  set default (statement_timestamp() at time zone 'Asia/Kolkata')::date;
create or replace view public.verified_summary_daily_usage with (security_invoker=true) as
select install_id, (summary_confirmed_at at time zone 'Asia/Kolkata')::date as usage_date,
  count(*) as verified_summaries
from public.transfer_events
where summary_verified and summary_confirmed_at is not null
group by install_id, (summary_confirmed_at at time zone 'Asia/Kolkata')::date;

do $job_guard$
begin
  -- Hosted pg_cron uses GMT. Do not change its global timezone/other jobs.
  -- NULL is allowed only for the local catalog shim, which has no scheduler.
  if coalesce(current_setting('cron.timezone', true), 'GMT') not in ('GMT', 'UTC') then
    raise exception 'Expected GMT/UTC cron scheduler for midnight IST schedule';
  end if;
  if (select count(*) from cron.job where jobname='cap-context-reset-daily-user-summaries') <> 1
    or not (select active from cron.job where jobname='cap-context-reset-daily-user-summaries') then
    raise exception 'Expected exactly one active users daily-reset job';
  end if;
end;
$job_guard$;
-- 18:30 GMT is 00:00 IST. Retain the existing job ID and run history.
select cron.alter_job(
  (select jobid from cron.job where jobname='cap-context-reset-daily-user-summaries'),
  schedule := '30 18 * * *',
  command := $job$
  with day as (select (statement_timestamp() at time zone 'Asia/Kolkata')::date as today)
  update public.users u set today_summaries=0, today_failed_attempts=0, today_date=d.today
  from day d where u.today_date < d.today;
$job$);

comment on column public.users.today_date is 'Internal India calendar day (Asia/Kolkata) shared by both daily counters; midnight IST cron and ingestion reset stale days.';
comment on column public.users.today_summaries is 'Verified summaries on the signed occurrence calendar day in India; delayed prior-day and unknown-day proofs do not inflate today.';
comment on column public.users.today_failed_attempts is 'First received failed terminal outcome once per attempt on its database receipt calendar day in India; client clocks are not authoritative.';
comment on view public.verified_summary_daily_usage is 'India calendar-day verified summary history from authenticated occurrence timestamps; excludes unknown-day proofs.';
comment on view public.user_summary_usage is 'Service reporting since the original users reset, using India calendar days; existing output aliases retained.';
notify pgrst, 'reload schema';
commit;

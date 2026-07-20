-- The trigger function is SECURITY INVOKER, so the service role that records
-- transfer events needs the matching table privileges to update aggregates.
grant select, insert, update on table public.users to service_role;

-- Keep clean migration replays and production aligned if the replaced
-- per-transfer view still exists in either environment.
drop view if exists public.user_transfer_activity;

-- Stored daily counters must become zero even when an install is inactive at
-- midnight. The success trigger still handles the same reset if a job is late.
create extension if not exists pg_cron with schema pg_catalog;

grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;

do $$
declare
  existing_job_id bigint;
begin
  for existing_job_id in
    select jobid
    from cron.job
    where jobname = 'cap-context-reset-daily-user-summaries'
  loop
    perform cron.unschedule(existing_job_id);
  end loop;

  perform cron.schedule(
    'cap-context-reset-daily-user-summaries',
    '0 0 * * *',
    $job$
      update public.users
      set
        today_summaries = 0,
        today_date = (now() at time zone 'utc')::date
      where today_date < (now() at time zone 'utc')::date;
    $job$
  );
end;
$$;

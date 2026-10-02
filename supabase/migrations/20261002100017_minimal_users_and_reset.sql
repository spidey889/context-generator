-- Owner-authorized, one-time users/count reset. Never clear transfer history.
begin;
set local lock_timeout = '10s';

-- Match the event -> users lock order used by ingestion, and freeze the cutover
-- while replacing its two aggregate triggers. No event rows/columns are changed.
lock table public.transfer_events in share row exclusive mode;
lock table public.users in access exclusive mode;

drop view public.user_summary_usage;
alter table public.users drop constraint users_counters_nonnegative;
truncate table public.users restart identity;
alter table public.users rename column total_summaries to lifetime_successful_summaries;
alter table public.users rename column today_summaries to today_successful_summaries;
alter table public.users drop column legacy_total_summaries;
alter table public.users
  add column name text not null unique check (name ~ '^[A-Za-z]+( [A-Za-z]+)*$'),
  add column today_failed_attempts bigint not null default 0,
  add constraint users_counters_nonnegative check (
    lifetime_successful_summaries >= 0 and today_successful_summaries >= 0
    and today_successful_summaries <= lifetime_successful_summaries
    and today_failed_attempts >= 0
  );

-- A fixed, extensible Naruto pool, not a second table or numbered aliases.
-- Character spellings: https://narutop99.naruto-official.com/en/archive/
create function public.naruto_user_names() returns text[]
language sql immutable security invoker set search_path = '' as $pool$
  select array[
    'Naruto Uzumaki', 'Sasuke Uchiha', 'Sakura Haruno', 'Kakashi Hatake',
    'Hinata Hyuga', 'Shikamaru Nara', 'Ino Yamanaka', 'Choji Akimichi',
    'Kiba Inuzuka', 'Shino Aburame', 'Neji Hyuga', 'Rock Lee', 'Tenten',
    'Might Guy', 'Asuma Sarutobi', 'Kurenai Yuhi', 'Iruka Umino',
    'Konohamaru Sarutobi', 'Moegi', 'Udon', 'Ebisu', 'Anko Mitarashi',
    'Ibiki Morino', 'Genma Shiranui', 'Hayate Gekko', 'Yugao Uzuki',
    'Kotetsu Hagane', 'Izumo Kamizuki', 'Raido Namiashi',
    'Hashirama Senju', 'Tobirama Senju', 'Hiruzen Sarutobi',
    'Minato Namikaze', 'Tsunade', 'Jiraiya', 'Orochimaru',
    'Kushina Uzumaki', 'Mito Uzumaki', 'Sakumo Hatake', 'Dan Kato',
    'Nawaki', 'Shizune', 'Sai', 'Yamato', 'Shikaku Nara', 'Inoichi Yamanaka',
    'Choza Akimichi', 'Hiashi Hyuga', 'Hizashi Hyuga', 'Hanabi Hyuga',
    'Fugaku Uchiha', 'Mikoto Uchiha', 'Itachi Uchiha', 'Shisui Uchiha',
    'Obito Uchiha', 'Madara Uchiha', 'Izuna Uchiha', 'Kagami Uchiha',
    'Danzo Shimura', 'Homura Mitokado', 'Koharu Utatane',
    'Gaara', 'Temari', 'Kankuro', 'Baki', 'Rasa', 'Karura', 'Chiyo', 'Ebizo',
    'Sasori', 'Deidara', 'Hidan', 'Kakuzu', 'Kisame Hoshigaki',
    'Nagato', 'Konan', 'Yahiko', 'Zetsu', 'Kabuto Yakushi', 'Kimimaro',
    'Zabuza Momochi', 'Haku', 'Mei Terumi', 'Ao', 'Chojuro', 'Yagura',
    'Onoki', 'Kurotsuchi', 'Akatsuchi', 'Kitsuchi', 'Mu', 'Roshi', 'Han',
    'Darui', 'Cee', 'Omoi', 'Karui', 'Samui', 'Mabui', 'Yugito Nii',
    'Killer Bee', 'Utakata', 'Fu', 'Kaguya Otsutsuki', 'Hagoromo Otsutsuki',
    'Hamura Otsutsuki', 'Indra Otsutsuki', 'Ashura Otsutsuki',
    'Toneri Otsutsuki', 'Teuchi', 'Ayame', 'Akamaru', 'Pakkun',
    'Gamabunta', 'Gamakichi', 'Gamatatsu', 'Fukasaku', 'Shima',
    'Katsuyu', 'Manda', 'Kurama', 'Shukaku', 'Matatabi', 'Isobu',
    'Son Goku', 'Kokuo', 'Saiken', 'Chomei', 'Gyuki'
  ]::text[];
$pool$;
alter table public.users add constraint users_name_in_pool check (name = any(public.naruto_user_names()));

create function public.assign_user_identity() returns trigger
language plpgsql security invoker set search_path = '' as $identity$
begin
  -- Serialize allocation only for NEW installs. max+1 is transactional, unlike
  -- nextval: a rolled-back insert cannot leave a gap in visible user numbers.
  -- Keep the original identity sequence for existing backup/restore tooling.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('cap-context-users-allocation', 0));
  select coalesce(max(u.user_no), 0) + 1 into new.user_no from public.users u;
  select candidate into new.name
  from pg_catalog.unnest(public.naruto_user_names()) as pool(candidate)
  where not exists (select 1 from public.users u where u.name = candidate)
  order by pg_catalog.random() limit 1;
  if new.name is null then
    raise exception using errcode = 'P0001', message = 'Naruto user name pool exhausted; extend the predefined pool';
  end if;
  return new;
end;
$identity$;
create trigger users_assign_identity before insert on public.users
for each row execute function public.assign_user_identity();

-- Freeze this reset's boundary inside the function/view definitions, avoiding
-- a new settings table or per-user epoch field. Late updates to PRE-reset
-- attempts remain diagnostics and cannot resurrect cleared test counters.
do $cutover$
declare cutoff timestamptz := clock_timestamp();
begin
  execute format($definition$
    create or replace function public.record_user_summary() returns trigger
    language plpgsql security invoker set search_path = '' as $counter$
    declare
      today constant date := (now() at time zone 'UTC')::date;
      summary_delta integer := 0;
      failure_delta integer := 0;
      successful_today integer := 0;
      failed_today integer := 0;
    begin
      if new.received_at < %L::timestamptz then return new; end if;
      if new.summary_verified and (tg_op = 'INSERT' or not old.summary_verified) then
        summary_delta := 1;
        successful_today := case when (new.summary_confirmed_at at time zone 'UTC')::date = today then 1 else 0 end;
      end if;
      if new.status = 'failed' and (tg_op = 'INSERT' or old.status <> 'failed') then
        failure_delta := 1;
        -- Client completion clocks are diagnostic, never authoritative.
        failed_today := case when (new.terminal_received_at at time zone 'UTC')::date = today then 1 else 0 end;
      end if;
      if summary_delta = 0 and failure_delta = 0 then return new; end if;
      perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.install_id, 0));
      update public.users as u set
        lifetime_successful_summaries = u.lifetime_successful_summaries + summary_delta,
        today_successful_summaries = case when u.today_date = today then u.today_successful_summaries else 0 end + successful_today,
        today_failed_attempts = case when u.today_date = today then u.today_failed_attempts else 0 end + failed_today,
        today_date = today
      where u.install_id = new.install_id;
      if not found then
        insert into public.users (install_id, lifetime_successful_summaries, today_successful_summaries, today_failed_attempts, today_date)
        values (new.install_id, summary_delta, successful_today, failed_today, today);
      end if;
      return new;
    end;
    $counter$;
  $definition$, cutoff);

  -- Retain the existing reporting column names for service-side consumers.
  -- The aggregate history is scoped to this reset, matching the fresh counters.
  execute format($view$
    create view public.user_summary_usage with (security_invoker = true) as
    select u.user_no, u.install_id, u.lifetime_successful_summaries as total_summaries,
      0::bigint as legacy_total_summaries,
      count(e.attempt_id) filter (where e.summary_verified) as verified_summaries,
      count(e.attempt_id) filter (where e.summary_verified and e.summary_confirmed_at is null) as verified_unknown_day_summaries,
      count(e.attempt_id) filter (where e.summary_verified and (e.summary_confirmed_at at time zone 'UTC')::date = (now() at time zone 'UTC')::date) as verified_today_summaries,
      count(e.attempt_id) filter (where e.status = 'succeeded') as successful_transfers,
      count(e.attempt_id) filter (where e.status = 'failed') as failed_transfers,
      count(e.attempt_id) filter (where e.status = 'started' and e.updated_at < now() - interval '24 hours') as unknown_outcomes,
      u.name, u.today_successful_summaries, u.lifetime_successful_summaries, u.today_failed_attempts
    from public.users u left join public.transfer_events e
      on e.install_id = u.install_id and e.received_at >= %L::timestamptz
    group by u.user_no;
  $view$, cutoff);
end;
$cutover$;

drop trigger transfer_events_insert_record_user_summary on public.transfer_events;
drop trigger transfer_events_update_record_user_summary on public.transfer_events;
create trigger transfer_events_insert_record_user_summary after insert on public.transfer_events
for each row when (new.summary_verified or new.status = 'failed')
execute function public.record_user_summary();
create trigger transfer_events_update_record_user_summary after update on public.transfer_events
for each row when ((new.summary_verified and not old.summary_verified)
  or (new.status = 'failed' and old.status <> 'failed'))
execute function public.record_user_summary();

-- Update the ONE existing job in place, retaining job ID/schedule/run history.
do $job_guard$
begin
  if (select count(*) from cron.job where jobname = 'cap-context-reset-daily-user-summaries' and active) <> 1 then
    raise exception 'Expected exactly one active users daily-reset job';
  end if;
end;
$job_guard$;
-- Hosted cron.job is read-only to application postgres. Its supported API
-- changes the owned job without granting broad catalog-write permissions.
select cron.alter_job(
  (select jobid from cron.job where jobname = 'cap-context-reset-daily-user-summaries'),
  command := $job$
  update public.users set today_successful_summaries = 0, today_failed_attempts = 0,
    today_date = (now() at time zone 'UTC')::date
  where today_date < (now() at time zone 'UTC')::date;
$job$);

revoke all on function public.naruto_user_names(), public.assign_user_identity(), public.record_user_summary()
  from public, anon, authenticated;
grant execute on function public.naruto_user_names(), public.assign_user_identity(), public.record_user_summary() to service_role;
revoke all on public.user_summary_usage from public, anon, authenticated, service_role;
grant select on public.user_summary_usage to service_role;

comment on table public.users is 'Fresh per-install verified summary and reported failure counters, reset by owner on 2026-10-02. install_id and today_date are internal; not unique people.';
comment on column public.users.install_id is 'Internal stable installation key used by telemetry; preserve it when displaying the five user fields.';
comment on column public.users.today_date is 'Internal UTC day for both daily counters. Midnight cron and ingestion perform resets.';
comment on column public.users.name is 'Random unused Naruto character name from naruto_user_names(); no numeric suffixes. Expand the pool before exhaustion.';
comment on column public.users.today_failed_attempts is 'First received failed outcome, once per attempt, on the UTC database receipt day; unknown/started outcomes do not count.';
comment on column public.users.today_successful_summaries is 'Verified summary completions occurring today in UTC; v1 unknown-day and delayed prior-day receipts do not inflate today.';
comment on column public.users.lifetime_successful_summaries is 'Verified summaries since the users reset, counted once even when pasting fails.';
comment on view public.user_summary_usage is 'Service-only reporting since the users reset; original column aliases retained for compatibility, legacy baseline is now zero.';
notify pgrst, 'reload schema';
commit;

-- Presentation-only follow-up: preserve user numbers, keys, counts and reset.
begin;
set local lock_timeout = '10s';
lock table public.transfer_events in share row exclusive mode;
lock table public.users in access exclusive mode;

alter table public.users rename column lifetime_successful_summaries to lifetime_summaries;
alter table public.users rename column today_successful_summaries to today_summaries;

create or replace function public.naruto_user_names() returns text[]
language sql immutable security invoker set search_path = '' as $pool$
  select array[
    'Naruto Uzumaki', 'Sasuke Uchiha', 'Sakura Haruno', 'Kakashi Hatake',
    'Hinata Hyuga', 'Shikamaru Nara', 'Ino Yamanaka', 'Choji Akimichi',
    'Kiba Inuzuka', 'Shino Aburame', 'Neji Hyuga', 'Rock Lee', 'Tenten',
    'Might Guy', 'Asuma Sarutobi', 'Iruka Umino', 'Konohamaru Sarutobi',
    'Hashirama Senju', 'Tobirama Senju', 'Hiruzen Sarutobi', 'Minato Namikaze',
    'Tsunade', 'Jiraiya', 'Orochimaru', 'Kushina Uzumaki', 'Itachi Uchiha',
    'Shisui Uchiha', 'Obito Uchiha', 'Madara Uchiha', 'Gaara', 'Temari',
    'Sasori', 'Deidara', 'Hidan', 'Kakuzu', 'Kisame Hoshigaki',
    'Nagato', 'Konan', 'Sai', 'Kurama'
  ]::text[];
$pool$;

-- PostgreSQL cannot ALTER column order. Copy only users inside this locked
-- transaction, then swap back; no staging table survives the commit. Preserve
-- the existing sequence state and reset timestamp rather than starting over.
do $format$
declare
  view_sql text := pg_get_viewdef('public.user_summary_usage'::regclass, true);
  counter_sql text := pg_get_functiondef('public.record_user_summary()'::regprocedure);
  table_note text := obj_description('public.users'::regclass, 'pg_class');
  column_notes jsonb;
  sequence_last bigint;
  sequence_called boolean;
  unnamed record;
  available_name text;
  note record;
begin
  select last_value, is_called into sequence_last, sequence_called from public.users_user_no_seq;
  select jsonb_object_agg(attname, col_description(attrelid, attnum)) into column_notes
  from pg_attribute where attrelid='public.users'::regclass and attnum>0 and not attisdropped;
  if (select count(*) from public.users) > cardinality(public.naruto_user_names()) then
    raise exception 'More users than famous Naruto names; expand the pool before formatting';
  end if;

  create table public.users_formatted (
    install_id text not null unique,
    user_no bigint generated always as identity primary key,
    name text not null unique check (name ~ '^[A-Za-z]+( [A-Za-z]+)*$'),
    lifetime_summaries bigint not null default 0,
    today_summaries bigint not null default 0,
    today_failed_attempts bigint not null default 0,
    today_date date not null default (now() at time zone 'UTC')::date,
    constraint users_formatted_counters_nonnegative check (
      lifetime_summaries >= 0 and today_summaries >= 0
      and today_summaries <= lifetime_summaries and today_failed_attempts >= 0
    )
  );
  insert into public.users_formatted overriding system value
  select install_id, user_no, name, lifetime_summaries, today_summaries, today_failed_attempts, today_date
  from public.users;
  -- Keep existing famous names. Only replace less familiar names, as requested.
  for unnamed in select user_no from public.users_formatted
    where not (name=any(public.naruto_user_names())) order by user_no loop
    select candidate into available_name from unnest(public.naruto_user_names()) pool(candidate)
    where not exists(select 1 from public.users_formatted u where u.name=candidate)
    order by random() limit 1;
    if available_name is null then raise exception 'Famous Naruto name pool exhausted'; end if;
    update public.users_formatted set name=available_name where user_no=unnamed.user_no;
  end loop;
  alter table public.users_formatted add constraint users_formatted_name_in_pool
    check (name=any(public.naruto_user_names()));

  drop view public.user_summary_usage;
  -- No CASCADE: an unexpected foreign key/view must abort, never be removed.
  drop table public.users;
  alter table public.users_formatted rename to users;
  alter sequence public.users_formatted_user_no_seq rename to users_user_no_seq;
  perform setval('public.users_user_no_seq', sequence_last, sequence_called);
  alter table public.users rename constraint users_formatted_pkey to users_pkey;
  alter table public.users rename constraint users_formatted_install_id_key to users_install_id_key;
  alter table public.users rename constraint users_formatted_name_key to users_name_key;
  alter table public.users rename constraint users_formatted_name_check to users_name_check;
  alter table public.users rename constraint users_formatted_counters_nonnegative to users_counters_nonnegative;
  alter table public.users rename constraint users_formatted_name_in_pool to users_name_in_pool;
  alter table public.users enable row level security;
  revoke all on public.users from public, anon, authenticated, service_role;
  grant select, insert, update on public.users to service_role;
  revoke all on sequence public.users_user_no_seq from public, anon, authenticated, service_role;
  grant usage on sequence public.users_user_no_seq to service_role;
  create trigger users_assign_identity before insert on public.users
    for each row execute function public.assign_user_identity();
  execute format('comment on table public.users is %L', table_note);
  for note in select * from jsonb_each_text(column_notes) loop
    execute format('comment on column public.users.%I is %L', note.key, note.value);
  end loop;
  -- Keep the original frozen cutoff and reporting aliases byte-for-byte.
  execute replace(replace(counter_sql, 'lifetime_successful_summaries', 'lifetime_summaries'),
    'today_successful_summaries', 'today_summaries');
  execute 'create view public.user_summary_usage with (security_invoker=true) as ' || view_sql;
  revoke all on public.user_summary_usage from public, anon, authenticated, service_role;
  grant select on public.user_summary_usage to service_role;
end;
$format$;

-- Same midnight job; only its renamed successful-summary column changes.
select cron.alter_job(
  (select jobid from cron.job where jobname='cap-context-reset-daily-user-summaries'),
  command := $job$
  update public.users set today_summaries=0, today_failed_attempts=0,
    today_date=(now() at time zone 'UTC')::date
  where today_date < (now() at time zone 'UTC')::date;
$job$);
comment on column public.users.name is 'Random unused name from the 40 well-known Naruto characters in naruto_user_names(); unique, no numeric suffixes.';
comment on view public.user_summary_usage is 'Service reporting since the original users reset; previous output column aliases retained after formatting.';
notify pgrst, 'reload schema';
commit;

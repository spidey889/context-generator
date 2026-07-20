drop view if exists public.user_daily_usage;
drop trigger if exists transfer_events_register_analytics_user on public.transfer_events;
drop function if exists public.register_analytics_user();
drop table if exists public.analytics_users;

create table public.users (
  user_no bigint generated always as identity primary key,
  install_id text not null unique,
  total_summaries bigint not null default 0,
  today_summaries bigint not null default 0,
  today_date date not null default (now() at time zone 'utc')::date
);

comment on table public.users is
  'One row per browser/extension install. A row is created the moment that install''s first summary succeeds; user_no is assigned in that order.';

alter table public.users enable row level security;

revoke all privileges on table public.users from public, anon, authenticated, service_role;
grant select on table public.users to service_role;

revoke all privileges on sequence public.users_user_no_seq from public, anon, authenticated, service_role;
grant usage on sequence public.users_user_no_seq to service_role;

create or replace function public.record_user_summary()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  today constant date := (now() at time zone 'utc')::date;
begin
  insert into public.users (install_id, total_summaries, today_summaries, today_date)
  values (new.install_id, 1, 1, today)
  on conflict (install_id) do update
  set
    total_summaries = public.users.total_summaries + 1,
    today_summaries = case
      when public.users.today_date = today then public.users.today_summaries + 1
      else 1
    end,
    today_date = today;

  return new;
end;
$$;

revoke all on function public.record_user_summary() from public, anon, authenticated;
grant execute on function public.record_user_summary() to service_role;

create trigger transfer_events_insert_record_user_summary
after insert on public.transfer_events
for each row
when (new.status = 'succeeded')
execute function public.record_user_summary();

create trigger transfer_events_update_record_user_summary
after update on public.transfer_events
for each row
when (new.status = 'succeeded' and old.status is distinct from 'succeeded')
execute function public.record_user_summary();

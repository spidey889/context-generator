-- Keep a stable, human-friendly number for each anonymous extension install.
-- The install UUID remains an internal join key and is intentionally omitted
-- from the daily usage view.
create table public.analytics_users (
  user_id bigint generated always as identity primary key,
  install_id text not null unique
);

comment on table public.analytics_users is
  'Anonymous extension installs mapped to internal User N labels; not Cap Context accounts or real identities.';

alter table public.analytics_users enable row level security;

revoke all privileges on table public.analytics_users
  from public, anon, authenticated, service_role;
grant select, insert on table public.analytics_users to service_role;

revoke all privileges on sequence public.analytics_users_user_id_seq
  from public, anon, authenticated, service_role;
grant usage on sequence public.analytics_users_user_id_seq to service_role;

create or replace function public.register_analytics_user()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  insert into public.analytics_users (install_id)
  values (new.install_id)
  on conflict (install_id) do nothing;

  return new;
end;
$$;

revoke all on function public.register_analytics_user()
  from public, anon, authenticated;
grant execute on function public.register_analytics_user()
  to service_role;

create trigger transfer_events_register_analytics_user
after insert on public.transfer_events
for each row
execute function public.register_analytics_user();

-- Assign existing installs in first-received order so the earliest real install
-- becomes User 1. Future installs are registered by the trigger above.
insert into public.analytics_users (install_id)
select existing.install_id
from (
  select
    install_id,
    min(received_at) as first_received_at
  from public.transfer_events
  group by install_id
) as existing
order by existing.first_received_at, existing.install_id
on conflict (install_id) do nothing;

create index transfer_events_install_id_attempted_at_idx
  on public.transfer_events (install_id, attempted_at);

create view public.user_daily_usage
with (security_invoker = true)
as
select
  users.user_id,
  'User ' || users.user_id::text as user_name,
  (events.attempted_at at time zone 'UTC')::date as usage_date,
  count(*) as transfer_count,
  coalesce(
    array_agg(events.character_count order by events.attempted_at, events.attempt_id)
      filter (where events.character_count is not null),
    array[]::integer[]
  ) as chat_character_counts,
  coalesce(sum(events.character_count), 0) as total_characters
from public.analytics_users as users
join public.transfer_events as events
  on events.install_id = users.install_id
group by
  users.user_id,
  (events.attempted_at at time zone 'UTC')::date;

comment on view public.user_daily_usage is
  'Internal UTC daily usage by anonymous User N label, including attempt count and metadata-only character counts.';

revoke all privileges on table public.user_daily_usage
  from public, anon, authenticated, service_role;
grant select on table public.user_daily_usage to service_role;

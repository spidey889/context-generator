-- Keep the daily view focused on frequency. Individual chat sizes belong in
-- the per-transfer activity view below, where one row always means one attempt.
drop view if exists public.user_daily_usage;

create view public.user_daily_usage
with (security_invoker = true)
as
select
  users.user_id,
  'User ' || users.user_id::text as user_name,
  (events.attempted_at at time zone 'UTC')::date as usage_date,
  count(*) as transfer_count
from public.analytics_users as users
join public.transfer_events as events
  on events.install_id = users.install_id
group by
  users.user_id,
  (events.attempted_at at time zone 'UTC')::date;

comment on view public.user_daily_usage is
  'Internal UTC daily transfer count by anonymous User N label.';

revoke all privileges on table public.user_daily_usage
  from public, anon, authenticated, service_role;
grant select on table public.user_daily_usage to service_role;

create view public.user_transfer_activity
with (security_invoker = true)
as
select
  users.user_id,
  'User ' || users.user_id::text as user_name,
  events.attempted_at,
  (events.attempted_at at time zone 'UTC')::date as usage_date,
  events.source_platform,
  events.destination_platform,
  events.character_count,
  events.status,
  events.failure_reason
from public.analytics_users as users
join public.transfer_events as events
  on events.install_id = users.install_id;

comment on view public.user_transfer_activity is
  'Internal one-row-per-transfer activity by anonymous User N label; no install id or conversation content is exposed.';

revoke all privileges on table public.user_transfer_activity
  from public, anon, authenticated, service_role;
grant select on table public.user_transfer_activity to service_role;

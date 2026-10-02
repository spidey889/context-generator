-- Additive cutover: preserve IDs, historical rows and lifetime counters.
begin;

alter table public.transfer_events
  add column completed_at timestamptz,
  add column terminal_received_at timestamptz,
  add column summary_confirmed_at timestamptz,
  add column summary_received_at timestamptz,
  add constraint transfer_events_character_count_nonnegative
    check (character_count is null or character_count >= 0),
  add constraint transfer_events_outcome_consistent check (
    (status = 'started' and last_stage <> 'completed' and failure_reason is null)
    or (status = 'succeeded' and last_stage = 'completed' and failure_reason is null)
    or (status = 'failed' and last_stage <> 'completed' and failure_reason is not null)
  ),
  add constraint transfer_events_completion_terminal
    check (completed_at is null or (isfinite(completed_at) and status in ('succeeded', 'failed'))),
  add constraint transfer_events_confirmation_verified
    check (summary_confirmed_at is null or (isfinite(summary_confirmed_at) and summary_verified)),
  add constraint transfer_events_terminal_receipt_consistent
    check (terminal_received_at is null or (isfinite(terminal_received_at) and status in ('succeeded', 'failed'))),
  add constraint transfer_events_summary_receipt_consistent
    check (summary_received_at is null or (isfinite(summary_received_at) and summary_verified));

comment on column public.transfer_events.completed_at is
  'First terminal time reported by the client, diagnostic only. NULL for legacy reports; client clocks are not authoritative.';
comment on column public.transfer_events.terminal_received_at is
  'Database receipt time of the first terminal report after this migration. NULL means historical first-terminal receipt time is unknown.';
comment on column public.transfer_events.summary_confirmed_at is
  'Server completion time authenticated by a v2 summary receipt. NULL means occurrence-day attribution is unknown, including v1 receipts.';
comment on column public.transfer_events.summary_received_at is
  'Database time at first verified confirmation after this migration, independent of client paste outcome.';
comment on column public.transfer_events.extension_version is
  'First observed client version for the attempt. An upgraded worker can finish it with a newer authenticated receipt without replacing this metadata.';

alter table public.users add column legacy_total_summaries bigint not null default 0;
-- This also works if the preceding verified-counter migration was deployed
-- earlier: subtract its confirmed additions instead of labelling them legacy.
update public.users as u
set legacy_total_summaries = greatest(u.total_summaries - (
  select count(*) from public.transfer_events as e
  where e.install_id = u.install_id and e.summary_verified
), 0);
alter table public.users add constraint users_counters_nonnegative check (
  total_summaries >= 0 and today_summaries >= 0
  and legacy_total_summaries >= 0 and legacy_total_summaries <= total_summaries
  and today_summaries <= total_summaries
);
comment on column public.users.legacy_total_summaries is
  'Frozen lifetime baseline from before server receipt verification. Existing values are preserved, not presented as verified summaries.';

create function public.preserve_transfer_event_invariants()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if row(new.id, new.attempt_id, new.install_id, new.attempted_at,
      new.source_platform, new.destination_platform, new.extension_version, new.received_at)
      is distinct from row(old.id, old.attempt_id, old.install_id, old.attempted_at,
      old.source_platform, old.destination_platform, old.extension_version, old.received_at) then
      raise exception using errcode = '22023', message = 'Transfer attempt identity is immutable';
    end if;
    if old.status in ('succeeded', 'failed') and
      row(new.status, new.last_stage, new.failure_reason, new.completed_at, new.terminal_received_at)
      is distinct from row(old.status, old.last_stage, old.failure_reason, old.completed_at, old.terminal_received_at) then
      raise exception using errcode = '22023', message = 'The first terminal transfer outcome is immutable';
    end if;
    if old.summary_verified and
      row(new.summary_verified, new.summary_confirmed_at, new.summary_received_at)
      is distinct from row(old.summary_verified, old.summary_confirmed_at, old.summary_received_at) then
      raise exception using errcode = '22023', message = 'The first verified summary confirmation is immutable';
    end if;
  end if;

  if new.status in ('succeeded', 'failed') and
    (tg_op = 'INSERT' or old.status = 'started') then
    new.terminal_received_at := now();
  end if;
  if new.summary_verified and (tg_op = 'INSERT' or not old.summary_verified) then
    new.summary_received_at := now();
  end if;
  return new;
end;
$$;
revoke all on function public.preserve_transfer_event_invariants() from public, anon, authenticated;
grant execute on function public.preserve_transfer_event_invariants() to service_role;
create trigger transfer_events_preserve_invariants
before insert or update on public.transfer_events
for each row execute function public.preserve_transfer_event_invariants();

-- One signature, with defaults, accepts historical 10-argument callers and
-- v1 proof callers. Avoid overloaded RPCs with ambiguous PostgREST resolution.
drop function public.record_transfer_event(uuid, text, timestamptz, text, text, integer, text, text, text, text, boolean);
create function public.record_transfer_event(
  p_attempt_id uuid, p_install_id text, p_attempted_at timestamptz,
  p_source_platform text, p_destination_platform text, p_character_count integer,
  p_status text, p_last_stage text, p_failure_reason text, p_extension_version text,
  p_summary_verified boolean default false,
  p_completed_at timestamptz default null,
  p_summary_confirmed_at timestamptz default null
)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  stage_order constant text[] := array[
    'intent_started', 'capture_started', 'capture_completed', 'summary_request_started',
    'summary_response_started', 'summary_completed', 'paste_started', 'completed'
  ];
begin
  insert into public.transfer_events (
    attempt_id, install_id, attempted_at, source_platform, destination_platform,
    character_count, status, last_stage, failure_reason, extension_version,
    summary_verified, completed_at, summary_confirmed_at
  ) values (
    p_attempt_id, p_install_id, p_attempted_at, p_source_platform, p_destination_platform,
    p_character_count, p_status, p_last_stage, p_failure_reason, p_extension_version,
    coalesce(p_summary_verified, false), p_completed_at, p_summary_confirmed_at
  )
  on conflict (attempt_id) do update set
    -- Assign the identity too so the table guard rejects mismatched replays,
    -- including races between two initial inserts for the same attempt ID.
    install_id = excluded.install_id,
    attempted_at = excluded.attempted_at,
    source_platform = excluded.source_platform,
    destination_platform = excluded.destination_platform,
    -- An extension update can finish an already-recorded attempt. Its incoming
    -- version is authenticated by the receipt, but retain first-observed version
    -- as metadata instead of treating an upgrade as a different attempt owner.
    character_count = case when transfer_events.status = 'started'
      then coalesce(excluded.character_count, transfer_events.character_count)
      else transfer_events.character_count end,
    status = case when transfer_events.status = 'started'
      then excluded.status else transfer_events.status end,
    failure_reason = case when transfer_events.status = 'started'
      then excluded.failure_reason else transfer_events.failure_reason end,
    last_stage = case
      when transfer_events.status <> 'started' then transfer_events.last_stage
      when excluded.status <> 'started' then excluded.last_stage
      when array_position(stage_order, excluded.last_stage) > array_position(stage_order, transfer_events.last_stage)
        then excluded.last_stage
      else transfer_events.last_stage end,
    completed_at = case when transfer_events.status = 'started'
      then excluded.completed_at else transfer_events.completed_at end,
    summary_verified = transfer_events.summary_verified or excluded.summary_verified,
    summary_confirmed_at = case when not transfer_events.summary_verified
      then excluded.summary_confirmed_at else transfer_events.summary_confirmed_at end,
    updated_at = now()
  where
    row(transfer_events.install_id, transfer_events.attempted_at, transfer_events.source_platform,
      transfer_events.destination_platform)
      is distinct from row(excluded.install_id, excluded.attempted_at, excluded.source_platform,
      excluded.destination_platform)
    or (excluded.summary_verified and not transfer_events.summary_verified)
    or (transfer_events.status = 'started' and (
      excluded.status <> 'started'
      or array_position(stage_order, excluded.last_stage) > array_position(stage_order, transfer_events.last_stage)
      or (transfer_events.character_count is null and excluded.character_count is not null)
    ));
end;
$$;
revoke all on function public.record_transfer_event(uuid, text, timestamptz, text, text, integer, text, text, text, text, boolean, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.record_transfer_event(uuid, text, timestamptz, text, text, integer, text, text, text, text, boolean, timestamptz, timestamptz)
  to service_role;

create or replace function public.record_user_summary()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  today constant date := (now() at time zone 'UTC')::date;
  completed_today constant boolean := coalesce((new.summary_confirmed_at at time zone 'UTC')::date = today, false);
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.install_id, 0));
  update public.users as existing set
    total_summaries = existing.total_summaries + 1,
    today_summaries = case when existing.today_date = today then existing.today_summaries else 0 end
      + case when completed_today then 1 else 0 end,
    today_date = today
  where existing.install_id = new.install_id;
  if not found then
    insert into public.users (install_id, total_summaries, today_summaries, today_date)
    values (new.install_id, 1, case when completed_today then 1 else 0 end, today);
  end if;
  return new;
end;
$$;
comment on column public.users.today_summaries is
  'UTC occurrence-day counter for timestamped verified summaries after cutover; delayed older confirmations and v1 receipts do not inflate today. Retains historical current-day count until reset.';

create view public.transfer_event_outcomes with (security_invoker = true) as
select e.*, case
  when status <> 'started' then status
  when updated_at < now() - interval '24 hours' then 'outcome_unknown'
  else 'pending' end as reported_outcome
from public.transfer_events as e;
comment on view public.transfer_event_outcomes is
  'Metadata-only outcomes. Started attempts with no received progress for 24 hours are unknown, never silently failed; a late terminal report can resolve them.';

create view public.verified_summary_daily_usage with (security_invoker = true) as
select install_id, (summary_confirmed_at at time zone 'UTC')::date as usage_date,
  count(*) as verified_summaries
from public.transfer_events
where summary_verified and summary_confirmed_at is not null
group by install_id, (summary_confirmed_at at time zone 'UTC')::date;
comment on view public.verified_summary_daily_usage is
  'UTC daily server-summary completions from authenticated occurrence timestamps; excludes unknown-day v1 proofs and legacy client outcomes.';

create view public.user_summary_usage with (security_invoker = true) as
select u.user_no, u.install_id, u.total_summaries, u.legacy_total_summaries,
  count(e.attempt_id) filter (where e.summary_verified) as verified_summaries,
  count(e.attempt_id) filter (where e.summary_verified and e.summary_confirmed_at is null) as verified_unknown_day_summaries,
  count(e.attempt_id) filter (where e.summary_verified
    and (e.summary_confirmed_at at time zone 'UTC')::date = (now() at time zone 'UTC')::date) as verified_today_summaries,
  count(e.attempt_id) filter (where e.status = 'succeeded') as successful_transfers,
  count(e.attempt_id) filter (where e.status = 'failed') as failed_transfers,
  count(e.attempt_id) filter (where e.status = 'started' and e.updated_at < now() - interval '24 hours') as unknown_outcomes
from public.users as u left join public.transfer_events as e on e.install_id = u.install_id
group by u.user_no, u.install_id, u.total_summaries, u.legacy_total_summaries;
comment on view public.user_summary_usage is
  'Service-only live reporting separates legacy totals, verified server summaries and client transfer outcomes; dynamic UTC today needs no reset job.';
revoke all on public.transfer_event_outcomes, public.verified_summary_daily_usage, public.user_summary_usage
  from public, anon, authenticated, service_role;
grant select on public.transfer_event_outcomes, public.verified_summary_daily_usage, public.user_summary_usage to service_role;

-- Keep the existing midnight job solely for the public.users stored-column
-- contract. New reports derive today from event timestamps instead.
notify pgrst, 'reload schema';
commit;

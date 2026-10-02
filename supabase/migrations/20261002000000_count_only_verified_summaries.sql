-- Forward-only: legacy/client-reported outcomes do not prove a server summary.
-- Preserve historical counters; their provenance cannot be reconstructed.
begin;

alter table public.transfer_events
  add column summary_verified boolean not null default false;
comment on column public.transfer_events.summary_verified is
  'Set only by the trusted edge handler after verifying a server summary receipt. Client paste outcomes are separate.';

-- Replace the old signature so callers cannot bypass the new invariant.
drop function public.record_transfer_event(uuid, text, timestamptz, text, text, integer, text, text, text, text);

create function public.record_transfer_event(
  p_attempt_id uuid,
  p_install_id text,
  p_attempted_at timestamptz,
  p_source_platform text,
  p_destination_platform text,
  p_character_count integer,
  p_status text,
  p_last_stage text,
  p_failure_reason text,
  p_extension_version text,
  p_summary_verified boolean default false
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  stage_order constant text[] := array[
    'intent_started',
    'capture_started',
    'capture_completed',
    'summary_request_started',
    'summary_response_started',
    'summary_completed',
    'paste_started',
    'completed'
  ];
begin
  insert into public.transfer_events (
    attempt_id,
    install_id,
    attempted_at,
    source_platform,
    destination_platform,
    character_count,
    status,
    last_stage,
    failure_reason,
    extension_version,
    summary_verified
  ) values (
    p_attempt_id,
    p_install_id,
    p_attempted_at,
    p_source_platform,
    p_destination_platform,
    p_character_count,
    p_status,
    p_last_stage,
    p_failure_reason,
    p_extension_version,
    coalesce(p_summary_verified, false)
  )
  on conflict (attempt_id) do update
  set
    summary_verified = transfer_events.summary_verified or excluded.summary_verified,
    character_count = coalesce(excluded.character_count, transfer_events.character_count),
    status = case
      when transfer_events.status in ('succeeded', 'failed') then transfer_events.status
      else excluded.status
    end,
    failure_reason = case
      when transfer_events.status in ('succeeded', 'failed') then transfer_events.failure_reason
      else excluded.failure_reason
    end,
    last_stage = case
      when array_position(stage_order, excluded.last_stage) > array_position(stage_order, transfer_events.last_stage)
        then excluded.last_stage
      else transfer_events.last_stage
    end,
    updated_at = now()
  where
    transfer_events.install_id = excluded.install_id
    and transfer_events.attempted_at = excluded.attempted_at
    and transfer_events.source_platform = excluded.source_platform
    and transfer_events.destination_platform = excluded.destination_platform
    and transfer_events.extension_version is not distinct from excluded.extension_version
    and (
      (excluded.summary_verified and not transfer_events.summary_verified)
      or transfer_events.status = 'started'
      or array_position(stage_order, excluded.last_stage) > array_position(stage_order, transfer_events.last_stage)
    );
end;
$$;

revoke all on function public.record_transfer_event(uuid, text, timestamptz, text, text, integer, text, text, text, text, boolean)
  from public, anon, authenticated;
grant execute on function public.record_transfer_event(uuid, text, timestamptz, text, text, integer, text, text, text, text, boolean)
  to service_role;

-- Confirmation can arrive after a failed paste or an offline retry. Count once,
-- independently of the sticky client outcome, never on a claimed success alone.
drop trigger transfer_events_insert_record_user_summary on public.transfer_events;
drop trigger transfer_events_update_record_user_summary on public.transfer_events;
create trigger transfer_events_insert_record_user_summary
after insert on public.transfer_events
for each row when (new.summary_verified)
execute function public.record_user_summary();
create trigger transfer_events_update_record_user_summary
after update on public.transfer_events
for each row when (new.summary_verified and not old.summary_verified)
execute function public.record_user_summary();

comment on table public.users is
  'Per-install server-confirmed summary counters. Historical values predate receipt verification; install IDs do not prove unique people.';

commit;
